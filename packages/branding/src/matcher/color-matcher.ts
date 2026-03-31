import type { BrandColor, MatchableIssue, BrandMatchResult } from '../types.js';
import { normalizeHex, extractColorsFromContext } from '../utils/color-utils.js';

/** WCAG codes related to colour contrast. */
const CONTRAST_CODES = new Set([
  'Guideline1_4.1_4_3',  // Minimum contrast
  'Guideline1_4.1_4_6',  // Enhanced contrast
  'Guideline1_4.1_4_11', // Non-text contrast
]);

function isContrastIssue(code: string): boolean {
  return [...CONTRAST_CODES].some((c) => code.includes(c));
}

export class ColorMatcher {
  private readonly palette: ReadonlyMap<string, BrandColor>;

  constructor(colors: readonly BrandColor[]) {
    this.palette = new Map(
      colors.map((c) => [normalizeHex(c.hexValue), c] as const),
    );
  }

  match(issue: MatchableIssue): BrandMatchResult {
    if (!isContrastIssue(issue.code)) {
      return { matched: false };
    }

    const contextColors = extractColorsFromContext(issue.context);
    const brandMatches = contextColors
      .map((hex) => this.palette.get(hex))
      .filter((c): c is BrandColor => c !== undefined);

    if (brandMatches.length === 0) {
      return { matched: false };
    }

    const detail = brandMatches
      .map((c) => `${c.hexValue} (${c.name})`)
      .join(' + ');

    return {
      matched: true,
      strategy: 'color-pair',
      guidelineName: '',  // filled by BrandingMatcher
      guidelineId: '',    // filled by BrandingMatcher
      matchDetail: detail,
    };
  }
}
