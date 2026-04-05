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
    };
  } catch {
    return { colors: [], fonts: [], logoUrl: '', brandName: '' };
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

async function extractBrandSignals(url: string): Promise<{ htmlContent: string; cssContent: string }> {
  let rawHtml: string;
  try {
    rawHtml = await fetchWithTimeout(url);
  } catch {
    return { htmlContent: '', cssContent: '' };
  }

  // Extract <style> tag content
  const styleMatches = rawHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  const inlineCss = styleMatches
    .map((s) => s.replace(/<style[^>]*>/i, '').replace(/<\/style>/i, '').trim())
    .join('\n');

  // Fetch up to 3 external stylesheets (prioritise same-origin and main CSS files)
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
    .filter((x): x is string => x !== null)
    .slice(0, 3);

  const externalCssChunks = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const css = await fetchWithTimeout(href, 8000);
        return `/* from ${href} */\n${css}`;
      } catch {
        return '';
      }
    }),
  );

  const cssContent = [inlineCss, ...externalCssChunks].filter(Boolean).join('\n\n').trim();

  // Extract inline style attributes from elements (often contain brand colors)
  const inlineStyles = (rawHtml.match(/style=["'][^"']{5,200}["']/gi) ?? []).slice(0, 50).join('\n');

  // Extract meta tags and title for brand name
  const headMatch = rawHtml.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : '';

  // Extract logo-related elements
  const logoElements = (rawHtml.match(/<img[^>]*(?:logo|brand)[^>]*>/gi) ?? []).slice(0, 5).join('\n');
  const svgLogos = (rawHtml.match(/<svg[^>]*(?:logo|brand)[^>]*>[\s\S]{0,500}?<\/svg>/gi) ?? []).slice(0, 3).join('\n');

  const htmlContent = [head, logoElements, svgLogos, '<!-- inline styles -->', inlineStyles].filter(Boolean).join('\n');

  return { htmlContent, cssContent };
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
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

  const { htmlContent, cssContent } = await extractBrandSignals(input.url);
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
          : buildDiscoverBrandingPrompt({ url: input.url, htmlContent, cssContent });

        const result = await adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0,
          timeout: provider.timeout,
        });

        const data = parseDiscoverBrandingResponse(result.text);

        return {
          data,
          model: model.displayName,
          provider: provider.name,
          attempts: totalAttempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw new CapabilityExhaustedError('discover-branding', totalAttempts, lastError);
}
