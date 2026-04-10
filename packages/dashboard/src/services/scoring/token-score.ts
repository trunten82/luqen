/**
 * Component sub-score — brand COLOR coverage set-diff.
 *
 * Formula (D-03): score = 100 * |brand_tokens ∩ used_tokens| / |brand_tokens|
 * Unscorable (D-06, D-03): when `guideline.colors.length === 0`, return
 * `{kind:'unscorable', reason:'no-component-tokens'}` — this is NOT a zero score.
 *
 * IMPORTANT (D-09, D-10):
 * v2.11.0 component sub-score is brand color coverage only — font families
 * and component selectors are NOT included. See Phase 15 CONTEXT D-09/D-10.
 * A future milestone (v2.12.0+) may widen the set-diff to cover font families
 * and selectors; when that lands, update the source comment AND bump the
 * brand_scores schema version so historical trend data stays comparable.
 *
 * Data sources:
 * - brand tokens = `guideline.colors[].hexValue` normalized via `normalizeHex`
 * - used tokens  = `extractColorsFromContext(issue.issue.context)` unioned
 *                  across ALL issues (branded or unbranded — we measure
 *                  whether brand colors appear anywhere on the page).
 *
 * Safety: malformed guideline hex values are filtered out by normalizeHex
 * (returns '' for non-hex input) — calculator never throws on bad guideline data.
 */

import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import { normalizeHex, extractColorsFromContext } from '@luqen/branding';
import type { SubScore } from './types.js';

export function calculateTokenSubScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline,
): SubScore {
  // Brand tokens: normalize + filter malformed.
  const brandTokens = new Set<string>();
  for (const color of guideline.colors) {
    const normalized = normalizeHex(color.hexValue);
    if (normalized !== '') {
      brandTokens.add(normalized);
    }
  }

  if (brandTokens.size === 0) {
    return { kind: 'unscorable', reason: 'no-component-tokens' };
  }

  // Used tokens: union across every issue's context.
  const usedTokens = new Set<string>();
  for (const branded of issues) {
    const colors = extractColorsFromContext(branded.issue.context);
    for (const c of colors) {
      usedTokens.add(c);
    }
  }

  let matched = 0;
  for (const brand of brandTokens) {
    if (usedTokens.has(brand)) {
      matched += 1;
    }
  }

  const total = brandTokens.size;
  const value = Math.round((100 * matched) / total);

  return {
    kind: 'scored',
    value,
    detail: { dimension: 'components', matched, total },
  };
}
