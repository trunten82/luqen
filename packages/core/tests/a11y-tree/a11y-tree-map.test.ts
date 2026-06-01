/**
 * Fast (non-browser) unit tests for the accessibility-tree observation → Issue
 * mapper.
 *
 * Feeds synthetic observations (no real browser / CDP run) and asserts:
 *  - missing-name → error Issue (WCAG 4.1.2), runner='a11y-tree', role woven into
 *    the default message,
 *  - positive-tabindex → warning Issue (WCAG 2.4.3),
 *  - selector/context wiring + per-kind default messages,
 *  - observations with an unknown kind are skipped,
 *  - the per-page cap is respected,
 *  - every mapped criterion is parseable by the downstream extractCriterion regex.
 */

import { describe, it, expect } from 'vitest';
import {
  mapA11yTreeObservations,
  KIND_MAP,
  type A11yTreeObservation,
} from '../../src/a11y-tree/map.js';

describe('mapA11yTreeObservations', () => {
  it('maps a missing-name observation to an error Issue (4.1.2)', () => {
    const obs: A11yTreeObservation[] = [
      { kind: 'missing-name', role: 'button', selector: 'button.icon', snippet: '<button class="icon"></button>' },
    ];
    const issues = mapA11yTreeObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('error');
    expect(issues[0]?.runner).toBe('a11y-tree');
    expect(issues[0]?.code).toBe('Luqen.A11yTree.4_1_2.missing_name');
    expect(issues[0]?.code).toMatch(/4_1_2/);
    expect(issues[0]?.selector).toBe('button.icon');
    expect(issues[0]?.context).toBe('<button class="icon"></button>');
    // Role is woven into the default message.
    expect(issues[0]?.message).toContain('role "button"');
    expect(issues[0]?.message).toContain('WCAG 4.1.2');
  });

  it('maps a positive-tabindex observation to a warning Issue (2.4.3)', () => {
    const obs: A11yTreeObservation[] = [
      { kind: 'positive-tabindex', selector: 'div#hero', snippet: '<div id="hero" tabindex="3">' },
    ];
    const issues = mapA11yTreeObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.type).toBe('warning');
    expect(issues[0]?.runner).toBe('a11y-tree');
    expect(issues[0]?.code).toBe('Luqen.A11yTree.2_4_3.positive_tabindex');
    expect(issues[0]?.code).toMatch(/2_4_3/);
    expect(issues[0]?.selector).toBe('div#hero');
    expect(issues[0]?.message).toContain('WCAG 2.4.3');
  });

  it('uses a per-kind default message and falls back selector→html / no context', () => {
    const obs: A11yTreeObservation[] = [{ kind: 'missing-name' }];
    const issues = mapA11yTreeObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.selector).toBe('html');
    expect(issues[0]?.context).toBe('');
    // No role supplied → message omits the role clause but still cites 4.1.2.
    expect(issues[0]?.message).toContain('WCAG 4.1.2');
    expect(issues[0]?.message).not.toContain('role "');
  });

  it('prefers an explicit message over the default', () => {
    const obs: A11yTreeObservation[] = [
      { kind: 'positive-tabindex', selector: 'a', message: 'custom note' },
    ];
    expect(mapA11yTreeObservations(obs)[0]?.message).toBe('custom note');
  });

  it('skips observations with an unknown kind', () => {
    const obs = [
      { kind: 'missing-name', role: 'link' },
      { kind: 'reading-order-divergence', selector: 'div' },
    ] as unknown as A11yTreeObservation[];
    const issues = mapA11yTreeObservations(obs);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('Luqen.A11yTree.4_1_2.missing_name');
  });

  it('maps a mixed observation list correctly', () => {
    const obs: A11yTreeObservation[] = [
      { kind: 'missing-name', role: 'link' },
      { kind: 'positive-tabindex', selector: 'span' },
    ];
    const issues = mapA11yTreeObservations(obs);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.type)).toEqual(['error', 'warning']);
    expect(issues.every((i) => i.runner === 'a11y-tree')).toBe(true);
  });

  it('respects the max cap', () => {
    const obs: A11yTreeObservation[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'missing-name' as const,
      role: 'button',
      selector: `button.n${i}`,
    }));
    expect(mapA11yTreeObservations(obs, 3)).toHaveLength(3);
  });

  it('returns [] for an undefined / empty observation list', () => {
    expect(mapA11yTreeObservations(undefined)).toHaveLength(0);
    expect(mapA11yTreeObservations([])).toHaveLength(0);
  });

  it('every mapped criterion is parseable by the downstream regex', () => {
    const re = /(\d+)_(\d+)_(\d+)/;
    for (const { criterion } of Object.values(KIND_MAP)) {
      expect(criterion).toMatch(re);
    }
  });
});
