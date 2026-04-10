import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrandedIssue, BrandGuideline, BrandColor } from '@luqen/branding';
import { calculateTokenSubScore } from '../../../src/services/scoring/token-score.js';

function brandColor(hex: string, name = 'test'): BrandColor {
  return { id: `c-${hex}`, name, hexValue: hex };
}

function guideline(colors: readonly BrandColor[]): BrandGuideline {
  return {
    id: 'g1',
    orgId: 'o1',
    name: 'Test',
    version: 1,
    active: true,
    colors,
    fonts: [],
    selectors: [],
  };
}

function issue(context: string): BrandedIssue {
  return {
    issue: {
      code: 'x',
      type: 'warning',
      message: '',
      selector: 'div',
      context,
    },
    brandMatch: { matched: false },
  };
}

describe('calculateTokenSubScore', () => {
  it('returns unscorable when guideline has zero colors (D-03 no-component-tokens)', () => {
    const result = calculateTokenSubScore([issue('#ff0000 #00ff00')], guideline([]));
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-component-tokens' });
  });

  it('returns unscorable when every guideline hex is malformed (normalizeHex filters them out)', () => {
    const result = calculateTokenSubScore(
      [issue('#ff0000')],
      guideline([brandColor('not-a-hex'), brandColor('purple')]),
    );
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-component-tokens' });
  });

  it('scores 100 when all brand tokens appear in used tokens', () => {
    const issues = [
      issue('color: #ff0000'),
      issue('background: #00ff00'),
    ];
    const g = guideline([brandColor('#FF0000'), brandColor('#00FF00')]);
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(100);
      expect(result.detail).toEqual({ dimension: 'components', matched: 2, total: 2 });
    }
  });

  it('scores 50 when half the brand tokens appear', () => {
    const issues = [issue('color: #ff0000')];
    const g = guideline([brandColor('#FF0000'), brandColor('#00FF00')]);
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(50);
      expect(result.detail).toEqual({ dimension: 'components', matched: 1, total: 2 });
    }
  });

  it('scores 0 when no brand tokens appear anywhere', () => {
    const issues = [issue('color: #123456')];
    const g = guideline([brandColor('#ff0000'), brandColor('#00ff00')]);
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(0);
      expect(result.detail).toEqual({ dimension: 'components', matched: 0, total: 2 });
    }
  });

  it('scores 0 when issues list is empty but guideline has colors', () => {
    const g = guideline([brandColor('#ff0000')]);
    const result = calculateTokenSubScore([], g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.value).toBe(0);
      expect(result.detail).toEqual({ dimension: 'components', matched: 0, total: 1 });
    }
  });

  it('normalizes guideline hex (3-digit and mixed case) to 6-digit uppercase', () => {
    const issues = [issue('color: #ff0000')];
    const g = guideline([brandColor('#f00')]); // expands to #FF0000
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'components' && result.detail.matched).toBe(1);
    }
  });

  it('recognizes rgb() in context as equivalent to hex', () => {
    const issues = [issue('color: rgb(255, 0, 0)')];
    const g = guideline([brandColor('#ff0000')]);
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.detail.dimension === 'components' && result.detail.matched).toBe(1);
    }
  });

  it('filters malformed guideline colors but scores the remainder', () => {
    const issues = [issue('color: #ff0000')];
    const g = guideline([
      brandColor('#ff0000'),
      brandColor('not-a-color'),      // filtered by normalizeHex
      brandColor('#00ff00'),
    ]);
    const result = calculateTokenSubScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // brandTokens has 2 valid entries, 1 matches -> 50
      expect(result.value).toBe(50);
      expect(result.detail).toEqual({ dimension: 'components', matched: 1, total: 2 });
    }
  });

  it('source comment documents the v2.11.0 brand color coverage scope', () => {
    // Guardrail: future editors must not remove the D-09/D-10 scoping comment.
    // This test reads the source file directly.
    const source = readFileSync(
      resolve(__dirname, '../../../src/services/scoring/token-score.ts'),
      'utf8',
    );
    expect(source).toContain('v2.11.0 component sub-score is brand color coverage only');
    expect(source).toContain('See Phase 15 CONTEXT D-09/D-10');
  });
});
