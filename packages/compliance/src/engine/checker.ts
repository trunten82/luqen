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
  const {
    jurisdictions,
    regulations: requestedRegulations = [],
    issues,
    includeOptional = false,
    sectors: sectorFilter = [],
  } = request;

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

  // Step 3b: Phase 07 (D-08) — look up home jurisdictions for explicit regulations
  // and widen the jurisdiction set so requirement queries include them. Unknown
  // regulation ids are skipped silently (no throw; they are simply absent from
  // the final regulationMatrix — see Step 7b).
  interface RegulationMeta {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly shortName: string;
    readonly homeJurisdictionId: string;
  }
  const explicitRegulationMeta = new Map<string, RegulationMeta>();
  for (const regId of requestedRegulations) {
    const reg = await db.getRegulation(regId);
    if (reg == null) continue; // D-08: unknown regulation → skip silently
    explicitRegulationMeta.set(regId, {
      regulationId: reg.id,
      regulationName: reg.name,
      shortName: reg.shortName,
      homeJurisdictionId: reg.jurisdictionId,
    });
    // Widen: include home jurisdiction (and its ancestors) so requirement query
    // reaches this regulation even when caller did not list the jurisdiction.
    if (!resolvedJurisdictionIds.has(reg.jurisdictionId)) {
      const ancestors = await resolveJurisdictionHierarchy([reg.jurisdictionId], db);
      for (const id of ancestors) resolvedJurisdictionIds.add(id);
    }
  }

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

  // Step 6: Build annotated issues.
  //
  // When the caller explicitly selected regulations[] the per-issue
  // `regulations` array is filtered down to the intersection of (a) the regs
  // that actually apply to the criterion and (b) the explicit selection.
  // Without this filter, Step 3b's jurisdiction widening surfaces sibling
  // regulations the caller did not ask about (e.g. selecting only IT-STANCA
  // would still annotate issues with EAA and WAD because they share Italy's
  // ancestor jurisdictions). Jurisdictions-only requests keep current
  // behaviour — REG-04 byte-identity is locked by the regression snapshot.
  const explicitRegulationFilter =
    requestedRegulations.length > 0 ? new Set(requestedRegulations) : null;

  const annotatedIssues: AnnotatedIssue[] = parsedIssues.map(parsed => {
    const matchingRegs = findMatchingRegulations(
      parsed,
      requirements,
      regulationSectorCache,
      sectorFilter,
    );

    const scopedRegs = explicitRegulationFilter
      ? matchingRegs.filter(req => explicitRegulationFilter.has(req.regulationId))
      : matchingRegs;

    return {
      code: parsed.originalIssue.code,
      wcagCriterion: parsed.criterion ?? parsed.originalIssue.code,
      wcagLevel: parsed.level ?? 'A',
      originalIssue: parsed.originalIssue as unknown as Record<string, unknown>,
      regulations: scopedRegs.map(req => ({
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

  // Step 7b (Phase 07 / REG-03, D-07, D-12): build the regulation matrix for each
  // EXPLICITLY requested regulation. This is additive — the jurisdiction `matrix`
  // and `summary` above are unchanged so REG-04 (byte-for-byte backwards compat
  // for jurisdictions-only callers) holds. Unknown regulation ids were already
  // dropped in Step 3b; they are simply absent here.
  const regulationMatrix: Record<string, RegulationMatrixEntry> = {};
  for (const regId of requestedRegulations) {
    const meta = explicitRegulationMeta.get(regId);
    if (meta == null) continue; // unknown regulation id — skip

    const regReqs = requirements.filter(r => r.regulationId === regId);

    type VKey = string; // `${criterion}:${obligation}`
    const violationsMap = new Map<
      VKey,
      { wcagCriterion: string; obligation: 'mandatory' | 'recommended' | 'optional'; issueCount: number }
    >();
    let mandatory = 0;
    let recommended = 0;
    let optional = 0;

    for (const req of regReqs) {
      for (const parsed of parsedIssues) {
        if (parsed.criterion === null) continue;
        if (req.wcagCriterion !== parsed.criterion && req.wcagCriterion !== '*') continue;

        const effectiveCriterion = req.wcagCriterion === '*' ? parsed.criterion : req.wcagCriterion;
        const obligation = req.obligation;
        // 'excluded' obligations never count as violations
        if (obligation === 'excluded') continue;
        // Respect includeOptional flag (D-12 partial status depends on seeing optionals)
        if (!includeOptional && obligation === 'optional') continue;

        const key: VKey = `${effectiveCriterion}:${obligation}`;
        const existing = violationsMap.get(key);
        if (existing) {
          existing.issueCount += 1;
        } else {
          violationsMap.set(key, {
            wcagCriterion: effectiveCriterion,
            obligation,
            issueCount: 1,
          });
        }

        if (obligation === 'mandatory') mandatory += 1;
        else if (obligation === 'recommended') recommended += 1;
        else optional += 1;
      }
    }

    // D-12 status union: fail (any mandatory) > partial (only recommended/optional) > pass
    const status: 'pass' | 'fail' | 'partial' =
      mandatory > 0
        ? 'fail'
        : (recommended > 0 || optional > 0)
          ? 'partial'
          : 'pass';

    regulationMatrix[regId] = {
      regulationId: meta.regulationId,
      regulationName: meta.regulationName,
      shortName: meta.shortName,
      jurisdictionId: meta.homeJurisdictionId,
      status,
      mandatoryViolations: mandatory,
      recommendedViolations: recommended,
      optionalViolations: optional,
      violatedRequirements: Array.from(violationsMap.values()),
    };
  }

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
