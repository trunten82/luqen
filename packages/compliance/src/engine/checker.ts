import type { DbAdapter } from '../db/adapter.js';
import type {
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  JurisdictionResult,
  RegulationResult,
  RegulationMatrixEntry,
  AnnotatedIssue,
  RequirementWithRegulation,
} from '../types.js';
import { parseIssueCode } from './matcher.js';

// ---- Jurisdiction hierarchy resolution ----

async function resolveJurisdictionHierarchy(
  jurisdictionIds: readonly string[],
  db: DbAdapter,
): Promise<Set<string>> {
  const resolved = new Set<string>(jurisdictionIds);
  const queue = [...jurisdictionIds];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const jurisdiction = await db.getJurisdiction(id);
    if (jurisdiction?.parentId != null && !resolved.has(jurisdiction.parentId)) {
      resolved.add(jurisdiction.parentId);
      queue.push(jurisdiction.parentId);
    }
  }

  return resolved;
}

// ---- Level type ----

type WcagLevel = 'A' | 'AA' | 'AAA';

// ---- Sector filter helper ----

function regulationMatchesSectors(
  regSectors: readonly string[],
  filterSectors: readonly string[],
): boolean {
  if (filterSectors.length === 0) return true;
  if (regSectors.length === 0) return false;
  return filterSectors.some(s => regSectors.includes(s));
}

// ---- Internal structures ----

interface ParsedIssue {
  readonly originalIssue: ComplianceCheckRequest['issues'][number];
  readonly criterion: string | null;
  readonly level: WcagLevel | null;
}

// ---- Main checker ----

export async function checkCompliance(
  request: ComplianceCheckRequest,
  db: DbAdapter,
  orgId?: string,
): Promise<ComplianceCheckResponse> {
  const { jurisdictions, issues, includeOptional = false, sectors: sectorFilter = [] } = request;

  // Step 1: Parse all issue codes
  const parsedIssues: ParsedIssue[] = issues.map(issue => {
    const parsed = parseIssueCode(issue.code);
    return {
      originalIssue: issue,
      criterion: parsed?.criterion ?? null,
      level: parsed?.level ?? null,
    };
  });

  // Step 2: Collect all unique criteria
  const uniqueCriteria = [
    ...new Set(parsedIssues.map(p => p.criterion).filter((c): c is string => c !== null)),
  ];

  // Step 3: Resolve all requested jurisdictions + their ancestors
  const resolvedJurisdictionIds = await resolveJurisdictionHierarchy(jurisdictions, db);
  const allJurisdictionIds = [...resolvedJurisdictionIds];

  // Step 4: Query requirements for all criteria
  const requirements: RequirementWithRegulation[] =
    uniqueCriteria.length > 0 && allJurisdictionIds.length > 0
      ? await db.findRequirementsByCriteria(allJurisdictionIds, uniqueCriteria, orgId)
      : [];

  // Step 5: Cache regulation sectors
  const regulationSectorCache = new Map<string, readonly string[]>();
  const regulationScopeCache = new Map<string, string>();

  for (const req of requirements) {
    if (!regulationSectorCache.has(req.regulationId)) {
      const regulation = await db.getRegulation(req.regulationId);
      regulationSectorCache.set(req.regulationId, regulation?.sectors ?? []);
      regulationScopeCache.set(req.regulationId, regulation?.scope ?? 'all');
    }
  }

  // Step 6: Build annotated issues
  const annotatedIssues: AnnotatedIssue[] = parsedIssues.map(parsed => {
    const matchingRegs = findMatchingRegulations(
      parsed,
      requirements,
      regulationSectorCache,
      sectorFilter,
    );

    return {
      code: parsed.originalIssue.code,
      wcagCriterion: parsed.criterion ?? parsed.originalIssue.code,
      wcagLevel: parsed.level ?? 'A',
      originalIssue: parsed.originalIssue as unknown as Record<string, unknown>,
      regulations: matchingRegs.map(req => ({
        regulationId: req.regulationId,
        regulationName: req.regulationName,
        shortName: req.regulationShortName,
        jurisdictionId: req.jurisdictionId,
        obligation: req.obligation,
        enforcementDate: req.enforcementDate,
      })),
    };
  });

  // Step 7: Build jurisdiction matrix for each originally-requested jurisdiction
  const matrix: Record<string, JurisdictionResult> = {};

  for (const jurisdictionId of jurisdictions) {
    const jurisdictionObj = await db.getJurisdiction(jurisdictionId);
    const jurisdictionName = jurisdictionObj?.name ?? jurisdictionId;

    const hierIds = await resolveJurisdictionHierarchy([jurisdictionId], db);

    const result = await buildJurisdictionResult(
      jurisdictionId,
      jurisdictionName,
      hierIds,
      parsedIssues,
      requirements,
      regulationSectorCache,
      regulationScopeCache,
      sectorFilter,
      includeOptional,
    );

    matrix[jurisdictionId] = result;
  }

  // Step 8: Summary
  const matrixValues = Object.values(matrix);
  const passing = matrixValues.filter(j => j.status === 'pass').length;
  const failing = matrixValues.filter(j => j.status === 'fail').length;
  const totalMandatoryViolations = matrixValues.reduce((sum, j) => sum + j.mandatoryViolations, 0);
  const totalOptionalViolations = matrixValues.reduce((sum, j) => sum + j.optionalViolations, 0);

  // Phase 07 placeholder — real regulationMatrix population happens in Task 2.
  // Response shape now always includes `regulationMatrix` (REG-04: field present,
  // empty object when no regulations requested or before Task 2 lands).
  const regulationMatrix: Record<string, RegulationMatrixEntry> = {};

  return {
    matrix,
    regulationMatrix,
    annotatedIssues,
    summary: {
      totalJurisdictions: matrixValues.length,
      passing,
      failing,
      totalMandatoryViolations,
      totalOptionalViolations,
    },
  };
}

