import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { DbAdapter } from '../db/adapter.js';
import type {
  BaselineSeedData,
  CreateRequirementInput,
  CreateRegulationInput,
  CreateJurisdictionInput,
} from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WcagCriterionEntry {
  readonly version: string;
  readonly level: string;
  readonly criterion: string;
  readonly title: string;
  readonly description?: string;
  readonly url?: string;
}

type RegulationWithParent = CreateRegulationInput & { id?: string };

const LEVEL_ORDER: Record<string, number> = { A: 1, AA: 2, AAA: 3 };

function loadBaselineData(): BaselineSeedData {
  const require = createRequire(import.meta.url);
  const jsonPath = join(__dirname, 'baseline.json');
  return require(jsonPath) as BaselineSeedData;
}

function loadWcagCriteria(): WcagCriterionEntry[] {
  const require = createRequire(import.meta.url);
  const jsonPath = join(__dirname, 'wcag-criteria.json');
  return require(jsonPath) as WcagCriterionEntry[];
}

// ============================================================
// Pure exported functions
// ============================================================

/**
 * Expands a wildcard into concrete criteria entries.
 * Returns all entries for the given version where level <= wcagLevel.
 */
export function expandWildcard(
  wcagVersion: string,
  wcagLevel: string,
  allCriteria: WcagCriterionEntry[],
): WcagCriterionEntry[] {
  const maxLevelOrder = LEVEL_ORDER[wcagLevel] ?? 1;
  return allCriteria.filter(
    (c) => c.version === wcagVersion && (LEVEL_ORDER[c.level] ?? 0) <= maxLevelOrder,
  );
}

/**
 * Resolves inheritance: child inherits parent requirements with the child's
 * regulationId, overrides replace parent entries for the same criterion key,
 * and entries with obligation === 'excluded' are removed.
 */
export function resolveInheritance(
  parentReqs: CreateRequirementInput[],
  childOverrides: CreateRequirementInput[],
  regulationId: string,
): CreateRequirementInput[] {
  const makeKey = (r: CreateRequirementInput): string =>
    `${r.wcagVersion}:${r.wcagCriterion}`;

  // Copy parent reqs with child's regulationId
  const map = new Map<string, CreateRequirementInput>(
    parentReqs.map((r) => [makeKey(r), { ...r, regulationId }]),
  );

  // Apply child overrides
  for (const override of childOverrides) {
    const key = makeKey(override);
    map.set(key, { ...override, regulationId });
  }

  // Remove excluded entries
  return Array.from(map.values()).filter((r) => r.obligation !== 'excluded');
}

/**
 * Topological sort: parents before children, standalone regulations first.
 */
