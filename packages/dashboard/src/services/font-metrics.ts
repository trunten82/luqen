/**
 * FontMetricsService — resolves Google Font families to x-height metrics
 * and persists them via the branding repository.
 *
 * Security:
 * - API key passed via constructor from config; never logged (T-26-05)
 * - opentype.parse() wrapped in try/catch; null return on failure (T-26-06)
 * - All DB writes use parameterized queries (T-26-08)
 * - Zod validates Google Fonts API response shape before use (T-26-05)
 */

import opentype from 'opentype.js';
import { z } from 'zod';

const GoogleFontsResponseSchema = z.object({
  items: z.array(z.object({
    family: z.string(),
    files: z.record(z.string(), z.string()),
  }).passthrough()).min(1),
}).passthrough();

const GOOGLE_FONTS_API = 'https://www.googleapis.com/webfonts/v1/webfonts';

export interface FontMetrics {
  readonly xHeight: number | null;
  readonly capHeight: number | null;
  readonly unitsPerEm: number;
}

export async function resolveTtfUrl(family: string, apiKey: string): Promise<string | null> {
  const url = `${GOOGLE_FONTS_API}?key=${encodeURIComponent(apiKey)}&family=${encodeURIComponent(family)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw: unknown = await res.json();
  const parsed = GoogleFontsResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const files = parsed.data.items[0].files;
  return files['regular'] ?? files['400'] ?? Object.values(files)[0] ?? null;
}

export async function extractMetrics(ttfUrl: string): Promise<FontMetrics | null> {
  try {
    const buffer = await fetch(ttfUrl).then((r) => r.arrayBuffer());
    const font = opentype.parse(buffer);
    const os2 = font.tables.os2;
    return {
      xHeight: (os2 && os2.sxHeight > 0) ? os2.sxHeight : null,
      capHeight: (os2 && os2.sCapHeight > 0) ? os2.sCapHeight : null,
      unitsPerEm: font.unitsPerEm,
    };
  } catch {
    return null;
  }
}

export interface FontMetricsRepo {
  updateFont(id: string, data: { xHeight?: number; capHeight?: number; unitsPerEm?: number }): Promise<void>;
}

export interface FontMetricsLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export class FontMetricsService {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly repo: FontMetricsRepo,
    private readonly logger: FontMetricsLogger,
  ) {}

  async enrichFontMetrics(fontId: string, family: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.debug({}, 'Google Fonts API key not configured — skipping metric extraction');
      return;
    }
    try {
      const ttfUrl = await resolveTtfUrl(family, this.apiKey);
      if (!ttfUrl) {
        this.logger.debug({ family }, 'Could not resolve TTF URL for font family');
        return;
      }
      const metrics = await extractMetrics(ttfUrl);
      if (!metrics) {
        this.logger.debug({ family }, 'Could not extract metrics from TTF');
        return;
      }
      await this.repo.updateFont(fontId, {
        ...(metrics.xHeight !== null ? { xHeight: metrics.xHeight } : {}),
        ...(metrics.capHeight !== null ? { capHeight: metrics.capHeight } : {}),
        unitsPerEm: metrics.unitsPerEm,
      });
    } catch (err) {
      this.logger.warn({ err, family }, 'FontMetricsService: failed to enrich font metrics');
    }
  }
}
