/**
 * Fast (non-browser) unit tests for the reflow observation → Issue mapper.
 *
 * Feeds synthetic reflow observations (no real browser run) and asserts:
 *  - page-overflow → error Issue (WCAG 1.4.10), runner='reflow',
 *  - element-overflow → warning Issue (WCAG 1.4.10) — conservative,
 *  - zoom-disabled → error Issue (WCAG 1.4.4),
 *  - selector/context/message wiring (and per-kind default messages),
 *  - observations with an unknown kind are skipped,
 *  - the per-page cap is respected,
 *  - every mapped criterion is parseable by the downstream extractCriterion regex.
 */

import { describe, it, expect } from 'vitest';
import {
  mapReflowObservations,
  KIND_MAP,
  type ReflowObservation,
} from '../../src/reflow/map.js';

describe('mapReflowObservations', () => {
  it('maps a page-overflow observation to an error Issue (1.4.10)', () => {
    const obs: ReflowObservation[] = [
      {
        kind: 'page-overflow',
        selector: 'html',
        snippet: '',
        message: 'Page content is 980px wide but the viewport is 320px',
      },
    ];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('error');
    expect(issues[0]?.runner).toBe('reflow');
    expect(issues[0]?.code).toBe('Luqen.Reflow.1_4_10.page_overflow');
    expect(issues[0]?.code).toMatch(/1_4_10/);
    expect(issues[0]?.selector).toBe('html');
    expect(issues[0]?.message).toBe('Page content is 980px wide but the viewport is 320px');
  });

  it('maps an element-overflow observation to a warning Issue (1.4.10)', () => {
    const obs: ReflowObservation[] = [
      {
        kind: 'element-overflow',
        selector: 'table#prices',
        snippet: '<table id="prices">',
        message: 'Element reaches 760px (viewport 320px)',
      },
    ];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('warning');
    expect(issues[0]?.runner).toBe('reflow');
    expect(issues[0]?.code).toBe('Luqen.Reflow.1_4_10.element_overflow');
    expect(issues[0]?.selector).toBe('table#prices');
    expect(issues[0]?.context).toBe('<table id="prices">');
  });

  it('maps a zoom-disabled observation to an error Issue (1.4.4)', () => {
    const obs: ReflowObservation[] = [
      {
        kind: 'zoom-disabled',
        selector: 'meta[name="viewport"]',
        snippet: 'width=device-width, user-scalable=no',
      },
    ];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('error');
    expect(issues[0]?.runner).toBe('reflow');
    expect(issues[0]?.code).toBe('Luqen.Reflow.1_4_4.zoom_disabled');
    expect(issues[0]?.code).toMatch(/1_4_4/);
    expect(issues[0]?.selector).toBe('meta[name="viewport"]');
  });

  it('falls back to a per-kind default message when none is supplied', () => {
    const obs: ReflowObservation[] = [{ kind: 'page-overflow' }];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('WCAG 1.4.10');
    // No selector supplied → defaults to 'html'; no snippet → empty context.
    expect(issues[0]?.selector).toBe('html');
    expect(issues[0]?.context).toBe('');
  });

  it('skips observations with an unknown kind', () => {
    const obs = [
      { kind: 'page-overflow', selector: 'html' },
      { kind: 'some-future-kind', selector: 'div' },
    ] as unknown as ReflowObservation[];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('Luqen.Reflow.1_4_10.page_overflow');
  });

  it('maps a mixed observation list correctly', () => {
    const obs: ReflowObservation[] = [
      { kind: 'page-overflow', selector: 'html' },
      { kind: 'element-overflow', selector: 'div.wide' },
      { kind: 'zoom-disabled', selector: 'meta[name="viewport"]' },
    ];
    const issues = mapReflowObservations(obs);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.type)).toEqual(['error', 'warning', 'error']);
    expect(issues.every((i) => i.runner === 'reflow')).toBe(true);
  });

  it('respects the max cap', () => {
    const obs: ReflowObservation[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'element-overflow' as const,
      selector: `div.n${i}`,
    }));
    expect(mapReflowObservations(obs, 3)).toHaveLength(3);
  });

  it('returns [] for an undefined / empty observation list', () => {
    expect(mapReflowObservations(undefined)).toHaveLength(0);
    expect(mapReflowObservations([])).toHaveLength(0);
  });

  it('every mapped criterion is parseable by the downstream regex', () => {
    const re = /(\d+)_(\d+)_(\d+)/;
    for (const { criterion } of Object.values(KIND_MAP)) {
      expect(criterion).toMatch(re);
    }
  });
});
