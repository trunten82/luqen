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

  const linkMatches = rawHtml.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) ?? [];
  const hrefs = linkMatches
    .map((l) => {
      const m = l.match(/href=["']([^"']+)["']/i);
      return m ? m[1] : null;
    })
    .filter((x): x is string => x !== null)
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
    .map((h) => ({
      href: h,
      score: (h.startsWith(origin) ? 10 : 0) + (/(main|style|theme|app|brand)/i.test(h) ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
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

  // Count hex colors (6-digit and 3-digit)
  const hexPattern = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
  const colorCounts = new Map<string, number>();
  const hexMatches = combinedColorSource.match(hexPattern) ?? [];
  for (const raw of hexMatches) {
    const hex = normalizeHex(raw);
    if (isNeutralColor(hex)) continue;
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }

  // Convert rgb()/rgba() to hex
  const rgbPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  const rgbMatches = combinedColorSource.matchAll(rgbPattern);
  for (const rgbMatch of rgbMatches) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (r > 255 || g > 255 || b > 255) continue;
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    if (isNeutralColor(hex)) continue;
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
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
      if (family) fontFamilies.add(family);
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
  const validHexes = new Set(signals.topColors.map((c) => c.hex));

  // Accept LLM colors ONLY if they're in our extracted list (authoritative)
  const validLlmColors = llm.colors.filter((c) => validHexes.has(c.hex.toLowerCase()));

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
