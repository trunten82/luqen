/**
 * Plan 88-02 Task 2: D-08 / FP-12 — the compliance matrices follow the dismissals locally and conservatively.
 * Every fixture is a deep-frozen factory (no shared mutable state), so a mutation inside the filter throws.
 */
import { describe, it, expect } from 'vitest';
import { applyDismissals } from '../../../src/services/issue-dismissals/apply-dismissals.js';
import type { DismissalMatch } from '../../../src/services/issue-dismissals/apply-dismissals.js';
import { filterComplianceForDismissals } from '../../../src/services/issue-dismissals/filter-compliance.js';

const SITE = 'https://fabrikam.example';
const C111 = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';
const C143A = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18';
const C143B = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G145';
const C244 = 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77';
const UNMAPPED = 'engine.custom.rule';

type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const iss = (code: string, selector: string, type = 'error') => ({
  type,
  code,
  message: code,
  selector,
  context: `<${selector}>`,
});

function pages() {
  return [
    {
      url: `${SITE}/`,
      issueCount: 5,
      issues: [
        iss(C111, '#img'),
        iss(C143A, '#hero'),
        iss(C143B, '#foot', 'warning'),
        iss(C244, '#link', 'notice'),
        iss(UNMAPPED, '#odd', 'notice'),
      ],
    },
    { url: `${SITE}/about`, issueCount: 1, issues: [iss(C143A, '#hero2')] },
  ];
}

const violation = (wcagCriterion: string, obligation: string, issueCount: number) => ({ wcagCriterion, obligation, issueCount });

interface ComplianceOpts {
  readonly exampleSelector?: string;
  readonly perCode?: number;
  readonly annotated?: boolean;
}

function compliance(opts: ComplianceOpts = {}): Loose {
  const m = opts.perCode ?? 1;
  const r1v = [violation('1.1.1', 'mandatory', 1), violation('1.4.3', 'mandatory', 2 * m), violation('2.4.4', 'recommended', 1)];
  const fab = {
    jurisdictionId: 'FAB',
    jurisdictionName: 'Fabrikam Land',
    status: 'fail',
    mandatoryViolations: 1 + 2 * m,
    recommendedViolations: 1,
    optionalViolations: 0,
    reviewStatus: 'fail',
    confirmedViolations: 3,
    regulations: [
      { regulationId: 'R1', regulationName: 'Fabrikam Act', shortName: 'FA', status: 'fail', enforcementDate: '2025-01-01', scope: 'all', violations: r1v },
    ],
  };
  const nw = {
    jurisdictionId: 'NW',
    jurisdictionName: 'Northwind Land',
    status: 'pass',
    mandatoryViolations: 0,
    recommendedViolations: 1,
    optionalViolations: 0,
    reviewStatus: 'pass',
    regulations: [
      { regulationId: 'R2', regulationName: 'Northwind Act', shortName: 'NA', status: 'pass', enforcementDate: '2025-01-01', scope: 'all', violations: [violation('2.4.4', 'recommended', 1)] },
    ],
  };
  const annotatedIssues = [
    { code: C111, wcagCriterion: '1.1.1', wcagLevel: 'A', originalIssue: iss(C111, '#img'), regulations: [] },
    { code: C143A, wcagCriterion: '1.4.3', wcagLevel: 'AA', originalIssue: iss(C143A, opts.exampleSelector ?? '#hero2'), regulations: [] },
    { code: C143B, wcagCriterion: '1.4.3', wcagLevel: 'AA', originalIssue: iss(C143B, '#foot', 'warning'), regulations: [] },
    { code: C244, wcagCriterion: '2.4.4', wcagLevel: 'A', originalIssue: iss(C244, '#link', 'notice'), regulations: [] },
  ];
  const regMatrix = {
    R1: { regulationId: 'R1', regulationName: 'Fabrikam Act', shortName: 'FA', jurisdictionId: 'FAB', status: 'fail', mandatoryViolations: 1 + 2 * m, recommendedViolations: 1, optionalViolations: 0, reviewStatus: 'fail', violatedRequirements: r1v },
    R2: { regulationId: 'R2', regulationName: 'Northwind Act', shortName: 'NA', jurisdictionId: 'NW', status: 'partial', mandatoryViolations: 0, recommendedViolations: 1, optionalViolations: 0, violatedRequirements: [violation('2.4.4', 'recommended', 1)] },
  };
  return {
    matrix: { FAB: fab, NW: nw },
    regulationMatrix: regMatrix,
    ...(opts.annotated === false ? {} : { annotatedIssues }),
    summary: { totalJurisdictions: 2, passing: 1, failing: 1, totalMandatoryViolations: 1 + 2 * m, totalOptionalViolations: 0, keepMe: 'x' },
  };
}

function rawReport(opts: ComplianceOpts = {}): Loose {
  const c = compliance(opts);
  return deepFreeze({
    scanId: 's1',
    siteUrl: SITE,
    pages: pages(),
    summary: { pagesScanned: 2, totalIssues: 6, byLevel: { error: 3, warning: 1, notice: 2 } },
    compliance: c,
    complianceMatrix: Object.values(c.matrix),
    regulationMatrix: Object.values(c.regulationMatrix),
  });
}

