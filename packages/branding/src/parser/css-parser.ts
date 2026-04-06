/**
 * CSS parser for brand guideline files.
 * Extracts colors (custom properties + hex values) and fonts (font-family declarations).
 */

import type { ParsedColor, ParsedFont } from './csv-parser.js';

export type { ParsedColor, ParsedFont };

export interface ParsedCSSResult {
  readonly colors: readonly ParsedColor[];
  readonly fonts: readonly ParsedFont[];
}

const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/**
 * Normalize a 3-digit or 6-digit hex color string to 6-digit uppercase.
 * Returns null if the input is not a valid 3- or 6-digit hex.
 */
function normalizeHex(raw: string): string | null {
  const cleaned = raw.startsWith('#') ? raw.slice(1) : raw;
  if (cleaned.length === 3) {
    const expanded = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
    return '#' + expanded.toUpperCase();
  }
  if (cleaned.length === 6) {
    return '#' + cleaned.toUpperCase();
  }
  // 8-digit (with alpha) — unsupported for display, skip
  return null;
}

/**
 * Strip CSS block comments including multiline.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export function parseCSS(cssContent: string): ParsedCSSResult {
  if (!cssContent || !cssContent.trim()) {
    return { colors: [], fonts: [] };
  }

  const css = stripComments(cssContent);

  const colors: ParsedColor[] = [];
  const seenHex = new Set<string>();

  const fonts: ParsedFont[] = [];
  const seenFamily = new Set<string>();

  // ── Extract colors from CSS custom properties (--name: #hex) ────────────
  const customPropRe = /--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let match: RegExpExecArray | null;
  while ((match = customPropRe.exec(css)) !== null) {
    const name = match[1];
    const normalized = normalizeHex(match[2]);
    if (normalized === null) continue;
    const key = normalized.toUpperCase();
    if (!seenHex.has(key)) {
      seenHex.add(key);
      colors.push({ name, hex: normalized });
    }
  }

  // ── Extract colors from regular property values (#hex) ──────────────────
  // Match property names that start at the beginning of a line or after { ; or whitespace
  const regularPropRe = /(?:^|[{;}\s])([a-zA-Z][a-zA-Z-]*)\s*:\s*[^;{]*?(#[0-9a-fA-F]{3,8})/gm;
  const regularColorCounters: Map<string, number> = new Map();
  while ((match = regularPropRe.exec(css)) !== null) {
    const propName = match[1];
    // Skip font-related properties to avoid treating font shorthands as colors
    if (propName === 'font' || propName === 'font-family') continue;
    const normalized = normalizeHex(match[2]);
    if (normalized === null) continue;
    const key = normalized.toUpperCase();
    if (!seenHex.has(key)) {
      seenHex.add(key);
      const count = (regularColorCounters.get(propName) ?? 0) + 1;
      regularColorCounters.set(propName, count);
      const name = `${propName}-${count}`;
      colors.push({ name, hex: normalized });
    }
  }

  // ── Extract font-family declarations ─────────────────────────────────────
  const fontFamilyRe = /font-family\s*:\s*([^;{]+)/g;
  while ((match = fontFamilyRe.exec(css)) !== null) {
    const familyList = match[1];
    for (const rawFamily of familyList.split(',')) {
      const family = rawFamily.trim().replace(/^['"]|['"]$/g, '').trim();
      if (!family) continue;
      if (GENERIC_FONT_FAMILIES.has(family.toLowerCase())) continue;
      const key = family.toLowerCase();
      if (!seenFamily.has(key)) {
        seenFamily.add(key);
        fonts.push({ family });
      }
    }
  }

  // ── Extract font shorthand: font: ... 'Family', fallback ─────────────────
  const fontShorthandRe = /(?<![a-z-])font\s*:\s*([^;{]+)/g;
  while ((match = fontShorthandRe.exec(css)) !== null) {
    const value = match[1];
    // Extract quoted families from shorthand
    const quotedRe = /['"]([^'"]+)['"]/g;
    let qm: RegExpExecArray | null;
    while ((qm = quotedRe.exec(value)) !== null) {
      const family = qm[1].trim();
      if (!family) continue;
      if (GENERIC_FONT_FAMILIES.has(family.toLowerCase())) continue;
      const key = family.toLowerCase();
      if (!seenFamily.has(key)) {
        seenFamily.add(key);
        fonts.push({ family });
      }
    }
  }

  return { colors, fonts };
}
