import { describe, it, expect } from 'vitest';
import { applyDismissals } from '../../../src/services/issue-dismissals/apply-dismissals.js';
import type { DismissalMatch } from '../../../src/services/issue-dismissals/apply-dismissals.js';
import { countIssues } from '../../../src/services/count-issues.js';

// Every fixture is a factory: a mutation in one test can never leak into another.

const SITE = 'https://example.com';
const URLS = [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`, `${SITE}/d`];

interface Iss {
  type?: string;
  code: string;
  message: string;
  selector: string;
  context: string;
}

function iss(code: string, selector: string, type?: string, context = `<${code}>`): Iss {
  return { ...(type !== undefined ? { type } : {}), code, message: code, selector, context };
}

const TPL = { code: 'TPL', selector: '.nav a', context: '<a class="nav">' };
const tpl = (): Iss => iss(TPL.code, TPL.selector, 'warning', TPL.context);

function ownIssues(): Iss[][] {
  return [
    [iss('E1', '#e1', 'error'), iss('SAME', '#one', 'error')],
    [iss('W1', '#w1', 'warning'), iss('SAME', '#two', 'warning'), iss('OTHER', '#one', 'notice')],
    [iss('N1', '#n1', 'notice'), iss('I1', '#i1', 'info')],
    [],
  ];
}

function summaryFor(report: unknown) {
  const c = countIssues(report);
  return {
    pagesScanned: URLS.length,
    totalIssues: c.total,
    byLevel: { error: c.errors, warning: c.warnings, notice: c.notices },
    pagesFailed: 0,
  };
}

/** Template finding on pages a, b, c — pages whole, no templateIssues. */
function plainReport() {
  const pages = URLS.map((url, i) => {
    const issues = [...ownIssues()[i], ...(i < 3 ? [tpl()] : [])];
    return { url, issueCount: issues.length, issues };
  });
  const base = { scanId: 's1', siteUrl: SITE, pages, compliance: { keep: 'me' }, confirmedViolations: 7 };
  return { ...base, summary: summaryFor(base) };
}

function templateIssues() {
  return [{ ...tpl(), affectedPages: URLS.slice(0, 3) }];
}

function coreShapeReport() {
  const plain = plainReport();
  return { ...plain, templateIssues: templateIssues() };
}

function dedupShapeReport() {
  const base = {
    scanId: 's1',
    siteUrl: SITE,
    pages: URLS.map((url, i) => ({ url, issueCount: ownIssues()[i].length, issues: ownIssues()[i] })),
    templateIssues: templateIssues(),
    compliance: { keep: 'me' },
    confirmedViolations: 7,
  };
  return { ...base, summary: summaryFor(base) };
}

const dismissal = (id: string, code: string, selector: string, siteKey = SITE): DismissalMatch => ({
  id,
  code,
  selector,
  siteKey,
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const FIXTURES: ReadonlyArray<readonly [string, () => ReturnType<typeof plainReport>]> = [
  ['plain', plainReport],
  ['core shape', coreShapeReport as never],
  ['dedup shape', dedupShapeReport as never],
];

describe('applyDismissals', () => {
  it.each(FIXTURES)('removes the finding on every page of the site (%s)', (_name, make) => {
    const raw = make();
    const before = countIssues(raw);

    const applied = applyDismissals(raw, [dismissal('d-tpl', TPL.code, TPL.selector)], SITE);

    expect(applied.dismissed).toHaveLength(3);
    expect(applied.dismissed.map((d) => d.pageUrl).sort()).toEqual(URLS.slice(0, 3));
    expect(applied.dismissed.every((d) => d.dismissalId === 'd-tpl')).toBe(true);
    expect(countIssues(applied.report)).toEqual({
      ...before,
      warnings: before.warnings - 3,
      total: before.total - 3,
    });
    const pages = applied.report.pages as ReadonlyArray<{ issues: ReadonlyArray<{ code: string }> }>;
    expect(pages.flatMap((p) => p.issues).some((i) => i.code === TPL.code)).toBe(false);
  });

  it('drops the matching templateIssues entry (core shape)', () => {
    const applied = applyDismissals(coreShapeReport(), [dismissal('d', TPL.code, TPL.selector)], SITE);
    expect((applied.report as { templateIssues: unknown[] }).templateIssues).toEqual([]);
  });

  it('drops the matching templateIssues entry and flags its occurrences as template (dedup shape)', () => {
    const applied = applyDismissals(dedupShapeReport(), [dismissal('d', TPL.code, TPL.selector)], SITE);
    expect((applied.report as { templateIssues: unknown[] }).templateIssues).toEqual([]);
    expect(applied.dismissed.every((d) => d.isTemplate)).toBe(true);
  });

  it('keeps the same code with a different selector and the same selector with a different code', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [dismissal('d', 'SAME', '#one')], SITE);

    // Only page a's SAME/#one goes; page b's SAME/#two (same code) and OTHER/#one (same selector) stay.
    expect(applied.dismissed).toHaveLength(1);
    expect(applied.dismissed[0].pageUrl).toBe(URLS[0]);
    const codes = (applied.report.pages as ReadonlyArray<{ issues: ReadonlyArray<{ code: string; selector: string }> }>)
      .flatMap((p) => p.issues.map((i) => `${i.code}|${i.selector}`));
    expect(codes).toContain('SAME|#two');
    expect(codes).toContain('OTHER|#one');
    expect(codes).not.toContain('SAME|#one');
  });

  it('matches byte-exactly: a differently-cased or padded selector does not match', () => {
    const applied = applyDismissals(plainReport(), [dismissal('d', 'E1', '#E1'), dismissal('e', 'E1', ' #e1')], SITE);
    expect(applied.dismissed).toEqual([]);
  });

  it('returns the SAME report reference and [] when nothing matches', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [dismissal('d', 'NOPE', '#nope')], SITE);
    expect(applied.report).toBe(raw);
    expect(applied.dismissed).toEqual([]);
  });

  it('returns the SAME report reference and [] for an empty dismissal list', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [], SITE);
    expect(applied.report).toBe(raw);
    expect(applied.dismissed).toEqual([]);
  });

  it.each([[null], [undefined], ['text'], [5]])('passes a non-object report (%s) through untouched', (input) => {
    const applied = applyDismissals(input, [dismissal('d', 'E1', '#e1')], SITE);
    expect(applied.report).toBe(input);
    expect(applied.dismissed).toEqual([]);
  });

  it('pages that lost nothing keep their reference; pages that lost issues are new objects', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [dismissal('d', 'E1', '#e1')], SITE);
    const pages = applied.report.pages;
    expect(pages[0]).not.toBe(raw.pages[0]);
    expect(pages[1]).toBe(raw.pages[1]);
    expect(pages[2]).toBe(raw.pages[2]);
    expect(pages[3]).toBe(raw.pages[3]);
  });

  it('decrements issueCount, recomputes summary.byLevel and totalIssues, keeps other summary fields', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [dismissal('d', 'E1', '#e1')], SITE);
    const report = applied.report;
    expect(report.pages[0].issueCount).toBe(raw.pages[0].issueCount - 1);
    expect(report.summary.byLevel.error).toBe(raw.summary.byLevel.error - 1);
    expect(report.summary.totalIssues).toBe(raw.summary.totalIssues - 1);
    expect(report.summary.byLevel.warning).toBe(raw.summary.byLevel.warning);
    expect(report.summary.pagesScanned).toBe(raw.summary.pagesScanned);
    expect(report.summary.pagesFailed).toBe(0);
  });

  it('sets issueCount to the filtered length when it was not a number, and floors a stale count at 0', () => {
    const missing = { pages: [{ url: 'u', issues: [iss('A', '#a', 'error'), iss('B', '#b', 'error')] }] };
    const stale = { pages: [{ url: 'u', issueCount: 0, issues: [iss('A', '#a', 'error')] }] };
    const a = applyDismissals(missing, [dismissal('d', 'A', '#a')], SITE).report;
    const b = applyDismissals(stale, [dismissal('d', 'A', '#a')], SITE).report;
    expect(a.pages[0].issueCount).toBe(1);
    expect(b.pages[0].issueCount).toBe(0);
  });

  it('leaves compliance data untouched (Phase 88 owns it)', () => {
    const applied = applyDismissals(plainReport(), [dismissal('d', 'E1', '#e1')], SITE);
    expect(applied.report.compliance).toEqual({ keep: 'me' });
    expect(applied.report.confirmedViolations).toBe(7);
  });

  it('the first matching dismissal wins and dismissed.issue is the original object', () => {
    const raw = plainReport();
    const applied = applyDismissals(
      raw,
      [dismissal('first', 'E1', '#e1'), dismissal('second', 'E1', '#e1')],
      SITE,
    );
    expect(applied.dismissed).toHaveLength(1);
    expect(applied.dismissed[0].dismissalId).toBe('first');
    expect(applied.dismissed[0].issue).toBe(raw.pages[0].issues[0]);
  });

  it('applies several dismissals in one pass', () => {
    const applied = applyDismissals(
      plainReport(),
      [dismissal('a', 'E1', '#e1'), dismissal('b', 'N1', '#n1'), dismissal('c', TPL.code, TPL.selector)],
      SITE,
    );
    expect(applied.dismissed).toHaveLength(5);
    expect(new Set(applied.dismissed.map((d) => d.dismissalId))).toEqual(new Set(['a', 'b', 'c']));
  });

  describe('conservation: raw == applied + dismissed, per level', () => {
    const SETS: ReadonlyArray<readonly [string, DismissalMatch[]]> = [
      ['one error', [dismissal('a', 'E1', '#e1')]],
      ['the template finding', [dismissal('b', TPL.code, TPL.selector)]],
      ['an unknown-type issue', [dismissal('c', 'I1', '#i1')]],
      ['everything at once', [
        dismissal('a', 'E1', '#e1'), dismissal('b', TPL.code, TPL.selector), dismissal('c', 'I1', '#i1'),
        dismissal('d', 'W1', '#w1'), dismissal('e', 'SAME', '#one'), dismissal('f', 'SAME', '#two'),
        dismissal('g', 'OTHER', '#one'), dismissal('h', 'N1', '#n1'),
      ]],
    ];

    for (const [fixtureName, make] of FIXTURES) {
      for (const [setName, dismissals] of SETS) {
        it(`${fixtureName}: ${setName}`, () => {
          const raw = make();
          const rawCounts = countIssues(raw); // BEFORE applyDismissals
          const applied = applyDismissals(raw, dismissals, SITE);
          const appliedCounts = countIssues(applied.report);
          const dismissedBy = (level: string): number =>
            applied.dismissed.filter((d) => {
              const type = (d.issue as { type?: string }).type;
              return level === 'notice' ? type !== 'error' && type !== 'warning' : type === level;
            }).length;

          expect(appliedCounts.errors + dismissedBy('error')).toBe(rawCounts.errors);
          expect(appliedCounts.warnings + dismissedBy('warning')).toBe(rawCounts.warnings);
          expect(appliedCounts.notices + dismissedBy('notice')).toBe(rawCounts.notices);
          expect(appliedCounts.total + applied.dismissed.length).toBe(rawCounts.total);
        });
      }
    }
  });

  it('ignores a dismissal recorded for a different site key', () => {
    const raw = plainReport();
    const applied = applyDismissals(raw, [dismissal('d', 'E1', '#e1', 'https://other.example')], SITE);
    expect(applied.dismissed).toEqual([]);
    expect(applied.report).toBe(raw);
  });

  it('does not mutate a deep-frozen input', () => {
    for (const make of [plainReport, coreShapeReport, dedupShapeReport]) {
      const raw = deepFreeze(make());
      const dismissals = deepFreeze([
        dismissal('a', 'E1', '#e1'),
        dismissal('b', TPL.code, TPL.selector),
      ]);
      const snapshot = structuredClone(raw);
      const dismissalSnapshot = structuredClone(dismissals);

      const applied = applyDismissals(raw, dismissals, SITE);

      expect(applied.dismissed.length).toBeGreaterThan(0);
      expect(raw).toEqual(snapshot);
      expect(dismissals).toEqual(dismissalSnapshot);
    }
  });

  // WR-02 (87 review): shares countIssues' sanitiser, so a malformed
  // affectedPages must not throw here either.
  it('does not throw on a template issue whose affectedPages is not an array', () => {
    const raw = {
      pages: [{ url: 'https://a.example/', issues: [{ code: 'E', selector: '#e', type: 'error' }] }],
      templateIssues: [{ code: 'T', selector: '#t', type: 'warning', affectedPages: 'https://a.example/' }],
    };
    const applied = applyDismissals(raw, [dismissal('d', 'E', '#e')], SITE);
    expect(applied.dismissed).toHaveLength(1);
    expect(countIssues(applied.report).total).toBe(0);
  });
});
