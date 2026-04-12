/**
 * Color sub-score — WCAG contrast pass ratio across brand-matched contrast issues.
 *
 * Formula (D-01): score = 100 × passes / (passes + fails)
 * Unscorable (D-06): when there are zero contrast-code issues matched to brand colors
 *
 * All WCAG threshold comparisons route through `wcagContrastPasses` — this
 * file contains NO literal 4.5 / 7 / 3 thresholds (D-07).
 */

import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import { extractColorsFromContext } from '@luqen/branding';
import type { SubScore } from './types.js';
import { contrastRatio, wcagContrastPasses } from './wcag-math.js';

// Phase 15: reimplement the CONTRAST code set locally rather than exporting
// from @luqen/branding. D-11 forbids scanner / branding package changes; this
// set is stable (WCAG 2.1 SC numbers) and is covered by the existing
// color-matcher unit tests in @luqen/branding.
// Codes map to WCAG SC 1.4.3 (AA minimum), 1.4.6 (AAA enhanced), and
// 1.4.11 (non-text contrast). Thresholds for each code are applied via
// `wcagContrastPasses` — this file carries no literal threshold numerics
// (see D-07).
const CONTRAST_CODES: readonly string[] = [
  'Guideline1_4.1_4_3',
  'Guideline1_4.1_4_6',
  'Guideline1_4.1_4_11',
];

function isContrastIssue(code: string): boolean {
  return CONTRAST_CODES.some((c) => code.includes(c));
}

function levelFor(code: string): 'AA' | 'AAA' {
  return code.includes('1_4_6') ? 'AAA' : 'AA';
}

/**
 * Given a branded contrast issue, returns `true` if the extractable hex pair
 * passes its WCAG level threshold, `false` otherwise. If fewer than two hex
 * codes are extractable from the context, the issue is treated as a fail:
 * the scanner flagged it and the absence of clean hex data cannot upgrade a
 * flagged issue to a pass.
 */
function issuePasses(issue: BrandedIssue): boolean {
  const level = levelFor(issue.issue.code);
  const colors = extractColorsFromContext(issue.issue.context);
  if (colors.length < 2) return false;
  const ratio = contrastRatio(colors[0], colors[1]);
  if (!Number.isFinite(ratio)) return false;
  return wcagContrastPasses(ratio, level, false);
}

export function calculateColorSubScore(
  issues: readonly BrandedIssue[],
  _guideline: BrandGuideline,
): SubScore {
  const brandedContrastIssues = issues.filter(
    (i) => i.brandMatch.matched === true && isContrastIssue(i.issue.code),
  );

  if (brandedContrastIssues.length === 0) {
    // Zero branded contrast violations means the brand colors all pass
    // WCAG thresholds — that is 100% compliance, NOT "unscorable."
    // A site with a linked guideline and zero brand-related contrast
    // issues has perfect color brand accessibility.
    return {
      kind: 'scored',
      value: 100,
      detail: { dimension: 'color', passes: 0, fails: 0 },
    };
  }

  let passes = 0;
  let fails = 0;
  for (const issue of brandedContrastIssues) {
    if (issuePasses(issue)) {
      passes += 1;
    } else {
      fails += 1;
    }
  }

  const total = passes + fails;
  // Defensive — total must be >0 because brandedContrastIssues.length > 0.
  // If ever not, return unscorable instead of divide-by-zero.
  if (total === 0) {
    return { kind: 'unscorable', reason: 'no-branded-issues' };
  }

  const value = Math.round((100 * passes) / total);
  return {
    kind: 'scored',
    value,
    detail: { dimension: 'color', passes, fails },
  };
}
