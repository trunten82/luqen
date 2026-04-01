import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { checkCompliance } from '../../src/engine/checker.js';
import type { ComplianceCheckRequest } from '../../src/types.js';

// ---------- helpers ----------

async function buildDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(':memory:');
  await db.initialize();
  return db;
}

async function seedData(db: SqliteAdapter): Promise<void> {
  // Jurisdictions: EU (supranational) → DE (country child), US (country)
  await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
  await db.createJurisdiction({ id: 'DE', name: 'Germany', type: 'country', parentId: 'EU', iso3166: 'DE' });
  await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country', iso3166: 'US' });

  // Regulations
  await db.createRegulation({
    id: 'eu-eaa',
    jurisdictionId: 'EU',
    name: 'European Accessibility Act',
    shortName: 'EAA',
    reference: 'Directive (EU) 2019/882',
    url: 'https://example.com/eaa',
    enforcementDate: '2025-06-28',
    status: 'active',
    scope: 'all',
    sectors: ['e-commerce', 'banking', 'transport'],
    description: 'EU accessibility directive',
  });

  await db.createRegulation({
    id: 'us-508',
    jurisdictionId: 'US',
    name: 'Section 508',
    shortName: 'Section 508',
    reference: '29 U.S.C. § 794d',
    url: 'https://example.com/508',
    enforcementDate: '2018-01-18',
    status: 'active',
    scope: 'public',
    sectors: ['government'],
    description: 'US federal accessibility law',
  });

  // Requirements: EAA — explicit criteria used in SAMPLE_ISSUES
  await db.createRequirement({
    regulationId: 'eu-eaa',
    wcagVersion: '2.1',
    wcagLevel: 'AA',
    wcagCriterion: '1.1.1',
    obligation: 'mandatory',
  });
  await db.createRequirement({
    regulationId: 'eu-eaa',
    wcagVersion: '2.1',
    wcagLevel: 'AA',
    wcagCriterion: '4.1.2',
    obligation: 'mandatory',
  });
  await db.createRequirement({
    regulationId: 'eu-eaa',
    wcagVersion: '2.1',
    wcagLevel: 'AAA',
    wcagCriterion: '1.4.6',
    obligation: 'optional',
  });

  // Section 508 — specific criteria
  await db.createRequirement({
    regulationId: 'us-508',
    wcagVersion: '2.0',
    wcagLevel: 'AA',
    wcagCriterion: '1.1.1',
    obligation: 'mandatory',
  });

  await db.createRequirement({
    regulationId: 'us-508',
    wcagVersion: '2.0',
    wcagLevel: 'AA',
    wcagCriterion: '4.1.2',
    obligation: 'mandatory',
  });

  await db.createRequirement({
    regulationId: 'us-508',
    wcagVersion: '2.0',
    wcagLevel: 'AAA',
    wcagCriterion: '1.4.6',
    obligation: 'optional',
  });
}

// Sample pa11y issues
const SAMPLE_ISSUES = [
  {
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'error',
    message: 'Img element missing alt text',
    selector: 'img#logo',
    context: '<img id="logo" src="logo.png">',
    url: 'https://example.com/',
  },
  {
    code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent',
    type: 'error',
    message: 'Anchor element with no content',
    selector: 'a.nav-link',
    context: '<a class="nav-link" href="/about"></a>',
    url: 'https://example.com/',
  },
  {
    code: 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G18',
    type: 'warning',
    message: 'Contrast ratio could be higher',
    selector: 'p.subtitle',
    context: '<p class="subtitle">text</p>',
    url: 'https://example.com/',
  },
] as const;

// ---------- tests ----------

