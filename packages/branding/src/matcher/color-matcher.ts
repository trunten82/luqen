import type { BrandColor, MatchableIssue, BrandMatchResult } from '../types.js';
import { normalizeHex, extractColorsFromContext } from '../utils/color-utils.js';

const CONTRAST_CODES = new Set(['Guideline1_4.1_4_3', 'Guideline1_4.1_4_6', 'Guideline1_4.1_4_11']);

function isContrastIssue(code: string): boolean {
  return [...CONTRAST_CODES].some((c) => code.includes(c));
}

export class ColorMatcher {
  private readonly palette: ReadonlyMap<string, BrandColor>;

  constructor(colors: readonly BrandColor[]) {
    this.palette = new Map(colors.map((c) => [normalizeHex(c.hex), c] as const));
  }

  match(issue: MatchableIssue): BrandMatchResult {
    if (!isContrastIssue(issue.code)) return { matched: false };
    if (!issue.context) return { matched: false };
    const contextColors = extractColorsFromContext(issue.context);
    const brandMatches = contextColors
      .map((hex) => this.palette.get(hex))
      .filter((c): c is BrandColor => c !== undefined);
    if (brandMatches.length === 0) return { matched: false };
    const detail = brandMatches.map((c) => `${c.hex} (${c.name ?? 'unnamed'})`).join(' + ');
    return {
      matched: true,
      strategy: 'color',
      confidence: brandMatches.length >= 2 ? 1.0 : 0.7,
      detail,
      guidelineId: '',
      guidelineName: '',
    };
  }
}
