import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  seedBaseline,
  getSeedStatus,
  expandWildcard,
  resolveInheritance,
  topologicalSortRegulations,
} from '../../src/seed/loader.js';
import type { CreateRequirementInput } from '../../src/types.js';

// Load wcag criteria for pure function tests
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const allCriteria = require('../../src/seed/wcag-criteria.json') as Array<{
  version: string;
  level: string;
  criterion: string;
  title: string;
}>;

describe('expandWildcard', () => {
  it('expands * at AA for WCAG 2.1 to all A + AA criteria', () => {
    const result = expandWildcard('2.1', 'AA', allCriteria);
    // WCAG 2.1 has 30 A + 20 AA = 50 criteria at AA level
    expect(result.length).toBe(50);
    expect(result.every((c) => c.version === '2.1')).toBe(true);
    expect(result.every((c) => c.level === 'A' || c.level === 'AA')).toBe(true);
  });

  it('expands * at A for WCAG 2.0 to only A criteria', () => {
    const result = expandWildcard('2.0', 'A', allCriteria);
    expect(result.length).toBe(25);
    expect(result.every((c) => c.level === 'A')).toBe(true);
  });

  it('does not include AAA when expanding AA', () => {
    const result = expandWildcard('2.1', 'AA', allCriteria);
    expect(result.some((c) => c.level === 'AAA')).toBe(false);
  });
});

describe('resolveInheritance', () => {
  const parentReqs: CreateRequirementInput[] = [
    {
      regulationId: 'PARENT',
      wcagVersion: '2.1',
      wcagLevel: 'A',
      wcagCriterion: '1.1.1',
      obligation: 'mandatory',
    },
    {
      regulationId: 'PARENT',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '1.4.3',
      obligation: 'mandatory',
    },
  ];

  it('child inherits all parent requirements with new regulationId', () => {
    const result = resolveInheritance(parentReqs, [], 'CHILD');
    expect(result.length).toBe(2);
    expect(result.every((r) => r.regulationId === 'CHILD')).toBe(true);
  });

  it('child override replaces parent obligation', () => {
    const overrides: CreateRequirementInput[] = [
      {
        regulationId: 'CHILD',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.4.3',
        obligation: 'recommended',
      },
    ];
    const result = resolveInheritance(parentReqs, overrides, 'CHILD');
    const c143 = result.find((r) => r.wcagCriterion === '1.4.3');
    expect(c143?.obligation).toBe('recommended');
  });

  it('excluded obligation removes criterion', () => {
    const overrides: CreateRequirementInput[] = [
      {
        regulationId: 'CHILD',
        wcagVersion: '2.1',
        wcagLevel: 'A',
        wcagCriterion: '1.1.1',
        obligation: 'excluded',
      },
    ];
    const result = resolveInheritance(parentReqs, overrides, 'CHILD');
    expect(result.length).toBe(1);
    expect(result.find((r) => r.wcagCriterion === '1.1.1')).toBeUndefined();
  });

  it('child adds new criterion not in parent', () => {
    const overrides: CreateRequirementInput[] = [
      {
        regulationId: 'CHILD',
        wcagVersion: '2.2',
        wcagLevel: 'AA',
        wcagCriterion: '3.3.7',
        obligation: 'recommended',
      },
    ];
    const result = resolveInheritance(parentReqs, overrides, 'CHILD');
    expect(result.length).toBe(3);
  });
});

describe('topologicalSortRegulations', () => {
  it('parents before children', () => {
    const regs = [
      { id: 'CHILD', parentRegulationId: 'PARENT' },
      { id: 'PARENT' },
    ];
    const sorted = topologicalSortRegulations(regs);
    const parentIdx = sorted.findIndex((r) => r.id === 'PARENT');
    const childIdx = sorted.findIndex((r) => r.id === 'CHILD');
    expect(parentIdx).toBeLessThan(childIdx);
  });
});

