import type { BrandFont, MatchableIssue, BrandMatchResult } from '../types.js';

const FONT_FAMILY_RE = /font-family\s*:\s*([^;}"]+)/i;

function extractFirstFont(context: string): string | null {
  const match = FONT_FAMILY_RE.exec(context);
  if (!match) return null;

  // Take the first font before the comma
  const firstFont = match[1].split(',')[0].trim();
  // Strip surrounding quotes (single or double)
  return firstFont.replace(/^['"]|['"]$/g, '').trim();
}

export class FontMatcher {
  private readonly fonts: readonly BrandFont[];

  constructor(fonts: readonly BrandFont[]) {
    this.fonts = fonts;
  }

  match(issue: MatchableIssue): BrandMatchResult {
    if (!issue.context) return { matched: false };
    const fontName = extractFirstFont(issue.context);
    if (!fontName) {
      return { matched: false };
    }

    const normalised = fontName.toLowerCase();
    const brandFont = this.fonts.find(
      (f) => f.family.toLowerCase() === normalised,
    );

    if (!brandFont) {
      return { matched: false };
    }

    return {
      matched: true,
      strategy: 'font',
      guidelineName: '',  // filled by BrandingMatcher
      guidelineId: '',    // filled by BrandingMatcher
      matchDetail: `${brandFont.family} (Brand Font)`,
    };
  }
}
