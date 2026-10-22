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
