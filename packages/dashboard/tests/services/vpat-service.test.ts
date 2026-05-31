import { describe, it, expect } from 'vitest';
import { buildVpat, type VpatScanInput } from '../../src/services/vpat-service.js';
import type { normalizeReportData } from '../../src/services/report-service.js';
import type { ManualTestResult } from '../../src/manual-criteria.js';

// normalizeReportData returns an inferred type; derive the shapes locally so the
// test does not depend on named exports the service does not provide.
type NormalizedReportData = ReturnType<typeof normalizeReportData>;
type IssueGroup = NormalizedReportData['allIssueGroups'][number];

const GEN_AT = '2026-05-30';

function makeGroup(
  partial: { criterion: string } & Partial<{
    title: string;
    wcagUrl: string;
    count: number;
    warningCount: number;
    noticeCount: number;
    errorCount: number;
    pageCount: number;
    regulations: Array<{ shortName: string }>;
    components: string[];
  }>,
): IssueGroup {
  return {
    title: 'Some criterion',
    wcagUrl: 'https://example.com',
    count: 0,
    warningCount: 0,
    noticeCount: 0,
    errorCount: 0,
    pageCount: 0,
    regulations: [],
    components: [],
    ...partial,
  } as unknown as IssueGroup;
}

function makeReport(groups: IssueGroup[]): NormalizedReportData {
  return {
    summary: { pagesScanned: 3, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
    allIssueGroups: groups,
    topActionItems: [],
    templateComponents: [],
    complianceMatrix: null,
    errors: [],
  } as unknown as NormalizedReportData;
}

function makeManual(criterionId: string, status: ManualTestResult['status']): ManualTestResult {
  return {
    id: `m-${criterionId}`,
    scanId: 'scan-1',
    criterionId,
    status,
    notes: null,
    testedBy: null,
    testedAt: null,
    orgId: 'system',
  };
}

const scanAA: VpatScanInput = { siteUrl: 'https://example.com', standard: 'WCAG2AA' };

describe('buildVpat', () => {
  it('marks a criterion with errors as Does Not Support', () => {
    const report = makeReport([
      makeGroup({ criterion: '1.1.1', errorCount: 4, pageCount: 2 }),
    ]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel
      .flatMap((t) => t.rows)
      .find((r) => r.criterion === '1.1.1');
    expect(row?.conformance).toBe('Does Not Support');
    expect(row?.remarks).toContain('4 errors');
    expect(row?.remarks).toContain('2 pages');
  });

  it('appends regulation shortNames to a Does Not Support remark', () => {
    const report = makeReport([
      makeGroup({
        criterion: '1.4.3',
        errorCount: 1,
        pageCount: 1,
        regulations: [{ shortName: 'EAA' }, { shortName: 'Section 508' }],
      }),
    ]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.4.3');
    expect(row?.remarks).toContain('EAA');
    expect(row?.remarks).toContain('Section 508');
  });

  it('marks a criterion with warnings only as Partially Supports', () => {
    const report = makeReport([
      makeGroup({ criterion: '1.4.3', warningCount: 2, pageCount: 1 }),
    ]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.4.3');
    expect(row?.conformance).toBe('Partially Supports');
  });

  it('marks an absent FULLY-automatable criterion as Supports', () => {
    // 1.4.3 (Contrast) is not in MANUAL_CRITERIA at all → fully machine-verifiable.
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.4.3');
    expect(row?.conformance).toBe('Supports');
    expect(row?.remarks).toContain('machine-verifiable');
  });

  it('marks an absent non-automatable criterion as Not Evaluated', () => {
    // 1.2.1 has automatable === 'none' in MANUAL_CRITERIA.
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.2.1');
    expect(row?.conformance).toBe('Not Evaluated');
    expect(row?.remarks).toContain('manual evaluation');
  });

  it('CONSERVATIVE: marks an absent PARTIALLY-automatable criterion as Not Evaluated, never Supports', () => {
    // 1.1.1 has automatable === 'partial' in MANUAL_CRITERIA — Pa11y sees
    // whether alt text exists but not whether it is meaningful. A clean scan
    // must NOT claim Supports (legal over-claim). It is Not Evaluated until a
    // human records a manual pass.
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.1.1');
    expect(row?.conformance).toBe('Not Evaluated');
    expect(row?.conformance).not.toBe('Supports');
  });

  it('a manual pass upgrades a partially-automatable criterion with no findings to Supports', () => {
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.1.1', 'pass')], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.1.1');
    expect(row?.conformance).toBe('Supports');
    expect(row?.remarks).toContain('Verified by manual testing');
  });

  it('marks a manual "na" result as Not Applicable even with automated findings', () => {
    const report = makeReport([
      makeGroup({ criterion: '1.1.1', errorCount: 5, pageCount: 3 }),
    ]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.1.1', 'na')], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.1.1');
    expect(row?.conformance).toBe('Not Applicable');
  });

  it('marks manual "fail" on a clean automated criterion as Does Not Support', () => {
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.2.1', 'fail')], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.2.1');
    expect(row?.conformance).toBe('Does Not Support');
    expect(row?.remarks).toContain('Failed manual testing');
  });

  it('marks manual "pass" on a clean automated criterion as Supports (manual remark)', () => {
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.2.1', 'pass')], { generatedAt: GEN_AT });
    const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === '1.2.1');
    expect(row?.conformance).toBe('Supports');
    expect(row?.remarks).toContain('Verified by manual testing');
  });

  it('produces a summary whose counts add up to the total', () => {
    const report = makeReport([
      makeGroup({ criterion: '1.1.1', errorCount: 1, pageCount: 1 }),
      makeGroup({ criterion: '1.4.3', warningCount: 1, pageCount: 1 }),
    ]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.2.2', 'na')], { generatedAt: GEN_AT });
    const s = vpat.summary;
    expect(s.supports + s.partial + s.doesNotSupport + s.notApplicable + s.notEvaluated).toBe(s.total);
    const tableRowCount = vpat.tablesByLevel.reduce((acc, t) => acc + t.rows.length, 0);
    expect(s.total).toBe(tableRowCount);
  });

  it('excludes AAA rows for an AA scan and includes them for an AAA scan', () => {
    const report = makeReport([]);
    const vpatAA = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    expect(vpatAA.tablesByLevel.some((t) => t.level === 'AAA')).toBe(false);
    expect(vpatAA.tablesByLevel.some((t) => t.level === 'A')).toBe(true);
    expect(vpatAA.tablesByLevel.some((t) => t.level === 'AA')).toBe(true);

    const vpatAAA = buildVpat(
      report,
      { siteUrl: 'https://example.com', standard: 'WCAG2AAA' },
      [],
      { generatedAt: GEN_AT },
    );
    expect(vpatAAA.tablesByLevel.some((t) => t.level === 'AAA')).toBe(true);
    expect(vpatAAA.summary.total).toBeGreaterThan(vpatAA.summary.total);
  });

  it('sorts criteria numerically within a level (1.4.10 after 1.4.2)', () => {
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const aaRows = vpat.tablesByLevel.find((t) => t.level === 'AA')?.rows ?? [];
    const idx2 = aaRows.findIndex((r) => r.criterion === '1.4.2');
    const idx10 = aaRows.findIndex((r) => r.criterion === '1.4.10');
    // 1.4.2 is level AA, 1.4.10 is level AA — both present; 1.4.10 must come after 1.4.4 etc.
    const idx4 = aaRows.findIndex((r) => r.criterion === '1.4.4');
    expect(idx4).toBeGreaterThanOrEqual(0);
    expect(idx10).toBeGreaterThan(idx4);
    // (1.4.2 is level A in the catalog, so may be absent from the AA table; guard accordingly)
    if (idx2 >= 0) expect(idx10).toBeGreaterThan(idx2);
  });

  it('uses the injected generatedAt deterministically', () => {
    const vpat = buildVpat(makeReport([]), scanAA, [], { generatedAt: GEN_AT });
    expect(vpat.generatedAt).toBe(GEN_AT);
  });

  it('attaches a conservative Section 508 functional-performance table', () => {
    // Clean scan → every functional need "Not Evaluated", never "Supports".
    const clean = buildVpat(makeReport([]), scanAA, [], { generatedAt: GEN_AT });
    expect(clean.section508.functionalPerformance).toHaveLength(9);
    expect(
      clean.section508.functionalPerformance.every((f) => f.conformance !== 'Supports'),
    ).toBe(true);

    // A WCAG failure for 1.1.1 escalates 302.1 (Without vision) to Does Not Support.
    const failing = buildVpat(
      makeReport([makeGroup({ criterion: '1.1.1', errorCount: 2, pageCount: 1 })]),
      scanAA,
      [],
      { generatedAt: GEN_AT },
    );
    const withoutVision = failing.section508.functionalPerformance.find((f) => f.id === '302.1');
    expect(withoutVision?.conformance).toBe('Does Not Support');
    expect(withoutVision?.remarks).toContain('1.1.1');
  });

  it('defaults remediation to null and passes through a supplied record', () => {
    const noRem = buildVpat(makeReport([]), scanAA, [], { generatedAt: GEN_AT });
    expect(noRem.remediation).toBeNull();

    const record = {
      events: [{ date: '2026-05-01', type: 'ai-proposed' as const, criterion: '1.1.1', detail: 'PR #5', actor: 'alice' }],
      summary: { aiProposed: 1, developerVerified: 0, manualVerified: 0, total: 1, firstActivity: '2026-05-01', lastActivity: '2026-05-01' },
      scanTrend: [],
      isEmpty: false,
    };
    const withRem = buildVpat(makeReport([]), scanAA, [], { generatedAt: GEN_AT }, record);
    expect(withRem.remediation).toBe(record);
    expect(withRem.remediation?.summary.aiProposed).toBe(1);
  });
});
