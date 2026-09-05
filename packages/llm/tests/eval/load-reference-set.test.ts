import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadWcagFixSet, loadImageAltSet } from '../../src/eval/load-reference-set.js';

const WCAG_FIXES_V1_PATH = join(__dirname, 'sets', 'wcag-fixes.v1.json');
const IMAGE_ALT_V1_PATH = join(__dirname, 'sets', 'image-alt.v1.json');

describe('loadWcagFixSet', () => {
  it('loads the committed v1 set end to end', () => {
    const result = loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');

    expect(result.set).toBe('wcag-fixes');
    expect(result.setVersion).toBe('v1');
    expect(result.capability).toBe('generate-fix');
    // Was toHaveLength(1) when only the 83-01 seed item existed. Plan 83-02
    // populated the set to 17 items (15 w3c-tier + 2 derived); a hardcoded
    // count here would break every time the set legitimately grows. Assert
    // the seed item is still present instead of the total count.
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some((item) => item.id === 'wcag-img-missing-alt-01')).toBe(true);
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

describe('loadImageAltSet', () => {
  it('loads the committed v1 image set end to end (83-03 populated it beyond the 83-01 seed)', () => {
    const result = loadImageAltSet(IMAGE_ALT_V1_PATH, 'v1');

    expect(result.set).toBe('image-alt');
    expect(result.capability).toBe('analyse-visual');
    // >=12, not an exact count: this asserts the loader still works end to
    // end against whatever the committed set currently holds, without
    // re-coupling this loader test to image-alt-set.test.ts's own content
    // gate (which owns the precise item-count/category assertions).
    expect(result.items.length).toBeGreaterThanOrEqual(12);
  });

  it('carries expectedVerdict as data, never derived', () => {
    const result = loadImageAltSet(IMAGE_ALT_V1_PATH, 'v1');
    const item = result.items[0];

    expect(['issue', 'pass']).toContain(item.expectedVerdict);
    expect(item.category).toBeDefined();
    expect(item.input.check).toBe('alt-text');
    expect(item.input.context.length).toBeGreaterThan(0);
    expect(item.expected.suggestedAlt.length).toBeGreaterThan(0);
  });

  it('carries a licence block with all required fields non-empty', () => {
    const result = loadImageAltSet(IMAGE_ALT_V1_PATH, 'v1');
    const item = result.items[0];

    expect(item.licence.id.length).toBeGreaterThan(0);
    expect(item.licence.sourceUrl.length).toBeGreaterThan(0);
    expect(item.licence.fileUrl.length).toBeGreaterThan(0);
    expect(item.licence.author.length).toBeGreaterThan(0);
    expect(item.licence.retrievedAt.length).toBeGreaterThan(0);
  });

  it('resolves the asset path from the item id, with no caller-supplied path field', () => {
    const result = loadImageAltSet(IMAGE_ALT_V1_PATH, 'v1');
    const item = result.items[0];

    expect(existsSync(item.assetPath)).toBe(true);
    expect(item.assetPath.endsWith('.jpg')).toBe(true);
    // No caller-supplied asset path field exists on the raw item shape.
    expect((item as unknown as Record<string, unknown>).path).toBeUndefined();
    expect((item as unknown as Record<string, unknown>).assetFile).toBeUndefined();
  });
});