export function topologicalSortRegulations(
  regulations: Array<{ id?: string; parentRegulationId?: string }>,
): Array<{ id?: string; parentRegulationId?: string }> {
  const idToReg = new Map(regulations.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const result: Array<{ id?: string; parentRegulationId?: string }> = [];

  function visit(reg: { id?: string; parentRegulationId?: string }): void {
    if (reg.id == null || visited.has(reg.id)) return;
    // Visit parent first
    if (reg.parentRegulationId != null) {
      const parent = idToReg.get(reg.parentRegulationId);
      if (parent != null) {
        visit(parent);
      }
    }
    visited.add(reg.id);
    result.push(reg);
  }

  for (const reg of regulations) {
    visit(reg);
  }

  return result;
}

// ============================================================
// Seed status and result
// ============================================================

export interface SeedStatus {
  readonly seeded: boolean;
  readonly jurisdictions: number;
  readonly regulations: number;
  readonly requirements: number;
  readonly sources: number;
  readonly wcagCriteria: number;
}

export interface SeedResult {
  readonly jurisdictions: number;
  readonly regulations: number;
  readonly requirements: number;
  readonly sources: number;
  readonly wcagCriteria: number;
}

export async function getSeedStatus(db: DbAdapter): Promise<SeedStatus> {
  const [jurisdictions, regulations, requirements, sources, wcagCriteriaList] = await Promise.all([
    db.listJurisdictions(),
    db.listRegulations(),
    db.listRequirements(),
    db.listSources(),
    db.listWcagCriteria(),
  ]);

  const j = jurisdictions.length;
  const reg = regulations.length;
  const req = requirements.length;
  const src = sources.length;
  const wcag = wcagCriteriaList.length;

  return {
    seeded: j > 0 && reg > 0 && req > 0,
    jurisdictions: j,
    regulations: reg,
    requirements: req,
    sources: src,
    wcagCriteria: wcag,
  };
}

// ============================================================
// Main seed function
// ============================================================

export async function seedBaseline(
  db: DbAdapter,
  options: { force?: boolean } = {},
): Promise<SeedResult> {
  const { force = false } = options;
  const data = loadBaselineData();
  const allCriteria = loadWcagCriteria();

  // Snapshot admin-mutable state for every system table the force-reseed will
  // wipe, so the operator's edits survive a compliance restart. See
  // `.planning/audits/v3.3.0-reseed-safety.md` for the column-by-column
  // justification.
  //
  // Sources: stable key = url (id regenerates on createSource).
  // Regulations + jurisdictions: stable key = id (baseline ids are deterministic).
  const sourceStateByUrl = new Map<string, { managementMode: string; status: string }>();
  const regulationStateById = new Map<
    string,
    {
      name: string;
      shortName: string;
      enforcementDate: string;
      status: string;
      scope: string;
    }
  >();
  const jurisdictionStateById = new Map<
    string,
    { name: string; type: string; parentId: string | undefined }
  >();
  if (force) {
    const existingSources = await db.listSources();
    for (const s of existingSources) {
      sourceStateByUrl.set(s.url, {
        managementMode: s.managementMode ?? 'manual',
        status: s.status ?? 'active',
      });
    }
    const existingRegulations = await db.listRegulations();
    for (const r of existingRegulations) {
      regulationStateById.set(r.id, {
        name: r.name,
        shortName: r.shortName,
        enforcementDate: r.enforcementDate,
        status: r.status,
        scope: r.scope,
      });
    }
    const existingJurisdictions = await db.listJurisdictions();
    for (const j of existingJurisdictions) {
      jurisdictionStateById.set(j.id, {
        name: j.name,
        type: j.type,
        parentId: j.parentId,
      });
    }
  }

  // In force mode, delete everything in dependency order
  if (force) {
    await db.deleteAllSystemRequirements();
    await db.deleteAllSystemRegulations();
    await db.deleteAllSystemJurisdictions();
    await db.deleteAllSystemWcagCriteria();
    await db.deleteAllSystemSources();
  }

  // 1. Bulk insert WCAG criteria
  await db.bulkCreateWcagCriteria(allCriteria);

  // 2. Upsert jurisdictions (parents first)
  const sortedJurisdictions = [...data.jurisdictions].sort((a, b) => {
    const aHasParent = a.parentId != null ? 1 : 0;
    const bHasParent = b.parentId != null ? 1 : 0;
    return aHasParent - bHasParent;
  });

  for (const jurisdiction of sortedJurisdictions) {
    const jId = jurisdiction.id;
    if (jId == null) continue;
    const existing = await db.getJurisdiction(jId);
    if (existing == null) {
      await db.createJurisdiction(jurisdiction);
      // Restore admin-mutated columns captured before the force-reseed wipe.
      const prior = jurisdictionStateById.get(jId);
      if (prior !== undefined) {
        const drift: {
          -readonly [K in keyof CreateJurisdictionInput]?: CreateJurisdictionInput[K];
        } = {};
        if (prior.name !== jurisdiction.name) drift.name = prior.name;
        if (prior.type !== jurisdiction.type) {
          drift.type = prior.type as 'supranational' | 'country' | 'state';
        }
        if (prior.parentId !== jurisdiction.parentId && prior.parentId !== undefined) {
          drift.parentId = prior.parentId;
        }
        if (Object.keys(drift).length > 0) {
          await db.updateJurisdiction(jId, drift);
        }
      }
    }
  }

  // 3. Topological sort regulations, upsert each
  const sortedRegulations = topologicalSortRegulations(
    data.regulations as RegulationWithParent[],
  ) as CreateRegulationInput[];

  for (const regulation of sortedRegulations) {
    const rId = regulation.id;
    if (rId == null) continue;
    const existing = await db.getRegulation(rId);
    if (existing == null) {
      await db.createRegulation(regulation);
      // Restore admin-mutated columns captured before the force-reseed wipe.
      const prior = regulationStateById.get(rId);
      if (prior !== undefined) {
        const drift: {
          -readonly [K in keyof CreateRegulationInput]?: CreateRegulationInput[K];
        } = {};
        if (prior.name !== regulation.name) drift.name = prior.name;
        if (prior.shortName !== regulation.shortName) drift.shortName = prior.shortName;
        if (prior.enforcementDate !== regulation.enforcementDate) {
          drift.enforcementDate = prior.enforcementDate;
        }
        if (prior.status !== regulation.status) {
          drift.status = prior.status as 'active' | 'draft' | 'repealed';
        }
        if (prior.scope !== regulation.scope) {
          drift.scope = prior.scope as 'public' | 'private' | 'all';
        }
        if (Object.keys(drift).length > 0) {
          await db.updateRegulation(rId, drift);
        }
      }
    }
  }

  // 4. Build expanded requirements per regulation
  // Map from regulationId -> expanded requirements (after wildcard expansion + inheritance)
  const expandedMap = new Map<string, CreateRequirementInput[]>();

  // Index raw requirements by regulationId
  const rawByRegulation = new Map<string, CreateRequirementInput[]>();
  for (const req of data.requirements) {
    const existing = rawByRegulation.get(req.regulationId) ?? [];
    rawByRegulation.set(req.regulationId, [...existing, req]);
  }

  // Process in topological order so parent expansions are ready for children
  let totalRequirements = 0;

  for (const regulation of sortedRegulations) {
    const regId = regulation.id;
    if (regId == null) continue;

    const rawReqs = rawByRegulation.get(regId) ?? [];
    const parentRegId = regulation.parentRegulationId;

    let expandedReqs: CreateRequirementInput[];

    if (parentRegId != null && expandedMap.has(parentRegId)) {
      // Expand child's raw overrides first (resolve wildcards)
      const expandedOverrides = expandRawRequirements(rawReqs, allCriteria, regId);
      const parentExpanded = expandedMap.get(parentRegId)!;
      expandedReqs = resolveInheritance(parentExpanded, expandedOverrides, regId);
    } else {
      expandedReqs = expandRawRequirements(rawReqs, allCriteria, regId);
    }

    expandedMap.set(regId, expandedReqs);

    // Insert expanded requirements (skip if already exist — idempotent mode)
    if (expandedReqs.length > 0) {
      const existingReqs = await db.listRequirements({ regulationId: regId });
      if (existingReqs.length === 0) {
        await db.bulkCreateRequirements(expandedReqs);
        totalRequirements += expandedReqs.length;
      } else {
        totalRequirements += existingReqs.length;
      }
    }
  }

  // 5. Upsert monitored sources
  let sourcesCount = 0;
  if (data.sources) {
    const existingSources = await db.listSources();
    for (const source of data.sources) {
      const alreadyExists = existingSources.some((s) => s.url === source.url);
      if (!alreadyExists) {
        const created = await db.createSource(source);
        // Restore admin-mutated state captured before the force-reseed wipe.
        const prior = sourceStateByUrl.get(source.url);
        if (prior !== undefined) {
          if (prior.managementMode !== 'manual') {
            await db.updateSourceManagementMode(created.id, prior.managementMode as 'llm' | 'manual');
          }
          if (prior.status !== 'active') {
            await db.updateSourceStatus(created.id, prior.status as 'active' | 'degraded');
          }
        }
      }
      sourcesCount++;
    }
    sourcesCount = (await db.listSources()).length;
  }

  const finalJurisdictions = await db.listJurisdictions();
  const finalRegulations = await db.listRegulations();
  const finalWcag = await db.listWcagCriteria();

  return {
    jurisdictions: finalJurisdictions.length,
    regulations: finalRegulations.length,
    requirements: totalRequirements,
    sources: sourcesCount,
    wcagCriteria: finalWcag.length,
  };
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Expands raw requirements for a regulation — replacing wildcard entries
 * with one concrete entry per matching WCAG criterion.
 */
function expandRawRequirements(
  rawReqs: CreateRequirementInput[],
  allCriteria: WcagCriterionEntry[],
  regulationId: string,
): CreateRequirementInput[] {
  const result: CreateRequirementInput[] = [];

  for (const req of rawReqs) {
    if (req.wcagCriterion === '*') {
      const matches = expandWildcard(req.wcagVersion, req.wcagLevel, allCriteria);
      for (const criterion of matches) {
        result.push({
          regulationId,
          wcagVersion: criterion.version as '2.0' | '2.1' | '2.2',
          wcagLevel: criterion.level as 'A' | 'AA' | 'AAA',
          wcagCriterion: criterion.criterion,
          obligation: req.obligation,
          notes: req.notes,
        });
      }
    } else {
      result.push({ ...req, regulationId });
    }
  }

  return result;
}
