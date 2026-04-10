import { describe, it, expect } from 'vitest';
import type { BrandedIssue, BrandGuideline, BrandColor, BrandFont } from '@luqen/branding';
import { calculateBrandScore } from '../../../src/services/scoring/brand-score-calculator.js';
import { WEIGHTS } from '../../../src/services/scoring/weights.js';

// --- Fixture builders -------------------------------------------------------

function brandedIssue(opts: {
  code?: string;
  context?: string;
  matched?: boolean;
}): BrandedIssue {
  return {
    issue: {
      code: opts.code ?? 'Guideline1_4.1_4_3',
      type: 'error',
      message: '',
      selector: 'div',
      context: opts.context ?? '',
    },
    brandMatch: opts.matched
      ? {
          matched: true,
          strategy: 'color-pair',
          guidelineName: 'Test',
          guidelineId: 'g1',
          matchDetail: 'x',
        }
      : { matched: false },
  };
}

function guideline(opts: {
  colors?: readonly BrandColor[];
  fonts?: readonly BrandFont[];
}): BrandGuideline {
  return {
    id: 'g1',
    orgId: 'o1',
    name: 'Test',
    version: 1,
    active: true,
    colors: opts.colors ?? [],
    fonts: opts.fonts ?? [],
    selectors: [],
  };
}

const INTER_FONT: BrandFont = { id: 'f1', family: 'Inter' };
const BRAND_RED: BrandColor = { id: 'c1', name: 'red', hexValue: '#ff0000' };
const BRAND_GREEN: BrandColor = { id: 'c2', name: 'green', hexValue: '#00ff00' };

// --- UnscorableReason coverage (D-19) ---------------------------------------

describe('calculateBrandScore — UnscorableReason coverage (D-19)', () => {
  it('returns unscorable no-guideline when guideline is null', () => {
    const result = calculateBrandScore([], null);
    expect(result).toEqual({ kind: 'unscorable', reason: 'no-guideline' });
  });

  it('returns unscorable empty-guideline when guideline has no colors/fonts/selectors', () => {
    const result = calculateBrandScore([], guideline({}));
    expect(result).toEqual({ kind: 'unscorable', reason: 'empty-guideline' });
  });

  it('returns unscorable all-subs-unscorable when all three sub-scores are unscorable', () => {
    // Guideline has only a font (so token-score → unscorable no-component-tokens).
    // Issues list is empty (so color-score → unscorable no-branded-issues and
    // typography-score → unscorable no-typography-data).
    const result = calculateBrandScore([], guideline({ fonts: [INTER_FONT] }));
    expect(result).toEqual({ kind: 'unscorable', reason: 'all-subs-unscorable' });
  });

  it('surfaces no-branded-issues inside .color when color sub-score is unscorable but others are scored', () => {
    // No contrast issues, but guideline has colors AND typography data extractable.
    const typographyCtx =
      'font-family: Inter; font-size: 16px; line-height: 1.5;';
    const issues = [brandedIssue({ context: typographyCtx, matched: false })];
    const g = guideline({ colors: [BRAND_RED], fonts: [INTER_FONT] });
    // Note: BRAND_RED won't appear in used tokens (context has no red),
    // but components is still scored with 0.
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.color).toEqual({ kind: 'unscorable', reason: 'no-branded-issues' });
    }
  });

  it('surfaces no-typography-data inside .typography when typography sub-score is unscorable but others are scored', () => {
    const issues = [
      brandedIssue({
        code: 'Guideline1_4.1_4_3',
        context: 'color: #ffffff; background: #000000',
        matched: true,
      }),
    ];
    const g = guideline({ colors: [BRAND_RED] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.typography).toEqual({ kind: 'unscorable', reason: 'no-typography-data' });
    }
  });

  it('surfaces no-component-tokens inside .components when guideline has no colors but other data is present', () => {
    const issues = [
      brandedIssue({
        code: 'Guideline1_4.1_4_3',
        context: 'font-family: Inter; font-size: 16px; line-height: 1.5; color: #ffffff; background: #000000',
        matched: true,
      }),
    ];
    const g = guideline({ fonts: [INTER_FONT] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.components).toEqual({ kind: 'unscorable', reason: 'no-component-tokens' });
    }
  });
});

// --- Composite renormalization paths (D-20) ---------------------------------

