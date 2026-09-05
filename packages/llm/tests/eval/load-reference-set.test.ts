import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadWcagFixSet } from '../../src/eval/load-reference-set.js';

const WCAG_FIXES_V1_PATH = join(__dirname, 'sets', 'wcag-fixes.v1.json');

describe('loadWcagFixSet', () => {
  it('loads the committed one-item v1 set end to end', () => {
    const result = loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');

    expect(result.set).toBe('wcag-fixes');
    expect(result.setVersion).toBe('v1');
    expect(result.capability).toBe('generate-fix');
    expect(result.items).toHaveLength(1);
  });

  it('returns an item with the expected input/expected fields', () => {
    const result = loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');
    const item = result.items[0];

    expect(item.id).toBe('wcag-img-missing-alt-01');
    expect(item.input.wcagCriterion).toBe('1.1.1');
    expect(item.input.htmlContext.length).toBeGreaterThan(0);
    expect(item.expected.fixedHtml.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(item.expected.effort);
  });

  it('carries both the F65 failure citation and the H37 technique citation', () => {
    const result = loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');
    const item = result.items[0];

    expect(item.provenance.tier).toBe('w3c');
    if (item.provenance.tier !== 'w3c') throw new Error('expected w3c tier');
    expect(item.provenance.failure.id).toBe('F65');
    expect(item.provenance.technique.id).toBe('H37');
    expect(item.provenance.failure.url.length).toBeGreaterThan(0);
    expect(item.provenance.technique.url.length).toBeGreaterThan(0);
    expect(item.provenance.failure.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(item.provenance.technique.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('returns a frozen items array whose items cannot be mutated', () => {
    const result = loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');

    expect(Object.isFrozen(result.items)).toBe(true);

    const item = result.items[0];
    expect(() => {
      // @ts-expect-error -- deliberately mutating a readonly field to prove it is frozen
      item.id = 'mutated';
    }).toThrow();
    expect(item.id).toBe('wcag-img-missing-alt-01');
  });
});