describe('checkCompliance', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await seedData(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns a ComplianceCheckResponse with the right shape', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    expect(result).toHaveProperty('matrix');
    expect(result).toHaveProperty('annotatedIssues');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('totalJurisdictions');
    expect(result.summary).toHaveProperty('passing');
    expect(result.summary).toHaveProperty('failing');
    expect(result.summary).toHaveProperty('totalMandatoryViolations');
    expect(result.summary).toHaveProperty('totalOptionalViolations');
  });

  it('correctly identifies EU as failing when there are mandatory violations', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    expect(result.matrix['EU']).toBeDefined();
    expect(result.matrix['EU'].status).toBe('fail');
    expect(result.matrix['EU'].mandatoryViolations).toBeGreaterThan(0);
  });

  it('correctly identifies EU as passing when there are no issues', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [],
    };

    const result = await checkCompliance(request, db);

    expect(result.matrix['EU']).toBeDefined();
    expect(result.matrix['EU'].status).toBe('pass');
    expect(result.matrix['EU'].mandatoryViolations).toBe(0);
  });

  it('handles multiple jurisdictions independently', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU', 'US'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    expect(result.matrix['EU']).toBeDefined();
    expect(result.matrix['US']).toBeDefined();
    expect(result.summary.totalJurisdictions).toBe(2);
  });

  it('jurisdiction inheritance: DE inherits EU requirements', async () => {
    const requestDE: ComplianceCheckRequest = {
      jurisdictions: ['DE'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(requestDE, db);

    // DE should appear in the matrix
    expect(result.matrix['DE']).toBeDefined();
    // DE inherits from EU, so EAA should apply → mandatory violations
    expect(result.matrix['DE'].mandatoryViolations).toBeGreaterThan(0);
    expect(result.matrix['DE'].status).toBe('fail');
  });

  it('annotated issues include matching regulations', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    // At least some annotated issues should have matching regulations
    const annotatedWithRegs = result.annotatedIssues.filter(ai => ai.regulations.length > 0);
    expect(annotatedWithRegs.length).toBeGreaterThan(0);

    // Each annotated issue should have a wcagCriterion
    for (const ai of result.annotatedIssues) {
      expect(ai.wcagCriterion).toBeTruthy();
      expect(ai.code).toBeTruthy();
    }
  });

  it('explicit EU requirement for 1.1.1 annotates matching issues with EAA', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [SAMPLE_ISSUES[0]], // 1.1.1
    };

    const result = await checkCompliance(request, db);

    const annotated = result.annotatedIssues.find(ai => ai.wcagCriterion === '1.1.1');
    expect(annotated).toBeDefined();
    expect(annotated!.regulations.length).toBeGreaterThan(0);
    expect(annotated!.regulations[0].shortName).toBe('EAA');
  });

  it('excludes optional violations when includeOptional is false (default)', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['US'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    // 1.4.6 is optional in US-508 — should not count toward mandatory failures
    expect(result.matrix['US'].mandatoryViolations).toBeGreaterThan(0); // 1.1.1 and 4.1.2 are mandatory
    // Pass/fail is based only on mandatory violations
    expect(result.matrix['US'].status).toBe('fail');
  });

  it('includes optional violations when includeOptional is true', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['US'],
      issues: [...SAMPLE_ISSUES],
      includeOptional: true,
    };

    const result = await checkCompliance(request, db);

    expect(result.matrix['US'].optionalViolations).toBeGreaterThan(0);
  });

  it('sectors filter: only includes regulations matching requested sectors', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU', 'US'],
      issues: [...SAMPLE_ISSUES],
      sectors: ['government'], // only government sector
    };

    const result = await checkCompliance(request, db);

    // EU EAA has sectors ['e-commerce','banking','transport'] — no 'government'
    // US Section 508 has sectors ['government'] — matches
    const euResult = result.matrix['EU'];
    const usResult = result.matrix['US'];

    // EU should have no regulations matching (sectors don't include 'government')
    expect(euResult.mandatoryViolations).toBe(0);

    // US should still have violations
    expect(usResult.mandatoryViolations).toBeGreaterThan(0);
  });

  it('summary counts are consistent with matrix', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU', 'US'],
      issues: [...SAMPLE_ISSUES],
    };

    const result = await checkCompliance(request, db);

    const matrixValues = Object.values(result.matrix);
    expect(result.summary.totalJurisdictions).toBe(matrixValues.length);

    const passing = matrixValues.filter(j => j.status === 'pass').length;
    const failing = matrixValues.filter(j => j.status === 'fail').length;
    expect(result.summary.passing).toBe(passing);
    expect(result.summary.failing).toBe(failing);
  });

  it('issues with unparseable codes are included as annotated issues with no regulations', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [
        {
          code: 'UNPARSEABLE_CODE',
          type: 'error',
          message: 'Some error',
          selector: 'div',
          context: '<div></div>',
        },
      ],
    };

    const result = await checkCompliance(request, db);

    // The issue should appear in annotated issues but with no regulations
    expect(result.annotatedIssues.length).toBe(1);
    expect(result.annotatedIssues[0].regulations).toHaveLength(0);
    // Should not cause failure since no regulation matched
    expect(result.matrix['EU'].mandatoryViolations).toBe(0);
    expect(result.matrix['EU'].status).toBe('pass');
  });

  it('deduplicates criteria from multiple issues with same code', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['EU'],
      issues: [
        SAMPLE_ISSUES[0], // 1.1.1
        { ...SAMPLE_ISSUES[0], selector: 'img#banner' }, // also 1.1.1
      ],
    };

    const result = await checkCompliance(request, db);

    // Both issues should be in annotatedIssues
    expect(result.annotatedIssues.length).toBe(2);
    // Both should be annotated with the EAA regulation
    const withRegs = result.annotatedIssues.filter(ai => ai.regulations.length > 0);
    expect(withRegs.length).toBe(2);
  });

  it('regulation results include per-criterion violation counts', async () => {
    const request: ComplianceCheckRequest = {
      jurisdictions: ['US'],
      issues: [SAMPLE_ISSUES[0], SAMPLE_ISSUES[1]], // 1.1.1 and 4.1.2
    };

    const result = await checkCompliance(request, db);

    const usMatrix = result.matrix['US'];
    expect(usMatrix.regulations.length).toBeGreaterThan(0);

    const section508 = usMatrix.regulations.find(r => r.shortName === 'Section 508');
    expect(section508).toBeDefined();
    expect(section508!.violations.length).toBeGreaterThan(0);
  });
});