describe('seedBaseline', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  it('force mode produces expanded requirements with no wildcards', async () => {
    await seedBaseline(db, { force: true });
    const allReqs = await db.listRequirements();
    expect(allReqs.every((r) => r.wcagCriterion !== '*')).toBe(true);
    expect(allReqs.length).toBeGreaterThan(100);
  });

  it('EU-WAD has 50 expanded requirements (2.1 A+AA)', async () => {
    await seedBaseline(db, { force: true });
    const reqs = await db.listRequirements({ regulationId: 'EU-WAD' });
    expect(reqs.length).toBe(50);
  });

  it('US-508 has 38 expanded requirements (2.0 A+AA)', async () => {
    await seedBaseline(db, { force: true });
    const reqs = await db.listRequirements({ regulationId: 'US-508' });
    expect(reqs.length).toBe(38);
  });

  it('DE-BITV inherits EU-WAD + AAA additions', async () => {
    await seedBaseline(db, { force: true });
    const reqs = await db.listRequirements({ regulationId: 'DE-BITV' });
    expect(reqs.length).toBe(52); // 50 from EU-WAD + 2 AAA
    const aaa = reqs.filter((r) => r.wcagLevel === 'AAA');
    expect(aaa.length).toBe(2);
  });

  it('force mode is idempotent', async () => {
    const r1 = await seedBaseline(db, { force: true });
    const r2 = await seedBaseline(db, { force: true });
    expect(r1.requirements).toBe(r2.requirements);
  });

  // Retained existing tests
  describe('getSeedStatus', () => {
    it('returns zero counts before seeding', async () => {
      const status = await getSeedStatus(db);
      expect(status.seeded).toBe(false);
      expect(status.jurisdictions).toBe(0);
      expect(status.regulations).toBe(0);
      expect(status.requirements).toBe(0);
      expect(status.sources).toBe(0);
      expect(status.wcagCriteria).toBe(0);
    });
  });

  it('creates all jurisdictions, regulations, requirements', async () => {
    await seedBaseline(db);

    const status = await getSeedStatus(db);
    expect(status.seeded).toBe(true);
    expect(status.jurisdictions).toBeGreaterThanOrEqual(8);
    expect(status.regulations).toBeGreaterThanOrEqual(8);
    expect(status.requirements).toBeGreaterThanOrEqual(8);
    expect(status.wcagCriteria).toBe(225);
  });

  it('creates expected jurisdictions including EU, US, UK', async () => {
    await seedBaseline(db);

    const eu = await db.getJurisdiction('EU');
    const us = await db.getJurisdiction('US');
    const uk = await db.getJurisdiction('UK');

    expect(eu).not.toBeNull();
    expect(eu!.type).toBe('supranational');
    expect(us).not.toBeNull();
    expect(us!.type).toBe('country');
    expect(uk).not.toBeNull();
  });

  it('creates DE and FR as children of EU', async () => {
    await seedBaseline(db);

    const de = await db.getJurisdiction('DE');
    const fr = await db.getJurisdiction('FR');

    expect(de!.parentId).toBe('EU');
    expect(fr!.parentId).toBe('EU');
  });

  it('creates EU EAA and WAD regulations', async () => {
    await seedBaseline(db);

    const regs = await db.listRegulations({ jurisdictionId: 'EU' });
    const shortNames = regs.map((r) => r.shortName);
    expect(shortNames).toContain('EAA');
    expect(shortNames).toContain('WAD');
  });

  it('seeds monitored sources from regulation URLs', async () => {
    await seedBaseline(db);

    const sources = await db.listSources();
    expect(sources.length).toBeGreaterThanOrEqual(2);

    const urls = sources.map((s) => s.url);
    expect(urls).toContain(
      'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0882',
    );
    expect(urls).toContain(
      'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016L2102',
    );

    for (const source of sources) {
      expect(source.type).toBe('html');
      expect(source.schedule).toBe('weekly');
    }
  });

  it('is idempotent — running twice does not create duplicates', async () => {
    await seedBaseline(db);
    await seedBaseline(db);

    const status = await getSeedStatus(db);
    const statusAfterFirst = await getSeedStatus(db);
    expect(status.jurisdictions).toBe(statusAfterFirst.jurisdictions);
    expect(status.regulations).toBe(statusAfterFirst.regulations);
    expect(status.requirements).toBe(statusAfterFirst.requirements);
    expect(status.sources).toBe(statusAfterFirst.sources);
  });

  it('creates requirements with correct WCAG versions', async () => {
    await seedBaseline(db);

    const regs508 = await db.listRegulations({ jurisdictionId: 'US' });
    const section508 = regs508.find((r) => r.shortName === 'Section 508');
    expect(section508).toBeDefined();

    const reqs = await db.listRequirements({ regulationId: section508!.id });
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs[0].wcagVersion).toBe('2.0');
  });
});
