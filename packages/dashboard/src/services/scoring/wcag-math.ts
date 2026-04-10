/**
 * WCAG 2.1 contrast math — SINGLE SOURCE OF TRUTH for all threshold comparisons.
 *
 * This file is the ONLY place in the dashboard source tree permitted to
 * contain literal WCAG threshold numbers (4.5, 3, 7). Every caller must
 * route through `wcagContrastPasses(ratio, level, isLargeText)` — literal
 * threshold comparisons elsewhere are forbidden by CONTEXT decision D-07.
 *
 * References:
 * - WCAG 2.1 SC 1.4.3 Contrast (Minimum)   — AA: 4.5:1 normal, 3:1 large
 * - WCAG 2.1 SC 1.4.6 Contrast (Enhanced)  — AAA: 7:1 normal, 4.5:1 large
 * - WCAG 2.1 SC 1.4.11 Non-text Contrast   — 3:1 (not a level, call sites
 *   pass `level: 'AA', isLargeText: true` to reuse the 3:1 predicate)
 * - WCAG 2.1 Relative Luminance formula    — W3C "Understanding §Relative Luminance"
 *
 * Boundary semantics: comparisons use `>=`, so a ratio of EXACTLY 4.5 passes AA.
 * Boundary fixtures in wcag-math.test.ts prove off-by-none at 4.49/4.50/4.51
 * and equivalent AAA / large-text boundaries.
 */

import { normalizeHex } from '@luqen/branding';

// ---------------------------------------------------------------------------
// Large text classification (WCAG 2.1 SC 1.4.3 definition)
// ---------------------------------------------------------------------------

/** Normal-weight text is "large" at ≥18pt. */
export const LARGE_TEXT_PT_THRESHOLD = 18;

/** Bold text is "large" at ≥14pt. */
export const LARGE_TEXT_BOLD_PT_THRESHOLD = 14;

export function classifyLargeText(fontSizePt: number, isBold: boolean): boolean {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) return false;
  return isBold
    ? fontSizePt >= LARGE_TEXT_BOLD_PT_THRESHOLD
    : fontSizePt >= LARGE_TEXT_PT_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Relative luminance (W3C formula)
// ---------------------------------------------------------------------------

function channelLuminance(channel8bit: number): number {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.1. Accepts 0..255 integer channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

// ---------------------------------------------------------------------------
// Contrast ratio from hex pair
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (normalized === '') return null;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

/**
 * WCAG 2.1 contrast ratio between two hex colors. Accepts any casing and
 * 3-digit short form via `normalizeHex`. Returns NaN when either hex is
 * malformed — callers MUST guard with `Number.isFinite` and route malformed
 * input to `unscorable`, NEVER to a default score.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (a === null || b === null) return NaN;
  const lumA = relativeLuminance(a.r, a.g, a.b);
  const lumB = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Threshold predicate — THE ONLY ALLOWED WCAG THRESHOLD COMPARISON
// ---------------------------------------------------------------------------

/**
 * Returns true when `ratio` meets the WCAG 2.1 threshold for the given
 * conformance level and text-size classification.
 *
 * - level='AA',  isLargeText=false → ≥4.5 (SC 1.4.3 normal text)
 * - level='AA',  isLargeText=true  → ≥3   (SC 1.4.3 large text, and SC 1.4.11 non-text)
 * - level='AAA', isLargeText=false → ≥7   (SC 1.4.6 normal text)
 * - level='AAA', isLargeText=true  → ≥4.5 (SC 1.4.6 large text)
 *
 * Non-finite ratios (NaN) return false. Callers should pre-guard with
 * `Number.isFinite` before invoking this predicate.
 */
export function wcagContrastPasses(
  ratio: number,
  level: 'AA' | 'AAA',
  isLargeText: boolean,
): boolean {
  if (Number.isNaN(ratio)) return false;
  if (level === 'AA') {
    return isLargeText ? ratio >= 3 : ratio >= 4.5;
  }
  // level === 'AAA'
  return isLargeText ? ratio >= 4.5 : ratio >= 7;
}
