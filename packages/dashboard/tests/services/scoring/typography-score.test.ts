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

function guideline(fontFamilies: readonly string[]): BrandGuideline {
  return {
    id: 'g1',
    orgId: 'o1',
    name: 'Test',
    version: 1,
    active: true,
    colors: [],
    fonts: fontFamilies.map((family, i) => ({ id: `f${i}`, family })),
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
});
