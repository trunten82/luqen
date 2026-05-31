/**
 * Fast (non-browser) unit tests for the IBM Equal Access result → Issue mapper.
 *
 * Feeds a synthetic IBM-report-shaped `results` array (no real browser / checker
 * run) and asserts:
 *  - VIOLATION → error Issue, RECOMMENDATION → warning Issue, both with the
 *    right WCAG criterion in the code, runner='ibm', selector/context wired,
 *  - INFORMATION / PASS / MANUAL bands are skipped,
 *  - actionable results whose ruleId is not WCAG-attributable are skipped,
 *  - the per-report cap is respected,
 *  - every mapped criterion is parseable by the downstream extractCriterion regex.
 */

import { describe, it, expect } from 'vitest';
import { mapIbmResults, IBM_WCAG_MAP, type IbmReport } from '../../src/ibm/map.js';

describe('mapIbmResults', () => {
  it('maps a VIOLATION (known criterion) to an error Issue', () => {
    const report: IbmReport = {
      results: [
        {
          ruleId: 'img_alt_valid',
          value: ['VIOLATION', 'FAIL'],
          path: { dom: '/html/body/img[1]', aria: '/document/img[1]' },
          snippet: '<img src="hero.png">',
          message: 'Image does not have a valid text alternative',
          reasonId: 'Fail_2',
        },
      ],
    };
    const issues = mapIbmResults(report);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('error');
    expect(issues[0]?.runner).toBe('ibm');
    expect(issues[0]?.code).toBe('Luqen.IBM.1_1_1.img_alt_valid');
    expect(issues[0]?.code).toMatch(/1_1_1/);
    expect(issues[0]?.selector).toBe('/html/body/img[1]');
    expect(issues[0]?.context).toBe('<img src="hero.png">');
    expect(issues[0]?.message).toBe('Image does not have a valid text alternative');
  });

  it('maps a RECOMMENDATION (known criterion) to a warning Issue', () => {
    const report: IbmReport = {
      results: [
        {
          ruleId: 'skip_main_exists',
          value: ['RECOMMENDATION', 'POTENTIAL'],
          path: { dom: '/html/body', aria: '/document' },
          snippet: '<body>',
          message: 'Verify a way to bypass blocks of content exists',
        },
      ],
    };
    const issues = mapIbmResults(report);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('warning');
    expect(issues[0]?.runner).toBe('ibm');
    expect(issues[0]?.code).toBe('Luqen.IBM.2_4_1.skip_main_exists');
  });

  it('skips INFORMATION results', () => {
    const report: IbmReport = {
      results: [
        {
          ruleId: 'img_alt_valid',
          value: ['INFORMATION', 'PASS'],
          path: { dom: '/html/body/img[1]' },
          snippet: '<img alt="ok">',
          message: 'informational',
        },
      ],
    };
    expect(mapIbmResults(report)).toHaveLength(0);
  });

  it('skips PASS results', () => {
    const report: IbmReport = {
      results: [
        {
          ruleId: 'page_title_exists',
          value: ['PASS', 'PASS'],
          path: { dom: '/html/head/title' },
          snippet: '<title>OK</title>',
          message: 'has title',
        },
      ],
    };
    expect(mapIbmResults(report)).toHaveLength(0);
  });

  it('skips an actionable result whose ruleId is not WCAG-attributable', () => {
    const report: IbmReport = {
      results: [
        {
          ruleId: 'some_unknown_future_rule',
          value: ['VIOLATION', 'FAIL'],
          path: { dom: '/html/body/div[1]' },
          snippet: '<div>',
          message: 'unmappable',
        },
      ],
    };
    expect(mapIbmResults(report)).toHaveLength(0);
  });

  it('maps a mixed report correctly (violation + recommendation kept; rest skipped)', () => {
    const report: IbmReport = {
      results: [
        { ruleId: 'img_alt_valid', value: ['VIOLATION', 'FAIL'], path: { dom: '#a' }, snippet: '<img>', message: 'm1' },
        { ruleId: 'skip_main_exists', value: ['RECOMMENDATION', 'POTENTIAL'], path: { dom: '#b' }, snippet: '<body>', message: 'm2' },
        { ruleId: 'img_alt_valid', value: ['INFORMATION', 'PASS'], path: { dom: '#c' }, snippet: '<img>', message: 'm3' },
        { ruleId: 'page_title_exists', value: ['PASS', 'PASS'], path: { dom: '#d' }, snippet: '<title>', message: 'm4' },
        { ruleId: 'unmappable_rule', value: ['VIOLATION', 'FAIL'], path: { dom: '#e' }, snippet: '<x>', message: 'm5' },
      ],
    };
    const issues = mapIbmResults(report);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.type)).toEqual(['error', 'warning']);
    expect(issues.every((i) => i.runner === 'ibm')).toBe(true);
    expect(issues[0]?.code).toBe('Luqen.IBM.1_1_1.img_alt_valid');
    expect(issues[1]?.code).toBe('Luqen.IBM.2_4_1.skip_main_exists');
  });

  it('falls back to aria path, then to html, for the selector', () => {
    const report: IbmReport = {
      results: [
        { ruleId: 'aria_role_allowed', value: ['VIOLATION', 'FAIL'], path: { aria: '/document/button[1]' }, message: 'bad role' },
        { ruleId: 'aria_role_allowed', value: ['VIOLATION', 'FAIL'], message: 'no path' },
      ],
    };
    const issues = mapIbmResults(report);
    expect(issues).toHaveLength(2);
    expect(issues[0]?.selector).toBe('/document/button[1]');
    expect(issues[1]?.selector).toBe('html');
  });

  it('respects the max cap', () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      ruleId: 'img_alt_valid',
      value: ['VIOLATION', 'FAIL'],
      path: { dom: `#n${i}` },
      snippet: '<img>',
      message: 'm',
    }));
    expect(mapIbmResults({ results }, 3)).toHaveLength(3);
  });

  it('returns [] for an undefined / empty report', () => {
    expect(mapIbmResults(undefined)).toHaveLength(0);
    expect(mapIbmResults({})).toHaveLength(0);
    expect(mapIbmResults({ results: [] })).toHaveLength(0);
  });

  it('every mapped criterion is parseable by the downstream regex', () => {
    const re = /(\d+)_(\d+)_(\d+)/;
    for (const criterion of Object.values(IBM_WCAG_MAP)) {
      expect(criterion).toMatch(re);
    }
  });
});