const dm = (id: string, code: string, selector: string): DismissalMatch => ({ id, code, selector, siteKey: SITE });

function dismiss(raw: Loose, ...targets: Array<[string, string]>): Loose {
  const list = targets.map(([code, selector], i) => dm(`d${i}`, code, selector));
  return applyDismissals(raw, list, SITE).report;
}

const violationsOf = (entry: Loose): string[] =>
  entry.regulations.flatMap((r: Loose) => r.violations.map((v: Loose) => v.wcagCriterion));

describe('filterComplianceForDismissals — identity', () => {
  it('identity: same reference when no code vanished (a same-code sibling survives)', () => {
    const raw = rawReport({ exampleSelector: '#hero2' });
    const filtered = dismiss(raw, [C143A, '#hero']);
    expect(filtered).not.toBe(raw);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(result).toBe(filtered);
    expect(result.compliance).toBe(raw.compliance);
  });

  it('identity: same reference when the report has no compliance object or an empty matrix', () => {
    const noCompliance = deepFreeze({ pages: pages(), summary: { byLevel: { error: 3, warning: 1, notice: 2 }, totalIssues: 6 } });
    const filteredA = dismiss(noCompliance, [C111, '#img']);
    expect(filterComplianceForDismissals(noCompliance, filteredA)).toBe(filteredA);

    const emptyMatrix = deepFreeze({
      pages: pages(),
      summary: { byLevel: { error: 3, warning: 1, notice: 2 }, totalIssues: 6 },
      compliance: { matrix: {}, regulationMatrix: {}, annotatedIssues: [], summary: { totalJurisdictions: 0 } },
    });
    const filteredB = dismiss(emptyMatrix, [C111, '#img']);
    const result = filterComplianceForDismissals(emptyMatrix, filteredB);
    expect(result).toBe(filteredB);
    expect(result.compliance).toBe(emptyMatrix.compliance);
  });

  it('identity: same reference when the filtered report is the raw report', () => {
    const raw = rawReport();
    expect(filterComplianceForDismissals(raw, raw)).toBe(raw);
  });

  it('unmappable code leaves entries unchanged', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [UNMAPPED, '#odd']);
    expect(filtered).not.toBe(raw);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(result).toBe(filtered);
    expect(result.compliance).toBe(raw.compliance);
  });
});

describe('filterComplianceForDismissals — a criterion whose every issue is dismissed (FP-12)', () => {
  it('a criterion whose only code vanished leaves the jurisdiction and regulation violations', () => {
    const raw = rawReport();
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect(violationsOf(result.compliance.matrix.FAB)).toEqual(['1.4.3', '2.4.4']);
    expect(result.compliance.regulationMatrix.R1.violatedRequirements.map((v: Loose) => v.wcagCriterion)).toEqual(['1.4.3', '2.4.4']);
    expect(result.compliance.matrix.FAB.mandatoryViolations).toBe(2);
    expect(result.compliance.regulationMatrix.R1.mandatoryViolations).toBe(2);
  });

  it('jurisdiction status becomes pass when no mandatory violation remains', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [C111, '#img'], [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot']);
    const result = filterComplianceForDismissals(raw, filtered);
    const fab = result.compliance.matrix.FAB;
    expect(fab.status).toBe('pass');
    expect(fab.mandatoryViolations).toBe(0);
    expect(fab.recommendedViolations).toBe(1);
    expect(fab.regulations[0].status).toBe('pass');
    expect(violationsOf(fab)).toEqual(['2.4.4']);
  });

  it('regulation matrix status becomes partial when only recommended violations remain', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [C111, '#img'], [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot']);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(result.compliance.regulationMatrix.R1.status).toBe('partial');
    expect(result.compliance.regulationMatrix.R1.recommendedViolations).toBe(1);
  });

  it('regulation matrix status becomes pass when nothing remains', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [C111, '#img'], [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot'], [C244, '#link']);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(result.compliance.regulationMatrix.R1.status).toBe('pass');
    expect(result.compliance.regulationMatrix.R1.violatedRequirements).toEqual([]);
  });

  it('boundary: a different code on the same criterion survives -> 1.4.3 keeps issueCount 1 and status fail', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [C111, '#img'], [C143A, '#hero'], [C143A, '#hero2']);
    const result = filterComplianceForDismissals(raw, filtered);
    const fab = result.compliance.matrix.FAB;
    const v143 = fab.regulations[0].violations.find((v: Loose) => v.wcagCriterion === '1.4.3');
    expect(v143.issueCount).toBe(1);
    expect(fab.status).toBe('fail');
    expect(fab.mandatoryViolations).toBe(1);
    expect(result.compliance.regulationMatrix.R1.status).toBe('fail');
  });

  it('boundary: with no surviving sibling the 1.4.3 entry is dropped', () => {
    const raw = rawReport();
    const filtered = dismiss(raw, [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot']);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(violationsOf(result.compliance.matrix.FAB)).toEqual(['1.1.1', '2.4.4']);
    expect(result.compliance.matrix.FAB.status).toBe('fail');
  });

  it('issueCount decrements by the number of vanished codes on that criterion and the entry is dropped at zero', () => {
    const raw = rawReport();
    const one = filterComplianceForDismissals(raw, dismiss(raw, [C143B, '#foot']));
    expect(one.compliance.matrix.FAB.regulations[0].violations.find((v: Loose) => v.wcagCriterion === '1.4.3').issueCount).toBe(1);
    const both = filterComplianceForDismissals(raw, dismiss(raw, [C143B, '#foot'], [C143A, '#hero'], [C143A, '#hero2']));
    expect(violationsOf(both.compliance.matrix.FAB)).not.toContain('1.4.3');
  });

  it('scales by the stored per-code multiplicity (two requirements on one criterion)', () => {
    const raw = rawReport({ perCode: 2 });
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C143B, '#foot']));
    const v = result.compliance.matrix.FAB.regulations[0].violations.find((x: Loose) => x.wcagCriterion === '1.4.3');
    expect(v.issueCount).toBe(2);
    expect(result.compliance.matrix.FAB.mandatoryViolations).toBe(1 + 2);
  });
});

