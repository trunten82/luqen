/**
 * Phase 88 Plan 06: the shared ACR disclosure (FP-07, D-09..D-12).
 *
 * buildVpat discloses, per affected criterion, how many automated finding
 * OCCURRENCES were dismissed as false positives after review. The disclosure
 * lives in DATA (remarks + an optional dismissedCount); acr-view localises it.
 * Public repo: Fabrikam placeholders only.
 */
import { describe, expect, it } from 'vitest';
import { buildVpat, type VpatScanInput } from '../../src/services/vpat-service.js';
import { normalizeReportData } from '../../src/services/report-service.js';
import type { ManualTestResult } from '../../src/manual-criteria.js';

type NormalizedReportData = ReturnType<typeof normalizeReportData>;
type IssueGroup = NormalizedReportData['allIssueGroups'][number];

const GEN_AT = '2026-10-01';
const scanAA: VpatScanInput = { siteUrl: 'https://fabrikam.example/shop/', standard: 'WCAG2AA' };

const SENTENCE_THREE = '3 automated findings were dismissed as false positives after review.';
const SENTENCE_ONE = '1 automated finding was dismissed as a false positive after review.';

function makeGroup(criterion: string, errorCount = 1): IssueGroup {
  return {
    criterion,
    title: 'Some criterion',
    wcagUrl: 'https://example.com',
    count: errorCount,
    warningCount: 0,
    noticeCount: 0,
    errorCount,
    pageCount: 1,
    regulations: [],
    components: [],
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
  } as unknown as ManualTestResult;
}

type Built = ReturnType<typeof buildVpat>;
function rowFor(vpat: Built, criterion: string) {
  return vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === criterion);
}

describe('buildVpat discloses dismissed occurrences per criterion', () => {
  it('buildVpat discloses dismissed occurrences per criterion', () => {
    // 1.4.3 still has a finding (the sibling); 1.1.1 lost its only finding.
    const report = makeReport([makeGroup('1.4.3', 1)]);
    const dismissedByCriterion = new Map<string, number>([['1.4.3', 3], ['1.1.1', 1]]);
    const vpat = buildVpat(report, scanAA, [], { generatedAt: GEN_AT, dismissedByCriterion });

    const contrast = rowFor(vpat, '1.4.3');
    expect(contrast?.conformance).toBe('Does Not Support');
    expect(contrast?.remarks.endsWith(SENTENCE_THREE)).toBe(true);
    expect(contrast?.dismissedCount).toBe(3);

    const alt = rowFor(vpat, '1.1.1');
    expect(alt?.conformance).not.toBe('Does Not Support');
    expect(alt?.remarks.endsWith(SENTENCE_ONE)).toBe(true);
    expect(alt?.dismissedCount).toBe(1);

    // Every other row is untouched.
    const other = rowFor(vpat, '2.4.4');
    expect(other).toBeDefined();
    expect(other?.remarks).not.toContain('dismissed');
    expect('dismissedCount' in (other ?? {})).toBe(false);
  });

  it('buildVpat leaves every row unchanged when nothing is dismissed', () => {
    const report = makeReport([makeGroup('1.4.3', 2)]);
    const without = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    const emptyMap = buildVpat(report, scanAA, [], { generatedAt: GEN_AT, dismissedByCriterion: new Map() });
    const zeroCount = buildVpat(report, scanAA, [], {
      generatedAt: GEN_AT,
      dismissedByCriterion: new Map([['1.4.3', 0]]),
    });

    expect(JSON.stringify(emptyMap)).toBe(JSON.stringify(without));
    expect(JSON.stringify(zeroCount)).toBe(JSON.stringify(without));
    const rows = without.tablesByLevel.flatMap((t) => t.rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of [...emptyMap.tablesByLevel, ...zeroCount.tablesByLevel].flatMap((t) => t.rows)) {
      expect('dismissedCount' in row).toBe(false);
    }
  });

  it('a criterion absent from the catalogue of the standard adds no row and no disclosure', () => {
    const report = makeReport([]);
    const vpat = buildVpat(report, scanAA, [], {
      generatedAt: GEN_AT,
      dismissedByCriterion: new Map([['9.9.9', 4]]),
    });
    const baseline = buildVpat(report, scanAA, [], { generatedAt: GEN_AT });
    expect(JSON.stringify(vpat)).toBe(JSON.stringify(baseline));
  });

  it('the dismissal note comes after an evidence note', () => {
    const report = makeReport([makeGroup('1.4.3', 1)]);
    const vpat = buildVpat(report, scanAA, [makeManual('1.4.3', 'fail')], {
      generatedAt: GEN_AT,
      evidenceCounts: new Map([['1.4.3', 2]]),
      dismissedByCriterion: new Map([['1.4.3', 3]]),
    });
    const remarks = rowFor(vpat, '1.4.3')?.remarks ?? '';
    expect(remarks).toContain('2 evidence files on record');
    expect(remarks.endsWith(SENTENCE_THREE)).toBe(true);
    expect(remarks.indexOf('evidence files on record')).toBeLessThan(remarks.indexOf(SENTENCE_THREE));
  });

  it('carries counts only: no reason, actor or date can reach the row', () => {
    const report = makeReport([makeGroup('1.4.3', 1)]);
    const vpat = buildVpat(report, scanAA, [], {
      generatedAt: GEN_AT,
      dismissedByCriterion: new Map([['1.4.3', 3]]),
    });
    const row = rowFor(vpat, '1.4.3');
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['conformance', 'criterion', 'dismissedCount', 'level', 'remarks', 'title', 'url', 'version'],
    );
  });
});
