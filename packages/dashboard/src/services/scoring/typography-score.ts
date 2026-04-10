/**
 * Typography sub-score — equal-weight boolean mean over 3 heuristics:
 *   (a) brand font family present
 *   (b) body text is at least 16px
 *   (c) line-height is at least 1.5
 *
 * Formula (D-02): score = 100 * (fontOk + sizeOk + lineHeightOk) / 3
 * Data source (D-08): regex extraction from issue.context — no scanner change.
 * Unscorable (D-06): when issue.context yields no typography declarations.
 *
 * Regex safety: all patterns use BOUNDED quantifiers (e.g. `{1,64}`, `{1,10}`).
 * No `.*`, no unbounded alternation — avoids ReDoS on pathological input.
 */

import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import type { SubScore } from './types.js';

// Bounded regexes — max 10,000 chars per issue.context is enforced by caller.
// Font family: allow quoted or unquoted family name, up to 64 chars, stopping at comma or semicolon.
const FONT_FAMILY_RE = /font-family\s*:\s*["']?([a-zA-Z0-9 _-]{1,64})["']?\s*[,;}]/g;
// Font size: 1..4 digits + optional decimal + unit.
const FONT_SIZE_RE = /font-size\s*:\s*(\d{1,4}(?:\.\d{1,3})?)(px|pt|em|rem|%)/g;
// Line height: unitless 1..4 chars or with unit.
const LINE_HEIGHT_RE = /line-height\s*:\s*(\d{1,4}(?:\.\d{1,3})?)(px|pt|em|rem|%)?/g;

const MAX_CONTEXT_LEN = 10_000;

interface ExtractedTypography {
  readonly families: readonly string[];
  readonly pxSizes: readonly number[];
  readonly lineHeights: readonly number[];
}

function extractFromContext(context: string): ExtractedTypography {
  // Defensive: truncate to 10KB before regex to bound any pathological input.
  const safe = context.length > MAX_CONTEXT_LEN ? context.slice(0, MAX_CONTEXT_LEN) : context;

  const families: string[] = [];
  for (const m of safe.matchAll(FONT_FAMILY_RE)) {
    families.push(m[1].trim().toLowerCase());
  }

  const pxSizes: number[] = [];
  for (const m of safe.matchAll(FONT_SIZE_RE)) {
    const value = Number(m[1]);
    const unit = m[2];
    if (!Number.isFinite(value)) continue;
    if (unit === 'px') {
      pxSizes.push(value);
    } else if (unit === 'pt') {
      // CSS spec: 1pt = 1/72in, 1in = 96px -> 1pt = 4/3 px
      pxSizes.push(value * (4 / 3));
    }
    // em/rem/% skipped — no parent context to resolve against in Phase 15
  }

  const lineHeights: number[] = [];
  for (const m of safe.matchAll(LINE_HEIGHT_RE)) {
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    // Unitless or numeric+unit — we accept the numeric value directly.
    // Unitless is the CSS convention for the ratio heuristic; numeric+unit
    // is accepted as an approximation in Phase 15.
    lineHeights.push(value);
  }

  return { families, pxSizes, lineHeights };
}

function aggregate(issues: readonly BrandedIssue[]): ExtractedTypography {
  const families: string[] = [];
  const pxSizes: number[] = [];
  const lineHeights: number[] = [];
  for (const issue of issues) {
    const extracted = extractFromContext(issue.issue.context);
    families.push(...extracted.families);
    pxSizes.push(...extracted.pxSizes);
    lineHeights.push(...extracted.lineHeights);
  }
  return { families, pxSizes, lineHeights };
}

export function calculateTypographySubScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline,
): SubScore {
  const { families, pxSizes, lineHeights } = aggregate(issues);

  if (families.length === 0 && pxSizes.length === 0 && lineHeights.length === 0) {
    return { kind: 'unscorable', reason: 'no-typography-data' };
  }

  // (a) fontOk: at least one observed family matches a guideline font family
  //     (case-insensitive substring match so "Inter, sans-serif" matches "inter").
  const brandFamiliesLower = guideline.fonts.map((f) => f.family.trim().toLowerCase());
  const fontOk =
    families.length > 0 &&
    families.some((obs) => brandFamiliesLower.some((brand) => brand !== '' && obs.includes(brand)));

  // (b) sizeOk: at least one observed size meets the 16px body-text heuristic.
  const sizeOk = pxSizes.some((px) => px >= 16);

  // (c) lineHeightOk: at least one observed line-height meets the 1.5 heuristic.
  const lineHeightOk = lineHeights.some((lh) => lh >= 1.5);

  const passes = Number(fontOk) + Number(sizeOk) + Number(lineHeightOk);
  const value = Math.round((100 * passes) / 3);

  return {
    kind: 'scored',
    value,
    detail: {
      dimension: 'typography',
      fontOk,
      sizeOk,
      lineHeightOk,
    },
  };
}
