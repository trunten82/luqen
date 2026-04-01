import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { seedBaseline } from '../../src/seed/loader.js';
import { checkCompliance } from '../../src/engine/checker.js';
import type { ComplianceCheckRequest } from '../../src/types.js';

describe('Seed → Check integration', () => {
  let db: SqliteAdapter;

  beforeAll(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
    await seedBaseline(db, { force: true });
  });

  afterAll(async () => {
    await db.close();
  });

  it('EU-WAD has 50 expanded requirements (WCAG 2.1 A+AA)', async () => {
    const reqs = await db.listRequirements({ regulationId: 'EU-WAD' });
    expect(reqs.length).toBe(50);
    expect(reqs.every(r => r.wcagCriterion !== '*')).toBe(true);
  });

  it('US-508 has 38 expanded requirements (WCAG 2.0 A+AA)', async () => {
    const reqs = await db.listRequirements({ regulationId: 'US-508' });
    expect(reqs.length).toBe(38);
  });

  it('DE-BITV inherits EU-WAD plus AAA additions', async () => {
    const reqs = await db.listRequirements({ regulationId: 'DE-BITV' });
    expect(reqs.length).toBe(52); // 50 from EU-WAD + 2 AAA
    const aaa = reqs.filter(r => r.wcagLevel === 'AAA');
    expect(aaa.length).toBe(2);
    expect(aaa.map(r => r.wcagCriterion).sort()).toEqual(['1.2.6', '1.2.8']);
  });

  it('FR-RGAA inherits EU-WAD plus recommended AAA', async () => {
    const reqs = await db.listRequirements({ regulationId: 'FR-RGAA' });
    expect(reqs.length).toBe(51); // 50 from EU-WAD + 1 AAA recommended
    const recommended = reqs.filter(r => r.obligation === 'recommended');
    expect(recommended.length).toBe(1);
    expect(recommended[0].wcagCriterion).toBe('1.4.8');
  });

  it('child regulations that inherit EU-WAD also have 50 requirements', async () => {
    // Check a few random EU member state WAD implementations
    for (const regId of ['AT-WAD', 'IT-WAD', 'SE-WAD']) {
      const reqs = await db.listRequirements({ regulationId: regId });
      expect(reqs.length).toBe(50);
    }
  });

  it('compliance check finds mandatory regulations for contrast issue', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
        type: 'error',
        message: 'Insufficient contrast ratio',
        selector: 'p',
        context: '<p>text</p>',
      }],
    };
    const result = await checkCompliance(request, db);
    expect(result.annotatedIssues.length).toBe(1);
    expect(result.annotatedIssues[0].regulations.length).toBeGreaterThan(0);
    expect(result.annotatedIssues[0].regulations[0].obligation).toBe('mandatory');
  });

  it('compliance check for DE finds more regulations than just EU', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['DE'],
      issues: [{
        code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
        type: 'error',
        message: 'Insufficient contrast',
        selector: 'p',
        context: '<p>text</p>',
      }],
    };
    const result = await checkCompliance(request, db);
    // DE resolves to DE + EU jurisdictions, so should find DE-BITV + EU-WAD + EU-EAA
    const regIds = result.annotatedIssues[0].regulations.map(r => r.regulationId);
    expect(regIds).toContain('DE-BITV');
  });

  it('WCAG criteria table is populated', async () => {
    const criteria = await db.listWcagCriteria();
    expect(criteria.length).toBe(225); // 61 + 78 + 86
  });

  it('force reseed is idempotent', async () => {
    const reqs1 = (await db.listRequirements()).length;
    await seedBaseline(db, { force: true });
    const reqs2 = (await db.listRequirements()).length;
    expect(reqs1).toBe(reqs2);
  });

  it('regulation parentRegulationId is stored', async () => {
    const deBitv = await db.getRegulation('DE-BITV');
    expect(deBitv?.parentRegulationId).toBe('EU-WAD');

    const euWad = await db.getRegulation('EU-WAD');
    expect(euWad?.parentRegulationId).toBeUndefined();
  });
});
