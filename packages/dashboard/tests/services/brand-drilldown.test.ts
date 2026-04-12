import { describe, it, expect } from 'vitest';
import {
  filterDrilldownIssues,
  isValidDimension,
  type DrilldownIssue,
  type DrilldownDimension,
} from '../../src/services/brand-drilldown.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    type: 'error',
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    message: 'Contrast ratio too low',
    selector: 'p.intro',
    context: '<p class="intro" style="color:#999">Hello</p>',
    ...overrides,
  };
}

function makeReport(pages: Array<{ url: string; issues: unknown[] }>) {
  return { pages: pages.map((p) => ({ ...p, issueCount: p.issues.length })) };
}

// ---------------------------------------------------------------------------
// isValidDimension
// ---------------------------------------------------------------------------

describe('isValidDimension', () => {
  it('accepts color, typography, components', () => {
    expect(isValidDimension('color')).toBe(true);
    expect(isValidDimension('typography')).toBe(true);
    expect(isValidDimension('components')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidDimension('invalid')).toBe(false);
    expect(isValidDimension('')).toBe(false);
    expect(isValidDimension('COLOR')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterDrilldownIssues — color dimension
// ---------------------------------------------------------------------------

describe('filterDrilldownIssues — color', () => {
  it('returns contrast issues with brandMatch.matched === true', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand red #FF0000' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(1);
    expect(result[0].code).toContain('Guideline1_4.1_4_3');
    expect(result[0].matchDetail).toBe('Brand red #FF0000');
    expect(result[0].strategy).toBe('color-pair');
  });

  it('includes 1.4.6 and 1.4.11 contrast codes', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17.Fail',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Enhanced contrast' },
          }),
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_11.G195.Fail',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Non-text contrast' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(2);
  });

  it('excludes contrast issues without brandMatch.matched', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            brandMatch: { matched: false },
          }),
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            // no brandMatch at all
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(0);
  });

  it('excludes non-contrast issues even if brand-matched', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'test' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterDrilldownIssues — typography dimension
// ---------------------------------------------------------------------------

describe('filterDrilldownIssues — typography', () => {
  it('returns issues with brandMatch.strategy === font', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_12.C36',
            brandMatch: { matched: true, strategy: 'font', matchDetail: 'Expected Roboto, found Arial' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('typography', report);
    expect(result).toHaveLength(1);
    expect(result[0].strategy).toBe('font');
  });

  it('excludes non-font strategy issues', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'test' },
          }),
          makeIssue({
            brandMatch: { matched: true, strategy: 'selector', matchDetail: 'test' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('typography', report);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterDrilldownIssues — components dimension
// ---------------------------------------------------------------------------

describe('filterDrilldownIssues — components', () => {
  it('returns issues with brandMatch.strategy === selector', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91',
            brandMatch: { matched: true, strategy: 'selector', matchDetail: '.btn-primary token mismatch' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('components', report);
    expect(result).toHaveLength(1);
    expect(result[0].strategy).toBe('selector');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('filterDrilldownIssues — edge cases', () => {
  it('returns empty array for empty pages', () => {
    const result = filterDrilldownIssues('color', { pages: [] });
    expect(result).toHaveLength(0);
  });

  it('returns empty array for missing pages', () => {
    const result = filterDrilldownIssues('color', {});
    expect(result).toHaveLength(0);
  });

  it('returns empty array for null report data', () => {
    const result = filterDrilldownIssues('color', null);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no brand-matched issues exist', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [makeIssue(), makeIssue()],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for invalid dimension', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'test' },
          }),
        ],
      },
    ]);
    // Cast to bypass type check for defensive test
    const result = filterDrilldownIssues('invalid' as DrilldownDimension, report);
    expect(result).toHaveLength(0);
  });

  it('deduplicates by code + selector', () => {
    const report = makeReport([
      {
        url: 'https://example.com/page1',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            selector: 'p.intro',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand red' },
          }),
        ],
      },
      {
        url: 'https://example.com/page2',
        issues: [
          makeIssue({
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
            selector: 'p.intro',
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand red' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result).toHaveLength(1);
  });

  it('truncates context to 200 chars', () => {
    const longContext = 'x'.repeat(300);
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            context: longContext,
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'test' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(result[0].context.length).toBeLessThanOrEqual(200);
  });

  it('returns frozen array', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'test' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('each DrilldownIssue has expected shape', () => {
    const report = makeReport([
      {
        url: 'https://example.com',
        issues: [
          makeIssue({
            brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand red' },
          }),
        ],
      },
    ]);
    const result = filterDrilldownIssues('color', report);
    const issue = result[0];
    expect(issue).toHaveProperty('selector');
    expect(issue).toHaveProperty('context');
    expect(issue).toHaveProperty('message');
    expect(issue).toHaveProperty('code');
    expect(issue).toHaveProperty('matchDetail');
    expect(issue).toHaveProperty('strategy');
  });
});
