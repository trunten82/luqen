/**
 * D-06 / D-07: the one module that owns the reports.view_technical predicate, the field list and
 * every redaction function the REST data API, the report page and the brand drilldown share.
 */
import { describe, expect, it } from 'vitest';
import {
  TECHNICAL_DETAILS_PERMISSION,
  TECHNICAL_ISSUE_FIELDS,
  mayViewTechnicalDetails,
  requestMayViewTechnicalDetails,
  withoutTechnicalFields,
  itemsForViewer,
  reportForViewer,
  reportBlobForViewer,
} from '../../src/services/technical-details.js';

describe('technical details predicate', () => {
  it('D-06 mayViewTechnicalDetails is false for undefined', () => {
    expect(mayViewTechnicalDetails(undefined)).toBe(false);
  });

  it('D-06 mayViewTechnicalDetails is false for an empty set', () => {
    expect(mayViewTechnicalDetails(new Set<string>())).toBe(false);
  });

  it('D-06 mayViewTechnicalDetails is false for a set without the permission', () => {
    expect(mayViewTechnicalDetails(new Set(['reports.view', 'issues.fix']))).toBe(false);
  });

  it('D-06 mayViewTechnicalDetails is true only when the set holds reports.view_technical', () => {
    expect(mayViewTechnicalDetails(new Set(['reports.view', TECHNICAL_DETAILS_PERMISSION]))).toBe(true);
    expect(TECHNICAL_DETAILS_PERMISSION).toBe('reports.view_technical');
  });

  it('D-06 requestMayViewTechnicalDetails reads the permission set attached to the request', () => {
    expect(requestMayViewTechnicalDetails({ permissions: new Set([TECHNICAL_DETAILS_PERMISSION]) })).toBe(true);
    expect(requestMayViewTechnicalDetails({ permissions: new Set(['reports.view']) })).toBe(false);
    expect(requestMayViewTechnicalDetails({})).toBe(false);
  });
});

describe('technical details field list', () => {
  it('D-07 TECHNICAL_ISSUE_FIELDS equals context and selector, in that order', () => {
    expect([...TECHNICAL_ISSUE_FIELDS]).toEqual(['context', 'selector']);
  });
});

describe('technical details redaction of one item', () => {
  it('D-06 withoutTechnicalFields returns a new object without the two keys and keeps every other key', () => {
    const input = Object.freeze({
      code: 'C', message: 'm', selector: '#s', context: '<p>x</p>', pageUrl: 'https://fabrikam.test/', regulations: [],
    });
    const out = withoutTechnicalFields(input);
    expect(out).not.toBe(input);
    expect('selector' in out).toBe(false);
    expect('context' in out).toBe(false);
    expect(out).toEqual({ code: 'C', message: 'm', pageUrl: 'https://fabrikam.test/', regulations: [] });
  });

  it('D-06 withoutTechnicalFields leaves its frozen input unchanged', () => {
    const input = Object.freeze({ code: 'C', selector: '#s', context: '<p>x</p>' });
    withoutTechnicalFields(input);
    expect(input).toEqual({ code: 'C', selector: '#s', context: '<p>x</p>' });
  });

  it('D-06 itemsForViewer returns the same array reference for an entitled viewer', () => {
    const items = [{ code: 'C', selector: '#s' }];
    expect(itemsForViewer(items, true)).toBe(items);
  });

  it('D-06 itemsForViewer returns new redacted copies for a viewer without the permission', () => {
    const items = Object.freeze([Object.freeze({ code: 'C', selector: '#s', context: 'x' })]);
    const out = itemsForViewer(items, false);
    expect(out).not.toBe(items);
    expect(out).toEqual([{ code: 'C' }]);
    expect(items[0]).toEqual({ code: 'C', selector: '#s', context: 'x' });
  });
});

// ── Task 2: the stored report blob (D-08) ─────────────────────────────────────────────────────────
const SEL = '#unit-selcanary';
const CTX = '<p id="unit-ctxcanary">x</p>';
const MSG = 'unit-msgcanary';

function copy(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'error', code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', message: MSG, selector: SEL, context: CTX, ...extra };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function bodyOf(value: unknown): string {
  return JSON.stringify(value);
}