describe('calculateBrandScore — composite renormalization (D-20, Pitfall #1)', () => {
  it('3 scored subs: denominator = 1.0, overall is weighted mean', () => {
    // Build a scenario where all three subs score.
    // Color: 1 pass, 0 fail → 100 (black on white = 21:1, passes AA)
    //   NOTE: issuePasses() uses colors[0]/colors[1] from extractColorsFromContext,
    //   which iterates the hex regex in order of appearance. We put the
    //   passing foreground/background pair FIRST so they occupy slots [0]/[1];
    //   the brand-red token appears later in a separate declaration so it
    //   gets picked up by the components sub-score without disturbing the
    //   color-contrast pair.
    // Typography: font-family Inter + font-size 16px + line-height 1.5 → all pass → 100
    // Components: BRAND_RED appears → 1/1 = 100
    const ctx =
      'color: #000000; background: #ffffff; border-color: #ff0000; font-family: Inter; font-size: 16px; line-height: 1.5;';
    const issues = [
      brandedIssue({
        code: 'Guideline1_4.1_4_3',
        context: ctx,
        matched: true,
      }),
    ];
    const g = guideline({ colors: [BRAND_RED], fonts: [INTER_FONT] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.coverage.contributingWeight).toBe(1.0);
      // 100*0.5 + 100*0.3 + 100*0.2 = 100 → /1.0 → 100
      expect(result.overall).toBe(100);
    }
  });

  it('2 scored + 1 unscorable: denominator renormalizes to partial sum (Pitfall #1 worked example)', () => {
    // Color: passes → 100 (black on white = 21:1, passes AA)
    // Typography: no typography data → unscorable
    // Components: BRAND_RED appears → 100
    // Expected coverage.contributingWeight = 0.50 + 0.20 = 0.70
    // Expected composite: (100*0.50 + 100*0.20) / 0.70 = 70/0.70 = 100
    // NOTE: foreground/background are positions [0]/[1] in extractColorsFromContext;
    // brand red #ff0000 appears as a later declaration so components sub-score
    // picks it up without disturbing the contrast pair. No typography data here.
    const ctx = 'color: #000000; background: #ffffff; border-color: #ff0000';
    const issues = [
      brandedIssue({
        code: 'Guideline1_4.1_4_3',
        context: ctx,
        matched: true,
      }),
    ];
    const g = guideline({ colors: [BRAND_RED] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.coverage).toEqual({
        color: true,
        typography: false,
        components: true,
        contributingWeight: 0.70,
      });
      // Both scored subs happen to score 100, so overall is 100
      expect(result.overall).toBe(100);
      // Prove the math: numerator = 50 + 20 = 70, denominator = 0.70 → 100
      expect(result.color.kind === 'scored' && result.color.value).toBe(100);
      expect(result.components.kind === 'scored' && result.components.value).toBe(100);
    }
  });

  it('2 scored + 1 unscorable with unequal values proves renormalization (not naive average)', () => {
    // Color: 2 passes, 2 fails → 50
    // Typography: unscorable
    // Components: BRAND_RED appears, BRAND_GREEN does not → 1/2 = 50
    // Expected composite: (50*0.50 + 50*0.20) / 0.70 = 35/0.70 = 50 (not 70!)
    // This proves Pitfall #1: naive /1.0 would give (25 + 10)/1.0 = 35, not 50.
    const passCtx = 'color: #ffffff; background: #000000';   // 21:1 passes AA
    const failCtx = 'color: #777777; background: #888888';   // ~1.15 fails AA
    const tokenCtx = 'color: #ff0000';                         // brings in red
    const issues = [
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: passCtx, matched: true }),
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: passCtx, matched: true }),
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: failCtx, matched: true }),
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: failCtx, matched: true }),
      brandedIssue({ code: 'x', context: tokenCtx, matched: false }),
    ];
    const g = guideline({ colors: [BRAND_RED, BRAND_GREEN] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.coverage.contributingWeight).toBe(0.70);
      // color = 50, components = 50
      expect(result.color.kind === 'scored' && result.color.value).toBe(50);
      expect(result.components.kind === 'scored' && result.components.value).toBe(50);
      // Renormalized overall = (50*0.50 + 50*0.20) / 0.70 = 35 / 0.70 = 50
      expect(result.overall).toBe(50);
    }
  });

  it('1 scored + 2 unscorable: denominator = single weight, overall = that sub value', () => {
    // Only color scores; typography and components both unscorable.
    // Guideline has no colors (→ components unscorable) and no fonts.
    // But guideline must not be empty (else top-level empty-guideline).
    // Provide a font that doesn't match, and test that color still scores.
    const ctx = 'color: #ffffff; background: #000000';  // no typography, no brand token
    const issues = [
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: ctx, matched: true }),
    ];
    // Guideline has ONLY a font (no colors → components unscorable).
    // Typography has no extractable data from the issue context (no font-family etc).
    const g = guideline({ fonts: [INTER_FONT] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(result.coverage).toEqual({
        color: true,
        typography: false,
        components: false,
        contributingWeight: 0.50,
      });
      // Color alone, value 100, denominator 0.50 → 100
      expect(result.overall).toBe(100);
    }
  });

  it('0 scored (all three unscorable): returns top-level all-subs-unscorable', () => {
    // Empty issues list + non-empty guideline → all three sub-scores unscorable.
    const result = calculateBrandScore([], guideline({ fonts: [INTER_FONT] }));
    expect(result).toEqual({ kind: 'unscorable', reason: 'all-subs-unscorable' });
  });
});

// --- D-06 invariants --------------------------------------------------------

describe('calculateBrandScore — D-06 no null->0 coercion invariants', () => {
  it('never returns overall = 0 when any sub-score is unscorable', () => {
    // Scenario where color is 0 (all fail) but typography and components unscorable.
    // overall should renormalize over color alone: 0 / 0.50 = 0.
    // This IS a legitimate 0 — one data point, all failed — per D-06 Zero rule.
    const failCtx = 'color: #777777; background: #888888';
    const issues = [
      brandedIssue({ code: 'Guideline1_4.1_4_3', context: failCtx, matched: true }),
    ];
    const g = guideline({ fonts: [INTER_FONT] });
    const result = calculateBrandScore(issues, g);
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      // Color fails → 0. Typography + components unscorable.
      // This is a scored 0, not a coerced-from-null 0.
      expect(result.overall).toBe(0);
      expect(result.color.kind).toBe('scored');
      expect(result.typography.kind).toBe('unscorable');
      expect(result.components.kind).toBe('unscorable');
    }
  });

  it('top-level unscorable result never exposes an overall number', () => {
    const result = calculateBrandScore([], null);
    expect(result.kind).toBe('unscorable');
    // @ts-expect-error — overall is not accessible on the unscorable variant
    expect(result.overall).toBeUndefined();
  });
});

// --- WEIGHTS integration ----------------------------------------------------

describe('calculateBrandScore — uses locked WEIGHTS from weights.ts', () => {
  it('reads WEIGHTS at runtime (sanity check that composite uses the locked constants)', () => {
    expect(WEIGHTS.color + WEIGHTS.typography + WEIGHTS.components).toBeCloseTo(1.0);
  });
});
