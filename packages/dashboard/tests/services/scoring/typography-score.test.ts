import { describe, it, expect } from 'vitest';
import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import { calculateTypographySubScore } from '../../../src/services/scoring/typography-score.js';

function issue(context: string): BrandedIssue {
  return {
    issue: {
      code: 'x',
      type: 'warning',
      message: '',
      selector: 'body',
      context,
    },
    brandMatch: { matched: false },
  };
}

function guideline(
  fontFamilies: readonly string[],
  metrics?: { xHeight?: number; unitsPerEm?: number },
): BrandGuideline {
  return {
    id: 'g1',
    orgId: 'o1',
    name: 'Test',
    version: 1,
    active: true,
    colors: [],
    fonts: fontFamilies.map((family, i) => ({
      id: `f${i}`,
      family,
      ...(metrics ? { xHeight: metrics.xHeight, unitsPerEm: metrics.unitsPerEm } : {}),
    })),
    selectors: [],
  };
}

describe('calculateTypographySubScore', () => {
  it('returns unscorable when no typography data extractable', () => {
    const result = calculateTypographySubScore(
      [issue('<div>no css here</div>')],
      guideline(['Inter']),
    );
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-typography-data' });
  });

  it('returns unscorable for empty issue list', () => {
    const result = calculateTypographySubScore([], guideline(['Inter']));
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-typography-data' });
  });

  it('scores 100 when all three heuristics pass', () => {
    const ctx = 'font-family: Inter, sans-serif; font-size: 16px; line-height: 1.5;';
    const result = calculateTypographySubScore([issue(ctx)], guideline(['Inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(100);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: true,
      });
    }
  });

  it('scores 67 when 2 of 3 heuristics pass', () => {
    // Font and size pass, line-height fails (below threshold)
    const ctx = 'font-family: Inter; font-size: 18px; line-height: 1.2;';
    const result = calculateTypographySubScore([issue(ctx)], guideline(['Inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(67);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: false,
      });
    }
  });

  it('scores 33 when only 1 of 3 passes', () => {
    // Only size passes; font does not match, no line-height
    const ctx = 'font-family: Arial; font-size: 20px;';
    const result = calculateTypographySubScore([issue(ctx)], guideline(['Inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(33);
    }
  });

  it('fontOk matches case-insensitively and on substring', () => {
    const ctx = 'font-family: "INTER", sans-serif;';
    const result = calculateTypographySubScore([issue(ctx)], guideline(['inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.fontOk).toBe(true);
    }
  });

  it('sizeOk accepts pt units converted to px (13.5pt -> 18px)', () => {
    const ctx = 'font-size: 13.5pt;';
    const result = calculateTypographySubScore([issue(ctx)], guideline([]));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.sizeOk).toBe(true);
    }
  });

  it('sizeOk fails for 14px body text (too small)', () => {
    const ctx = 'font-size: 14px;';
    const result = calculateTypographySubScore([issue(ctx)], guideline([]));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.sizeOk).toBe(false);
    }
  });

  it('em/rem/% sizes are skipped (no parent context)', () => {
    // em/rem/% would normally imply body size, but we cannot resolve — skip.
    const ctx = 'font-size: 1em; font-size: 100%;';
    const result = calculateTypographySubScore([issue(ctx)], guideline([]));
    // Skipping means pxSizes empty, but lineHeights/families also empty.
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-typography-data' });
  });

  it('lineHeightOk passes at exactly the threshold', () => {
    const ctx = 'line-height: 1.5;';
    const result = calculateTypographySubScore([issue(ctx)], guideline([]));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.lineHeightOk).toBe(true);
    }
  });

  it('lineHeightOk fails at 1.49', () => {
    const ctx = 'line-height: 1.49;';
    const result = calculateTypographySubScore([issue(ctx)], guideline([]));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.lineHeightOk).toBe(false);
    }
  });

  it('aggregates across multiple issues (any pass -> heuristic passes)', () => {
    const issues = [
      issue('font-family: NotMatching;'),   // fails fontOk alone
      issue('font-family: Inter;'),         // passes fontOk
    ];
    const result = calculateTypographySubScore(issues, guideline(['Inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'typography' && result.detail.fontOk).toBe(true);
    }
  });

  it('ReDoS guard: 10KB pathological input completes under 100ms', () => {
    // 10,000 repetitions of "font-family: x, " — a structure that can
    // trigger catastrophic backtracking with unbounded regexes.
    const pathological = 'font-family: x, '.repeat(10000);
    const start = Date.now();
    const result = calculateTypographySubScore([issue(pathological)], guideline(['x']));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    // Should still return a result, not hang or throw.
    expect(result.kind).toBe('scored');
  });

  // ---------------------------------------------------------------------------
  // x-height 4th heuristic tests
  // ---------------------------------------------------------------------------

  it('uses 4-way mean when guideline fonts have xHeight metrics (all pass = 100)', () => {
    const ctx = 'font-family: Inter, sans-serif; font-size: 16px; line-height: 1.5;';
    const result = calculateTypographySubScore(
      [issue(ctx)],
      guideline(['Inter'], { xHeight: 1118, unitsPerEm: 2048 }),
    );
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // 4/4 pass = 100
      expect(result.value).toBe(100);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: true,
        xHeightOk: true,
      });
    }
  });

  it('uses 3-way fallback when NO guideline font has xHeight metrics', () => {
    const ctx = 'font-family: Inter, sans-serif; font-size: 16px; line-height: 1.5;';
    // No metrics — should behave identically to original 3-way mean
    const result = calculateTypographySubScore([issue(ctx)], guideline(['Inter']));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(100);
      // xHeightOk should NOT be present in the 3-way fallback detail
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: true,
      });
    }
  });

  it('xHeightOk = true when observed font matches guideline font with metrics', () => {
    const ctx = 'font-family: Inter; font-size: 14px; line-height: 1.2;';
    const result = calculateTypographySubScore(
      [issue(ctx)],
      guideline(['Inter'], { xHeight: 1118, unitsPerEm: 2048 }),
    );
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // fontOk=true, sizeOk=false, lineHeightOk=false, xHeightOk=true => 2/4 = 50
      expect(result.value).toBe(50);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: false,
        lineHeightOk: false,
        xHeightOk: true,
      });
    }
  });

  it('xHeightOk = false when observed font does NOT match any guideline font with metrics', () => {
    const ctx = 'font-family: Arial; font-size: 16px; line-height: 1.5;';
    const result = calculateTypographySubScore(
      [issue(ctx)],
      guideline(['Inter'], { xHeight: 1118, unitsPerEm: 2048 }),
    );
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // fontOk=false, sizeOk=true, lineHeightOk=true, xHeightOk=false => 2/4 = 50
      expect(result.value).toBe(50);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: false,
        sizeOk: true,
        lineHeightOk: true,
        xHeightOk: false,
      });
    }
  });

  it('4-way mean: 3 of 4 pass = 75', () => {
    // font matches, size ok, lineHeight ok, but xHeightOk = false (font not in metrics list)
    const ctx = 'font-family: Arial; font-size: 16px; line-height: 1.5;';
    // Arial observed but Inter is the guideline font with metrics
    const g: BrandGuideline = {
      id: 'g1', orgId: 'o1', name: 'Test', version: 1, active: true, colors: [],
      fonts: [
        { id: 'f0', family: 'Arial' },  // no metrics
        { id: 'f1', family: 'Inter', xHeight: 1118, unitsPerEm: 2048 },  // has metrics
      ],
      selectors: [],
    };
    const result = calculateTypographySubScore([issue(ctx)], g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // fontOk=true (Arial matches), sizeOk=true, lineHeightOk=true, xHeightOk=false (Arial has no metrics)
      expect(result.value).toBe(75);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: true,
        xHeightOk: false,
      });
    }
  });

  it('mixed guideline: uses fonts with metrics for xHeightOk check', () => {
    const ctx = 'font-family: Inter; font-size: 16px; line-height: 1.5;';
    // Mixed: Inter has metrics, Roboto does not
    const g: BrandGuideline = {
      id: 'g1', orgId: 'o1', name: 'Test', version: 1, active: true, colors: [],
      fonts: [
        { id: 'f0', family: 'Roboto' },  // no metrics
        { id: 'f1', family: 'Inter', xHeight: 1118, unitsPerEm: 2048 },  // has metrics
      ],
      selectors: [],
    };
    const result = calculateTypographySubScore([issue(ctx)], g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // fontOk=true (Inter matches), sizeOk=true, lineHeightOk=true,
      // xHeightOk=true (Inter observed AND Inter has metrics)
      expect(result.value).toBe(100);
      expect(result.detail).toEqual({
        dimension: 'typography',
        fontOk: true,
        sizeOk: true,
        lineHeightOk: true,
        xHeightOk: true,
      });
    }
  });
});