describe('reportForViewer strips issue copies at every location', () => {
  const locations: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['pages issues', { pages: [{ url: 'https://fabrikam.test/', issues: [copy()] }] }],
    ['templateIssues', { templateIssues: [copy()] }],
    ['flat issues', { issues: [copy()] }],
    ['results issues', { results: [{ url: 'https://fabrikam.test/', issues: [copy()] }] }],
    ['compliance annotatedIssues originalIssue', { compliance: { annotatedIssues: [{ code: 'C', wcagCriterion: '1.4.3', originalIssue: copy() }] } }],
    ['an unknown nested array of issue-like objects', { somethingNew: { deeper: [{ group: [copy()] }] } }],
  ];

  for (const [name, report] of locations) {
    it(`D-08 reportForViewer strips selector and context from ${name}`, () => {
      const out = reportForViewer(deepFreeze(report), false);
      const text = bodyOf(out);
      expect(text).not.toContain('unit-selcanary');
      expect(text).not.toContain('unit-ctxcanary');
      expect(text).toContain(MSG);
    });
  }

  const shapes: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['an axe-style copy keyed by ruleId', { ruleId: 'color-contrast', message: MSG, selector: '#unit-selcanary-rule', context: '<p id="unit-ctxcanary-rule">x</p>' }],
    ['a copy with a numeric code', { code: 7, message: MSG, selector: '#unit-selcanary-num', context: '<p id="unit-ctxcanary-num">x</p>' }],
    ['a copy with no code at all', { message: MSG, selector: '#unit-selcanary-none', context: '<p id="unit-ctxcanary-none">x</p>' }],
  ];
  for (const [name, shape] of shapes) {
    it(`D-08 reportForViewer strips selector and context from ${name}, nested at any depth`, () => {
      const report = { findings: [shape], future: { nested: { copy: shape } } };
      const out = reportForViewer(deepFreeze(report), false) as {
        findings: Array<Record<string, unknown>>;
        future: { nested: { copy: Record<string, unknown> } };
      };
      for (const obj of [out.findings[0]!, out.future.nested.copy]) {
        expect('selector' in obj, 'selector key present').toBe(false);
        expect('context' in obj, 'context key present').toBe(false);
      }
      const text = bodyOf(out);
      expect(text).not.toContain('unit-selcanary');
      expect(text).not.toContain('unit-ctxcanary');
      expect(text).toContain(MSG);
      expect(out.findings[0]).toEqual(withoutTechnicalFields(shape));
    });
  }

  it('D-08 reportForViewer keeps an errors entry, which has neither key, unchanged', () => {
    const report = { errors: [{ url: 'https://fabrikam.test/x', message: 'timeout' }] };
    expect(reportForViewer(deepFreeze(report), false)).toEqual(report);
  });

  it('D-08 reportForViewer returns the same reference for an entitled viewer and never mutates a deep-frozen input', () => {
    const report = deepFreeze({ pages: [{ issues: [copy()] }], templateIssues: [copy()] });
    expect(reportForViewer(report, true)).toBe(report);
    const out = reportForViewer(report, false);
    expect(out).not.toBe(report);
    expect(bodyOf(report)).toContain('unit-selcanary');
  });

  it('D-08 reportForViewer keeps primitives and every non-technical key', () => {
    const report = { summary: { totalIssues: 1, url: 'https://fabrikam.test/' }, pages: [{ issues: [copy({ runner: 'axe' })] }], flag: true, none: null };
    const out = reportForViewer(report, false) as typeof report;
    expect(out.summary).toEqual(report.summary);
    expect(out.flag).toBe(true);
    expect(out.none).toBeNull();
    expect(out.pages[0].issues[0]).toMatchObject({ code: report.pages[0].issues[0].code, message: MSG, runner: 'axe' });
  });
});

describe('reportBlobForViewer redacts the row blob', () => {
  const row = { id: 'scan-1', siteUrl: 'https://fabrikam.test/', jsonReport: JSON.stringify({ pages: [{ issues: [copy()] }] }) };

  it('D-08 reportBlobForViewer returns the same row for an entitled viewer', () => {
    expect(reportBlobForViewer(row, true)).toBe(row);
  });

  it('D-08 reportBlobForViewer returns the same row when there is no blob', () => {
    const bare = { id: 'scan-2' };
    expect(reportBlobForViewer(bare, false)).toBe(bare);
  });

  it('D-08 reportBlobForViewer gives a viewer without the permission a parseable blob without the canaries and with the message', () => {
    const out = reportBlobForViewer(row, false) as typeof row;
    expect(out).not.toBe(row);
    const text = String(out.jsonReport);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain('unit-selcanary');
    expect(text).not.toContain('unit-ctxcanary');
    expect(text).toContain(MSG);
    expect(out.id).toBe('scan-1');
    expect(row.jsonReport).toContain('unit-selcanary');
  });

  it('D-08 reportBlobForViewer omits the jsonReport key when the blob cannot be parsed and the viewer lacks the permission', () => {
    const broken = { id: 'scan-3', jsonReport: `{"pages": [ ${SEL} ` };
    const out = reportBlobForViewer(broken, false);
    expect('jsonReport' in out).toBe(false);
    expect(out.id).toBe('scan-3');
    expect(reportBlobForViewer(broken, true)).toBe(broken);
  });
});
