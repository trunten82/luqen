/**
 * Brand score calculator — public entry point.
 *
 * Takes (issues, guideline | null) and returns a ScoreResult tagged-union
 * value. Composes the three dimension sub-scores and renormalizes the
 * composite over only the sub-scores that returned `{kind:'scored'}`.
 *
 * Composite formula (D-04, Pitfall #1):
 *   Let S ⊆ {color, typography, components} be the scored sub-score set.
 *   If S is empty → unscorable with reason 'all-subs-unscorable'.
 *   Else:
 *     contributingWeight = Σ_{k ∈ S} WEIGHTS[k]
 *     overall = round( (Σ_{k ∈ S} WEIGHTS[k] × subs[k].value) / contributingWeight )
 *
 * This means if typography is unscorable, the composite is
 *   (0.50 × color + 0.20 × components) / 0.70
 * NOT
 *   (0.50 × color + 0.20 × components) / 1.0
 *
 * Unscorable entry points (D-15, D-19):
 *   - `no-guideline`        → guideline is null
 *   - `empty-guideline`     → guideline has no colors, fonts, or selectors
 *   - `all-subs-unscorable` → all 3 sub-scores returned unscorable
 *
 * The remaining 3 reasons (`no-branded-issues`, `no-typography-data`,
 * `no-component-tokens`) are returned by sub-score calculators and surface
 * inside the `color`/`typography`/`components` fields of a scored ScoreResult
 * when the other subs supply enough data to still produce a composite.
 */

import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import type {
  ScoreResult,
  SubScore,
  CoverageProfile,
  UnscorableReason,
} from './types.js';
import { WEIGHTS, type WeightKey } from './weights.js';
import { calculateColorSubScore } from './color-score.js';
import { calculateTypographySubScore } from './typography-score.js';
import { calculateTokenSubScore } from './token-score.js';

function isEmptyGuideline(guideline: BrandGuideline): boolean {
  return (
    guideline.colors.length === 0 &&
    guideline.fonts.length === 0 &&
    guideline.selectors.length === 0
  );
}

function buildCoverage(
  color: SubScore,
  typography: SubScore,
  components: SubScore,
): CoverageProfile {
  const scoredKeys: WeightKey[] = [];
  if (color.kind === 'scored') scoredKeys.push('color');
  if (typography.kind === 'scored') scoredKeys.push('typography');
  if (components.kind === 'scored') scoredKeys.push('components');
  // Sum weights then round to 2 decimals to eliminate FP drift in
  // downstream equality checks.
  const rawSum = scoredKeys.reduce((acc, k) => acc + WEIGHTS[k], 0);
  const contributingWeight = Math.round(rawSum * 100) / 100;
  return {
    color: color.kind === 'scored',
    typography: typography.kind === 'scored',
    components: components.kind === 'scored',
    contributingWeight,
  };
}

function composite(
  color: SubScore,
  typography: SubScore,
  components: SubScore,
  contributingWeight: number,
): number {
  let numerator = 0;
  if (color.kind === 'scored') numerator += WEIGHTS.color * color.value;
  if (typography.kind === 'scored') numerator += WEIGHTS.typography * typography.value;
  if (components.kind === 'scored') numerator += WEIGHTS.components * components.value;
  // contributingWeight > 0 is guaranteed by caller (all-subs-unscorable guard).
  return Math.round(numerator / contributingWeight);
}

export function calculateBrandScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline | null,
): ScoreResult {
  if (guideline === null) {
    const reason: UnscorableReason = 'no-guideline';
    return { kind: 'unscorable', reason };
  }

  if (isEmptyGuideline(guideline)) {
    const reason: UnscorableReason = 'empty-guideline';
    return { kind: 'unscorable', reason };
  }

  const color = calculateColorSubScore(issues, guideline);
  const typography = calculateTypographySubScore(issues, guideline);
  const components = calculateTokenSubScore(issues, guideline);

  const allUnscorable =
    color.kind === 'unscorable' &&
    typography.kind === 'unscorable' &&
    components.kind === 'unscorable';

  if (allUnscorable) {
    const reason: UnscorableReason = 'all-subs-unscorable';
    return { kind: 'unscorable', reason };
  }

  const coverage = buildCoverage(color, typography, components);
  const overall = composite(color, typography, components, coverage.contributingWeight);

  return {
    kind: 'scored',
    overall,
    color,
    typography,
    components,
    coverage,
  };
}