// ---- Find requirements matching a single parsed issue ----

function findMatchingRegulations(
  parsed: ParsedIssue,
  requirements: readonly RequirementWithRegulation[],
  regulationSectorCache: Map<string, readonly string[]>,
  sectorFilter: readonly string[],
): RequirementWithRegulation[] {
  if (parsed.criterion === null) return [];
  return requirements.filter(req => {
    // Match exact criterion or wildcard '*' (means all criteria under this regulation)
    if (req.wcagCriterion !== parsed.criterion && req.wcagCriterion !== '*') return false;
    if (sectorFilter.length > 0) {
      const regSectors = regulationSectorCache.get(req.regulationId) ?? [];
      if (!regulationMatchesSectors(regSectors, sectorFilter)) return false;
    }
    return true;
  });
}

// ---- Build per-jurisdiction result ----

async function buildJurisdictionResult(
  jurisdictionId: string,
  jurisdictionName: string,
  hierIds: Set<string>,
  parsedIssues: ParsedIssue[],
  requirements: readonly RequirementWithRegulation[],
  regulationSectorCache: Map<string, readonly string[]>,
  regulationScopeCache: Map<string, string>,
  sectorFilter: readonly string[],
  includeOptional: boolean,
): Promise<JurisdictionResult> {
  // Only requirements belonging to this jurisdiction's ancestor chain
  const relevantRequirements = requirements.filter(r => hierIds.has(r.jurisdictionId));

  // Key: regulationId → { representative req, violationsMap }
  type ViolationKey = string; // `${criterion}:${obligation}`
  const regulationViolations = new Map<
    string,
    {
      rep: RequirementWithRegulation;
      violations: Map<ViolationKey, number>;
    }
  >();

  for (const req of relevantRequirements) {
    const sectors = regulationSectorCache.get(req.regulationId) ?? [];
    if (!regulationMatchesSectors(sectors, sectorFilter)) continue;

    if (!regulationViolations.has(req.regulationId)) {
      regulationViolations.set(req.regulationId, { rep: req, violations: new Map() });
    }

    const entry = regulationViolations.get(req.regulationId)!;

    for (const parsed of parsedIssues) {
      if (parsed.criterion === null) continue;
      if (req.wcagCriterion !== parsed.criterion && req.wcagCriterion !== '*') continue;

      // For wildcard requirements, use the actual criterion in the violation key
      const effectiveCriterion = req.wcagCriterion === '*' ? parsed.criterion : req.wcagCriterion;
      const key: ViolationKey = `${effectiveCriterion}:${req.obligation}`;
      entry.violations.set(key, (entry.violations.get(key) ?? 0) + 1);
    }
  }

  // Build per-regulation results
  const regulationResults: RegulationResult[] = [];
  let totalMandatory = 0;
  let totalRecommended = 0;
  let totalOptional = 0;

  for (const [regulationId, { rep, violations }] of regulationViolations) {
    const builtViolations: RegulationResult['violations'][number][] = [];
    let regMandatory = 0;

    for (const [key, count] of violations) {
      const colonIdx = key.lastIndexOf(':');
      const criterion = key.slice(0, colonIdx);
      const obligation = key.slice(colonIdx + 1) as 'mandatory' | 'recommended' | 'optional';

      // Respect includeOptional flag
      if (!includeOptional && obligation === 'optional') continue;

      builtViolations.push({
        wcagCriterion: criterion,
        obligation,
        issueCount: count,
      });

      if (obligation === 'mandatory') {
        totalMandatory += count;
        regMandatory += count;
      } else if (obligation === 'recommended') {
        totalRecommended += count;
      } else {
        totalOptional += count;
      }
    }

    regulationResults.push({
      regulationId,
      regulationName: rep.regulationName,
      shortName: rep.regulationShortName,
      status: regMandatory > 0 ? 'fail' : 'pass',
      enforcementDate: rep.enforcementDate,
      scope: regulationScopeCache.get(regulationId) ?? 'all',
      violations: builtViolations,
    });
  }

  return {
    jurisdictionId,
    jurisdictionName,
    status: totalMandatory > 0 ? 'fail' : 'pass',
    mandatoryViolations: totalMandatory,
    recommendedViolations: totalRecommended,
    optionalViolations: totalOptional,
    regulations: regulationResults,
  };
}
