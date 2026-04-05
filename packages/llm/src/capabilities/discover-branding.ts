import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import { buildDiscoverBrandingPrompt } from '../prompts/discover-branding.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError, type CapabilityResult } from './types.js';

export interface DiscoverBrandingInput {
  readonly url: string;
  readonly orgId?: string;
}

export interface DiscoverBrandingColor {
  readonly name: string;
  readonly hex: string;
  readonly usage?: string;
}

export interface DiscoverBrandingFont {
  readonly family: string;
  readonly usage?: string;
}

export interface DiscoverBrandingResult {
  readonly colors: readonly DiscoverBrandingColor[];
  readonly fonts: readonly DiscoverBrandingFont[];
  readonly logoUrl: string;
  readonly brandName: string;
  readonly description: string;
}

export function parseDiscoverBrandingResponse(text: string): DiscoverBrandingResult {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const colors = Array.isArray(parsed['colors'])
      ? (parsed['colors'] as unknown[]).filter(
          (c): c is DiscoverBrandingColor =>
            typeof c === 'object' && c !== null && 'hex' in c,
        )
      : [];
    const fonts = Array.isArray(parsed['fonts'])
      ? (parsed['fonts'] as unknown[]).filter(
          (f): f is DiscoverBrandingFont =>
            typeof f === 'object' && f !== null && 'family' in f,
        )
      : [];
    return {
      colors,
      fonts,
      logoUrl: typeof parsed['logoUrl'] === 'string' ? parsed['logoUrl'] : '',
      brandName: typeof parsed['brandName'] === 'string' ? parsed['brandName'] : '',
      description: typeof parsed['description'] === 'string' ? parsed['description'] : '',
    };
  } catch {
    return { colors: [], fonts: [], logoUrl: '', brandName: '', description: '' };
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Luqen-BrandDiscovery/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function normalizeHex(hex: string): string {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}

/**
 * Classify a hex color into a broad hue category.
 * Used to sanity-check LLM-provided color names against reality.
 */
function hueCategory(hex: string): 'red' | 'orange' | 'yellow' | 'gold' | 'green' | 'blue' | 'purple' | 'pink' | 'brown' | 'cream' | 'dark' | 'light' | 'unknown' {
  const h = hex.replace('#', '').toLowerCase();
  if (h.length !== 6) return 'unknown';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (lightness < 40) return 'dark';
  if (lightness > 230 && max - min < 30) return 'light';

  // Cream/warm neutrals
  if (r > 200 && g > 180 && b > 150 && max - min < 60 && r >= g && g >= b) return 'cream';

  // Red-dominant
  if (r > g + 30 && r > b + 30) {
    if (g > 100 && b < 100) return 'orange';
    if (r > 200 && g > 150 && b < 100) return 'gold';
    if (g < 80 && b > 100) return 'pink';
    return 'red';
  }
  // Yellow (r and g high, b low)
  if (r > 180 && g > 180 && b < 120) return r > g + 20 ? 'gold' : 'yellow';
  // Green-dominant
  if (g > r + 20 && g > b) return 'green';
  // Blue-dominant
  if (b > r + 20 && b > g - 20) return 'blue';
  // Purple
  if (r > 80 && b > 80 && g < Math.min(r, b) - 20) return 'purple';
  // Brown (low-medium everything, warm)
  if (r > g && g > b && r < 180 && b < 120) return 'brown';
  return 'unknown';
}

/**
 * Sanitize LLM-provided color name. If the name mentions a color word that
 * contradicts the actual hex hue (e.g. naming a red #cd0136 as "Gold"),
 * strip the wrong word and use a generic fallback.
 */
function sanitizeColorName(name: string, hex: string): string {
  const actualHue = hueCategory(hex);
  if (actualHue === 'unknown') return name;

  const lower = name.toLowerCase();
  const colorWords = ['red', 'orange', 'yellow', 'gold', 'green', 'blue', 'purple', 'pink', 'brown', 'cream', 'black', 'white', 'grey', 'gray'];
  const mentioned = colorWords.find((w) => lower.includes(w));

  if (!mentioned) return name; // no color word → accept as-is

  // Map mentioned color word to its hue category
  const mentionedHue: Record<string, string> = {
    red: 'red', orange: 'orange', yellow: 'yellow', gold: 'gold',
    green: 'green', blue: 'blue', purple: 'purple', pink: 'pink',
    brown: 'brown', cream: 'cream', black: 'dark', white: 'light',
    grey: 'light', gray: 'light',
  };

  if (mentionedHue[mentioned] === actualHue) return name; // matches → OK

  // Mismatch — LLM used wrong color word. Replace it with the actual hue.
  const hueLabels: Record<string, string> = {
    red: 'Red', orange: 'Orange', yellow: 'Yellow', gold: 'Gold',
    green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink',
    brown: 'Brown', cream: 'Cream', dark: 'Dark', light: 'Light',
  };
  const replacement = hueLabels[actualHue] ?? 'Accent';
  // Replace the wrong word with the correct hue (case-insensitive)
  const re = new RegExp(`\\b${mentioned}\\b`, 'i');
  return name.replace(re, replacement);
}

function isNeutralColor(hex: string): boolean {
  const h = hex.replace('#', '').toLowerCase();
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (r === 0 && g === 0 && b === 0) return true;
  if (r === 255 && g === 255 && b === 255) return true;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff < 10;
}

interface BrandSignals {
  readonly htmlContent: string;
  readonly cssContent: string;
  readonly topColors: ReadonlyArray<{ hex: string; count: number }>;
  readonly fontFamilies: readonly string[];
  readonly logoCandidates: readonly string[];
  readonly brandHint: string;
  readonly metaBrandName: string;
  readonly metaDescription: string;
  readonly pageTitle: string;
}

async function extractBrandSignals(url: string): Promise<BrandSignals> {
  let rawHtml: string;
  try {
    rawHtml = await fetchWithTimeout(url);
  } catch {
    return { htmlContent: '', cssContent: '', topColors: [], fontFamilies: [], logoCandidates: [], brandHint: '', metaBrandName: '', metaDescription: '', pageTitle: '' };
  }

  let brandHint = '';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    brandHint = host.split('.')[0];
  } catch {
    brandHint = '';
  }

  const styleMatches = rawHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  const inlineCss = styleMatches
    .map((s) => s.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim())
    .join('\n');

  // Collect CSS URLs from:
  // 1. <link rel="stylesheet"> tags (standard)
  // 2. <noscript> blocks (often contain real links when CSS is lazy-loaded)
  // 3. ANY quoted string ending in .css (WP Rocket, Next.js, and other lazy loaders
  //    store CSS URLs in JS strings that aren't visible to tag-based parsers)
  const cssUrls = new Set<string>();

  const linkMatches = rawHtml.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) ?? [];
  for (const l of linkMatches) {
    const m = l.match(/href=["']([^"']+)["']/i);
    if (m) cssUrls.add(m[1]);
  }

  const noscriptBlocks = rawHtml.match(/<noscript[\s\S]*?<\/noscript>/gi) ?? [];
  for (const ns of noscriptBlocks) {
    const nsLinks = ns.match(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi) ?? [];
    for (const l of nsLinks) {
      const m = l.match(/href=["']([^"']+)["']/i);
      if (m) cssUrls.add(m[1]);
    }
  }

  // Fallback: any quoted URL that ends in .css (WP Rocket, Next.js chunks, etc.)
  const anyCssMatches = rawHtml.match(/['"]([^'"]+\.css[^'"]*?)['"]/gi) ?? [];
  for (const raw of anyCssMatches) {
    const cleaned = raw.replace(/^['"]|['"]$/g, '');
    if (cleaned.length > 0 && cleaned.length < 500) cssUrls.add(cleaned);
  }

  const hrefs = Array.from(cssUrls)
    .map((href) => {
      try {
        return new URL(href, url).toString();
      } catch {
        return null;
      }
    })
    .filter((x): x is string => x !== null);

  const origin = new URL(url).origin;
  const prioritised = hrefs
    .map((h) => {
      let score = 0;
      if (h.startsWith(origin)) score += 10;
      if (/\bmain\.css/i.test(h)) score += 20;
      if (/\btheme/i.test(h)) score += 8;
      if (/\bstyle\.css/i.test(h)) score += 8;
      if (/\b(brand|fonts|typography)/i.test(h)) score += 6;
      if (/google-fonts/i.test(h)) score += 5;
      if (/\b(admin|widget|modal|marker|calendar|print|rtl|editor|block-library)/i.test(h)) score -= 5;
      return { href: h, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.href);

  const externalCssChunks = await Promise.all(
    prioritised.map(async (href) => {
      try {
        return await fetchWithTimeout(href, 8000);
      } catch {
        return '';
      }
    }),
  );

  const allCss = [inlineCss, ...externalCssChunks].filter(Boolean).join('\n');
  const inlineStyleContent = (rawHtml.match(/style=["'][^"']*["']/gi) ?? []).join('\n');
  const combinedColorSource = allCss + '\n' + inlineStyleContent;

  // Weighted color counting.
  //
  // Problem: sites that share a CMS theme (e.g. Campari Group's WordPress theme
  // used across Aperol, Campari, Crodino) contain multiple sister-brand palettes
  // in the same stylesheet. Pure frequency picks the theme-wide dominant color,
  // not the current brand's color.
  //
  // Solution: give design-token declarations (`--name: #hex`) and inline <style>
  // blocks heavier weight than generic CSS rules. Design tokens ARE the brand
  // palette by definition; inline styles are page-authored and brand-specific.
  //
  // Weights:
  //   ×  1 — color appears in an external stylesheet rule
  //   ×  3 — color appears in the page's inline <style> block
  //   × 10 — color appears as a CSS custom property value (--token: #hex)
  //   × 25 — color appears in a brand-named context: a selector, class, id,
  //          variable name, or comment containing the brand hint
  //          (e.g. --aperol-orange, .campari-red, /* Aperol primary */).
  //          Strongest signal — name-based association beats frequency alone.
  const BRAND_NAME_WEIGHT = 25;
  const VAR_WEIGHT = 10;
  const INLINE_WEIGHT = 3;
  const BASE_WEIGHT = 1;

  const colorCounts = new Map<string, number>();
  const addColorHit = (hex: string, weight: number): void => {
    if (isNeutralColor(hex)) return;
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + weight);
  };

  const hexPattern = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
  const rgbPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  const varDeclPattern = /--[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\))/gi;

  const rgbMatchToHex = (rgb: string): string | null => {
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    if (r > 255 || g > 255 || b > 255) return null;
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  };

  // Pass 1 — base weight across all CSS sources.
  for (const raw of combinedColorSource.match(hexPattern) ?? []) {
    addColorHit(normalizeHex(raw), BASE_WEIGHT);
  }
  for (const rgbMatch of combinedColorSource.matchAll(rgbPattern)) {
    const hex = rgbMatchToHex(rgbMatch[0]);
    if (hex) addColorHit(hex, BASE_WEIGHT);
  }

  // Pass 2 — inline <style> bonus (page-authored is more signal than shared theme).
  for (const raw of inlineCss.match(hexPattern) ?? []) {
    addColorHit(normalizeHex(raw), INLINE_WEIGHT - BASE_WEIGHT);
  }
  for (const rgbMatch of inlineCss.matchAll(rgbPattern)) {
    const hex = rgbMatchToHex(rgbMatch[0]);
    if (hex) addColorHit(hex, INLINE_WEIGHT - BASE_WEIGHT);
  }

  // Pass 3 — CSS custom property declarations anywhere (--token: #hex).
  // These are the authoritative brand palette — give them heavy weight.
  for (const m of combinedColorSource.matchAll(varDeclPattern)) {
    const value = m[1];
    const hex = value.startsWith('#') ? normalizeHex(value) : rgbMatchToHex(value);
    if (hex) addColorHit(hex, VAR_WEIGHT - BASE_WEIGHT);
  }

  // Pass 4 — brand-named context bonus.
  //
  // If a hex/rgb value appears within a small window of the brand hint (from
  // the domain, e.g. "aperol" from aperol.com), it is almost certainly a brand
  // color. This catches:
  //   --aperol-orange: #ff5000;
  //   .aperol-cta { background: #ff5000 }
  //   /* Aperol primary */ color: #ff5000;
  //   #aperol-header { border-color: #ff5000 }
  //
  // We scan a 120-char window preceding each hex/rgb occurrence for a
  // case-insensitive brand-hint match. The check is cheap and precise.
  if (brandHint && brandHint.length >= 3) {
    const hintLower = brandHint.toLowerCase();
    const sourceLower = combinedColorSource.toLowerCase();
    const WINDOW = 120;
    const scanBrandHits = (pattern: RegExp, toHex: (raw: string) => string | null): void => {
      for (const m of combinedColorSource.matchAll(pattern)) {
        const hex = toHex(m[0]);
        if (!hex) continue;
        const idx = m.index ?? 0;
        const from = Math.max(0, idx - WINDOW);
        const window = sourceLower.slice(from, idx);
        if (window.includes(hintLower)) {
          addColorHit(hex, BRAND_NAME_WEIGHT - BASE_WEIGHT);
        }
      }
    };
    scanBrandHits(hexPattern, (raw) => normalizeHex(raw));
    scanBrandHits(rgbPattern, (raw) => rgbMatchToHex(raw));
  }

  const topColors = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([hex, count]) => ({ hex, count }));

  // Font families — parse all declarations, check every family in each stack (not just first)
  const GENERIC_FONTS = new Set([
    'inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'system-ui',
    '-apple-system', 'blinkmacsystemfont', 'apple color emoji', 'segoe ui emoji',
    'segoe ui symbol', 'noto color emoji', 'emoji', 'cursive', 'fantasy',
  ]);
  const OS_FONTS = new Set([
    'arial', 'helvetica', 'helvetica neue', 'segoe ui', 'roboto', 'tahoma',
    'verdana', 'georgia', 'times', 'times new roman', 'courier', 'courier new',
    'trebuchet ms', 'lucida grande', 'lucida sans', 'noto sans', 'noto serif',
    'liberation mono', 'consolas', 'menlo', 'monaco', 'sfmono-regular', 'sf mono',
    'ui-monospace', 'ui-sans-serif', 'ui-serif', 'swiper-icons',
    'material symbols outlined', 'material symbols rounded', 'material icons',
    'font awesome', 'fontawesome', 'icomoon',
  ]);
  const isValidFontName = (f: string): boolean => {
    if (f.length < 2 || f.length > 50) return false;
    if (f.startsWith('var(') || f.startsWith('-apple-') || f.startsWith('BlinkMac')) return false;
    if (f.startsWith('--')) return false;
    const lower = f.toLowerCase();
    if (GENERIC_FONTS.has(lower) || OS_FONTS.has(lower)) return false;
    return true;
  };

  const fontPattern = /font-family:\s*([^;}]+)/gi;
  const fontFamilies = new Set<string>();
  const fontMatches = allCss.matchAll(fontPattern);
  for (const fontMatch of fontMatches) {
    const raw = fontMatch[1].replace(/!important/i, '').trim();
    // Try to find fallback families inside var(--name, ...fallbacks)
    if (raw.includes('var(')) {
      const varContent = raw.match(/var\([^)]*\)/g) ?? [];
      for (const v of varContent) {
        const inner = v.slice(4, -1); // strip "var(" and ")"
        const parts = inner.split(',').slice(1); // skip the --var-name, take fallbacks
        for (const part of parts) {
          const f = part.trim().replace(/['"]/g, '');
          if (isValidFontName(f)) fontFamilies.add(f);
        }
      }
      continue;
    }
    for (const f of raw.split(',').map((x) => x.trim().replace(/['"]/g, ''))) {
      if (isValidFontName(f)) fontFamilies.add(f);
    }
  }

  // @font-face declarations
  const fontFacePattern = /@font-face\s*\{[^}]*font-family:\s*['"]?([^;'"]+)['"]?/gi;
  for (const m of allCss.matchAll(fontFacePattern)) {
    const f = m[1].trim().replace(/!important/i, '').trim();
    if (isValidFontName(f)) fontFamilies.add(f);
  }

  // Google Fonts from <link href="...fonts.googleapis.com/...">
  const googleFontsMatches = rawHtml.match(/fonts\.googleapis\.com\/css2?\?family=([^&"'\s]+)/gi) ?? [];
  for (const m of googleFontsMatches) {
    const familyMatch = m.match(/family=([^&:]+)/);
    if (familyMatch) {
      const family = decodeURIComponent(familyMatch[1]).replace(/\+/g, ' ').trim();
      if (family && isValidFontName(family)) fontFamilies.add(family);
    }
  }

  // Logo candidates
  const logoImgs = (rawHtml.match(/<img[^>]+>/gi) ?? [])
    .filter((tag) => /(?:src|alt|class|title)=["'][^"']*(?:logo|brand)[^"']*["']/i.test(tag))
    .map((tag) => {
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      return srcMatch ? srcMatch[1] : null;
    })
    .filter((x): x is string => x !== null)
    .map((src) => {
      try {
        return new URL(src, url).toString();
      } catch {
        return null;
      }
    })
    .filter((x): x is string => x !== null);

  const logoCandidates = Array.from(new Set(logoImgs)).slice(0, 5);

  const headMatch = rawHtml.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : '';
  const metaTags = (head.match(/<meta[^>]+>/gi) ?? []).slice(0, 20).join('\n');
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : '';

  // Extract brand name from meta tags (deterministic, authoritative)
  const ogSiteNameMatch = head.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  const ogTitleMatch = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const metaBrandName = (ogSiteNameMatch?.[1] ?? '').trim() ||
    (ogTitleMatch?.[1] ?? '').replace(/\s*[|–—-].*$/, '').trim() ||
    pageTitle.replace(/\s*[|–—-].*$/, '').trim();

  // Extract description from meta tags
  const ogDescMatch = head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const descMatch = head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const metaDescription = (ogDescMatch?.[1] ?? descMatch?.[1] ?? '').trim();

  const htmlContent = [
    pageTitle ? `<title>${pageTitle}</title>` : '',
    metaTags,
    '<!-- logo candidates -->',
    logoCandidates.join('\n'),
  ].filter(Boolean).join('\n');

  const cssContent = `/* Top ${topColors.length} hex colors by frequency (excluding neutrals): */\n` +
    topColors.map((c) => `/* ${c.hex} (${c.count} occurrences) */`).join('\n') +
    (fontFamilies.size > 0
      ? `\n\n/* Font families detected: */\n` +
        Array.from(fontFamilies).slice(0, 10).map((f) => `/* ${f} */`).join('\n')
      : '');

  return {
    htmlContent,
    cssContent,
    topColors,
    fontFamilies: Array.from(fontFamilies),
    logoCandidates,
    brandHint,
    metaBrandName,
    metaDescription,
    pageTitle,
  };
}

function applyPromptTemplate(
  template: string,
  input: DiscoverBrandingInput & { htmlContent: string; cssContent: string },
): string {
  return template
    .replace(/\{\{url\}\}/g, input.url)
    .replace(/\{\{htmlContent\}\}/g, input.htmlContent)
    .replace(/\{\{cssContent\}\}/g, input.cssContent);
}

function applyPromptBuiltin(signals: BrandSignals, url: string): string {
  return buildDiscoverBrandingPrompt({
    url,
    htmlContent: signals.htmlContent,
    cssContent: signals.cssContent,
    topColors: signals.topColors,
    fontFamilies: signals.fontFamilies,
    logoCandidates: signals.logoCandidates,
    brandHint: signals.brandHint,
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

/**
 * Build a deterministic-only result from the extracted signals.
 * Used as the ground truth baseline and as a fallback when the LLM fails.
 */
function buildDeterministicResult(signals: BrandSignals): DiscoverBrandingResult {
  const colors: DiscoverBrandingColor[] = signals.topColors.slice(0, 6).map((c, i) => ({
    name: i === 0 ? `${signals.brandHint || 'Brand'} Primary` : `${signals.brandHint || 'Brand'} Color ${i + 1}`,
    hex: c.hex,
    usage: i === 0 ? 'primary' : i <= 2 ? 'secondary' : 'accent',
  }));

  const fonts: DiscoverBrandingFont[] = signals.fontFamilies.slice(0, 5).map((family, i) => ({
    family,
    usage: i === 0 ? 'heading' : 'body',
  }));

  // Pick the best logo from candidates (prefer non-footer/age-gate, prefer larger formats)
  const bestLogo = [...signals.logoCandidates]
    .sort((a, b) => {
      const aScore = (a.includes('main') ? 10 : 0) - (a.includes('footer') || a.includes('age-gate') || a.includes('small') ? 5 : 0) + (a.endsWith('.svg') ? 3 : a.endsWith('.webp') ? 2 : 0);
      const bScore = (b.includes('main') ? 10 : 0) - (b.includes('footer') || b.includes('age-gate') || b.includes('small') ? 5 : 0) + (b.endsWith('.svg') ? 3 : b.endsWith('.webp') ? 2 : 0);
      return bScore - aScore;
    })[0] ?? '';

  return {
    colors,
    fonts,
    logoUrl: bestLogo,
    brandName: signals.metaBrandName || signals.brandHint,
    description: signals.metaDescription,
  };
}

/**
 * Merge LLM output with deterministic signals.
 * Deterministic data (hex values, font names, logo URLs) is authoritative.
 * LLM provides: human-friendly names, usage classification, description.
 */
function mergeResults(
  signals: BrandSignals,
  llm: DiscoverBrandingResult,
  deterministic: DiscoverBrandingResult,
): DiscoverBrandingResult {
  // Build a map of deterministic hex -> count for validation
  const validHexes = new Set(signals.topColors.map((c) => c.hex.toLowerCase()));

  // Accept LLM colors ONLY if they're in our extracted list (authoritative)
  // Also sanity-check the name matches the actual hex hue (reject obviously wrong names)
  const validLlmColors = llm.colors
    .filter((c) => typeof c.hex === 'string' && validHexes.has(c.hex.toLowerCase()))
    .map((c) => ({
      ...c,
      hex: c.hex.toLowerCase(),
      name: sanitizeColorName(c.name, c.hex),
    }));

  // Merge: use LLM colors if available, else deterministic
  const colors: readonly DiscoverBrandingColor[] = validLlmColors.length > 0
    ? validLlmColors.slice(0, 8)
    : deterministic.colors;

  // Similarly for fonts — accept LLM fonts only if they're in our extracted list
  const validFontSet = new Set(signals.fontFamilies.map((f) => f.toLowerCase()));
  const validLlmFonts = llm.fonts.filter((f) => validFontSet.has(f.family.toLowerCase()));
  const fonts: readonly DiscoverBrandingFont[] = validLlmFonts.length > 0
    ? validLlmFonts.slice(0, 5)
    : deterministic.fonts;

  // Logo: use LLM pick only if it's in our candidates list, else deterministic
  const validLogos = new Set(signals.logoCandidates);
  const logoUrl = llm.logoUrl && validLogos.has(llm.logoUrl)
    ? llm.logoUrl
    : deterministic.logoUrl;

  // Brand name: prefer LLM if non-empty, else meta, else brandHint
  const brandName = (llm.brandName && llm.brandName.length > 0 && llm.brandName.length < 100)
    ? llm.brandName
    : deterministic.brandName;

  // Description: prefer LLM if reasonable length, else meta description
  const description = (llm.description && llm.description.length > 10 && llm.description.length < 500)
    ? llm.description
    : deterministic.description;

  return { colors, fonts, logoUrl, brandName, description };
}

export async function executeDiscoverBranding(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: DiscoverBrandingInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<DiscoverBrandingResult>> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 5000;

  const models = await db.getModelsForCapability('discover-branding', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('discover-branding');
  }

  // Step 1: Deterministic extraction — ALWAYS runs
  const signals = await extractBrandSignals(input.url);
  const deterministic = buildDeterministicResult(signals);

  // If the site gave us nothing, return empty early
  if (signals.topColors.length === 0 && signals.fontFamilies.length === 0 && signals.logoCandidates.length === 0) {
    return {
      data: deterministic,
      model: '(no LLM — empty site)',
      provider: 'deterministic',
      attempts: 0,
    };
  }

  // Step 2: Call LLM to curate and name
  const { htmlContent, cssContent } = signals;
  const promptOverride = await db.getPromptOverride('discover-branding', input.orgId);
  let totalAttempts = 0;
  let lastError: Error | undefined;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      totalAttempts += 1;

      if (attempt > 0 && retryDelayMs > 0) {
        const delay = retryDelayMs * Math.pow(3, attempt - 1);
        await sleep(delay);
      }

      try {
        const adapter = adapterFactory(provider.type);
        await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });

        const prompt = promptOverride != null
          ? applyPromptTemplate(promptOverride.template, { ...input, htmlContent, cssContent })
          : applyPromptBuiltin(signals, input.url);

        const result = await adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0,
          timeout: provider.timeout,
        });

        const llmData = parseDiscoverBrandingResponse(result.text);
        const merged = mergeResults(signals, llmData, deterministic);

        return {
          data: merged,
          model: model.displayName,
          provider: provider.name,
          attempts: totalAttempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  // Step 3: LLM failed entirely — return deterministic-only result
  // (degrade gracefully rather than throwing, since we DO have real data)
  if (deterministic.colors.length > 0 || deterministic.fonts.length > 0) {
    return {
      data: deterministic,
      model: '(LLM failed — deterministic fallback)',
      provider: lastError?.message ?? 'unknown',
      attempts: totalAttempts,
    };
  }

  throw new CapabilityExhaustedError('discover-branding', totalAttempts, lastError);
}