describe('filterComplianceForDismissals — shape and bookkeeping', () => {
  it('legacy compliance without annotatedIssues falls back to extractCriterion', () => {
    const raw = rawReport({ annotated: false });
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect(violationsOf(result.compliance.matrix.FAB)).toEqual(['1.4.3', '2.4.4']);
    expect('annotatedIssues' in result.compliance).toBe(false);
  });

  it('top-level complianceMatrix and regulationMatrix arrays mirror the filtered maps', () => {
    const raw = rawReport();
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect(result.complianceMatrix).toEqual(Object.values(result.compliance.matrix));
    expect(result.regulationMatrix).toEqual(Object.values(result.compliance.regulationMatrix));
  });

  it('does not add top-level arrays the raw report did not have', () => {
    const base = rawReport();
    const { complianceMatrix: _a, regulationMatrix: _b, ...rest } = base;
    const raw = deepFreeze(rest);
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect('complianceMatrix' in result).toBe(false);
    expect('regulationMatrix' in result).toBe(false);
  });

  it('annotated issues drop vanished codes and re-point a surviving code\'s example away from a dismissed occurrence', () => {
    const raw = rawReport({ exampleSelector: '#hero' });
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img'], [C143A, '#hero']));
    const annotated = result.compliance.annotatedIssues;
    expect(annotated.map((a: Loose) => a.code)).toEqual([C143A, C143B, C244]);
    expect(annotated.find((a: Loose) => a.code === C143A).originalIssue.selector).toBe('#hero2');
  });

  it('re-points a stale example even when no code vanished', () => {
    const raw = rawReport({ exampleSelector: '#hero' });
    const filtered = dismiss(raw, [C143A, '#hero']);
    const result = filterComplianceForDismissals(raw, filtered);
    expect(result).not.toBe(filtered);
    expect(result.compliance.annotatedIssues.find((a: Loose) => a.code === C143A).originalIssue.selector).toBe('#hero2');
    expect(result.compliance.matrix).toBe(raw.compliance.matrix);
  });

  it('remaining violation entries keep their stored order', () => {
    const raw = rawReport();
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot']));
    expect(violationsOf(result.compliance.matrix.FAB)).toEqual(['1.1.1', '2.4.4']);
  });

  it('summary totals are recomputed by the checker\'s rule', () => {
    const raw = rawReport();
    const some = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect(some.compliance.summary).toEqual({ totalJurisdictions: 2, passing: 1, failing: 1, totalMandatoryViolations: 2, totalOptionalViolations: 0, keepMe: 'x' });
    const all = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img'], [C143A, '#hero'], [C143A, '#hero2'], [C143B, '#foot']));
    expect(all.compliance.summary).toEqual({ totalJurisdictions: 2, passing: 2, failing: 0, totalMandatoryViolations: 0, totalOptionalViolations: 0, keepMe: 'x' });
  });

  it('modified entries drop legacy reviewStatus and confirmedViolations so normalizeReportData re-derives them', () => {
    const raw = rawReport();
    const result = filterComplianceForDismissals(raw, dismiss(raw, [C111, '#img']));
    expect('reviewStatus' in result.compliance.matrix.FAB).toBe(false);
    expect('confirmedViolations' in result.compliance.matrix.FAB).toBe(false);
    expect('reviewStatus' in result.compliance.regulationMatrix.R1).toBe(false);
    // The untouched jurisdiction keeps its stored fields, by reference.
    expect(result.compliance.matrix.NW).toBe(raw.compliance.matrix.NW);
    expect(result.compliance.matrix.NW.reviewStatus).toBe('pass');
  });

  it('never mutates a deep-frozen input', () => {
    const raw = rawReport();
    const filtered = deepFreeze(dismiss(raw, [C111, '#img'], [C143A, '#hero']));
    const before = JSON.stringify(raw);
    expect(() => filterComplianceForDismissals(raw, filtered)).not.toThrow();
    expect(JSON.stringify(raw)).toBe(before);
  });
});
