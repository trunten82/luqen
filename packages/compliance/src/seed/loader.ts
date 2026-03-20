import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { DbAdapter } from '../db/adapter.js';
import type { BaselineSeedData } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadBaselineData(): BaselineSeedData {
  // Use createRequire to load the JSON file relative to this module
  const require = createRequire(import.meta.url);
  const jsonPath = join(__dirname, 'baseline.json');
  return require(jsonPath) as BaselineSeedData;
}

export interface SeedStatus {
  readonly seeded: boolean;
  readonly jurisdictions: number;
  readonly regulations: number;
  readonly requirements: number;
  readonly sources: number;
}

export async function getSeedStatus(db: DbAdapter): Promise<SeedStatus> {
  const [jurisdictions, regulations, requirements, sources] = await Promise.all([
    db.listJurisdictions(),
    db.listRegulations(),
    db.listRequirements(),
    db.listSources(),
  ]);

  const j = jurisdictions.length;
  const reg = regulations.length;
  const req = requirements.length;
  const src = sources.length;

  return {
    seeded: j > 0 && reg > 0 && req > 0,
    jurisdictions: j,
    regulations: reg,
    requirements: req,
    sources: src,
  };
}

export async function seedBaseline(db: DbAdapter): Promise<void> {
  const data = loadBaselineData();

  // Upsert jurisdictions — check existence before creating
  // Insert parents first, then children (sort: no parentId first)
  const sorted = [...data.jurisdictions].sort((a, b) => {
    const aHasParent = a.parentId != null ? 1 : 0;
    const bHasParent = b.parentId != null ? 1 : 0;
    return aHasParent - bHasParent;
  });

  for (const jurisdiction of sorted) {
    const jId = jurisdiction.id;
    if (jId == null) continue;
    const existing = await db.getJurisdiction(jId);
    if (existing == null) {
      await db.createJurisdiction(jurisdiction);
    }
  }

  // Upsert regulations
  for (const regulation of data.regulations) {
    const rId = regulation.id;
    if (rId == null) continue;
    const existing = await db.getRegulation(rId);
    if (existing == null) {
      await db.createRegulation(regulation);
    }
  }

  // Upsert requirements — identify by (regulationId, wcagCriterion, wcagVersion, wcagLevel)
  for (const requirement of data.requirements) {
    const existing = await db.listRequirements({ regulationId: requirement.regulationId });
    const alreadyExists = existing.some(
      (r) =>
        r.wcagCriterion === requirement.wcagCriterion &&
        r.wcagVersion === requirement.wcagVersion &&
        r.wcagLevel === requirement.wcagLevel,
    );
    if (!alreadyExists) {
      await db.createRequirement(requirement);
    }
  }

  // Upsert monitored sources
  if (data.sources) {
    const existingSources = await db.listSources();
    for (const source of data.sources) {
      const alreadyExists = existingSources.some((s) => s.url === source.url);
      if (!alreadyExists) {
        await db.createSource(source);
      }
    }
  }
}
