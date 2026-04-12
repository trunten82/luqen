#!/usr/bin/env -S npx tsx
/**
 * Typography x-height spike POC — Phase 26 feasibility instrument.
 *
 * Resolves 10 popular Google Font families to TTF URLs via the Google Fonts
 * Developer API, parses each TTF with opentype.js, and extracts OS/2 table
 * x-height metrics. Reports a viability verdict based on an 80% coverage
 * threshold for sxHeight data.
 *
 * Usage (from packages/dashboard):
 *   GOOGLE_FONTS_API_KEY=your_key npx tsx scripts/spike-font-metrics.ts
 *
 * Output: per-family metrics table + VIABLE / NOT VIABLE verdict.
 */

import opentype from 'opentype.js';
import { z } from 'zod';

// ── Configuration ────────────────────────────────────────────────────────────

const API_KEY = process.env['GOOGLE_FONTS_API_KEY'];
if (!API_KEY) {
  process.stderr.write(
    '[error] GOOGLE_FONTS_API_KEY environment variable is required.\n' +
    '        Get one at: Google Cloud Console -> APIs & Services -> Credentials\n' +
    '        Enable: Web Fonts Developer API\n',
  );
  process.exit(1);
}

const COVERAGE_THRESHOLD = 0.8; // 80%

const TEST_FAMILIES = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Source Sans 3', 'Noto Sans', 'Playfair Display', 'Merriweather', 'Raleway',
] as const;

// ── Zod schema for Google Fonts API response ─────────────────────────────────

const GoogleFontsItemSchema = z.object({
  family: z.string(),
  files: z.record(z.string(), z.string()),
}).passthrough();

const GoogleFontsResponseSchema = z.object({
  items: z.array(GoogleFontsItemSchema).min(1),
}).passthrough();

// ── Types ────────────────────────────────────────────────────────────────────

interface FontMetrics {
  readonly family: string;
  readonly ttfUrl: string | null;
  readonly unitsPerEm: number | null;
  readonly os2Version: number | null;
  readonly sxHeight: number | null;
  readonly sCapHeight: number | null;
  readonly xHeightRatio: number | null;
  readonly error?: string;
}

// ── Functions ────────────────────────────────────────────────────────────────

async function resolveTtfUrl(family: string, apiKey: string): Promise<string | null> {
  const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&family=${encodeURIComponent(family)}`;
  const response = await fetch(url);

  if (!response.ok) {
    process.stderr.write(`[warn] Google Fonts API returned ${response.status} for "${family}"\n`);
    return null;
  }

  const json: unknown = await response.json();
  const parsed = GoogleFontsResponseSchema.safeParse(json);

  if (!parsed.success) {
    process.stderr.write(`[warn] Unexpected API response shape for "${family}"\n`);
    return null;
  }

  const item = parsed.data.items[0]!;
  const files = item.files;

  // Prefer regular weight; fall back to 400, then first available
  return files['regular'] ?? files['400'] ?? Object.values(files)[0] ?? null;
}

async function extractMetrics(family: string, ttfUrl: string): Promise<FontMetrics> {
  try {
    const response = await fetch(ttfUrl);
    if (!response.ok) {
      return {
        family,
        ttfUrl,
        unitsPerEm: null,
        os2Version: null,
        sxHeight: null,
        sCapHeight: null,
        xHeightRatio: null,
        error: `HTTP ${response.status} fetching TTF`,
      };
    }

    const buffer = await response.arrayBuffer();
    const font = opentype.parse(buffer);

    const os2 = font.tables['os2'] as Record<string, unknown> | undefined;
    const unitsPerEm = font.unitsPerEm;
    const os2Version = (typeof os2?.['version'] === 'number') ? os2['version'] as number : null;
    const rawSxHeight = (typeof os2?.['sxHeight'] === 'number') ? os2['sxHeight'] as number : 0;
    const rawSCapHeight = (typeof os2?.['sCapHeight'] === 'number') ? os2['sCapHeight'] as number : 0;

    const sxHeight = rawSxHeight > 0 ? rawSxHeight : null;
    const sCapHeight = rawSCapHeight > 0 ? rawSCapHeight : null;
    const xHeightRatio = (sxHeight !== null && unitsPerEm > 0)
      ? Math.round((sxHeight / unitsPerEm) * 1000) / 1000
      : null;

    return {
      family,
      ttfUrl,
      unitsPerEm,
      os2Version,
      sxHeight,
      sCapHeight,
      xHeightRatio,
    };
  } catch (err) {
    return {
      family,
      ttfUrl,
      unitsPerEm: null,
      os2Version: null,
      sxHeight: null,
      sCapHeight: null,
      xHeightRatio: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write('\n=== Typography x-height Spike POC ===\n\n');
  process.stdout.write(`Testing ${TEST_FAMILIES.length} popular Google Font families...\n\n`);

  const results: FontMetrics[] = [];

  for (const family of TEST_FAMILIES) {
    process.stderr.write(`[info] Processing "${family}"...\n`);

    const ttfUrl = await resolveTtfUrl(family, API_KEY);
    if (!ttfUrl) {
      results.push({
        family,
        ttfUrl: null,
        unitsPerEm: null,
        os2Version: null,
        sxHeight: null,
        sCapHeight: null,
        xHeightRatio: null,
        error: 'Could not resolve TTF URL',
      });
      continue;
    }

    const metrics = await extractMetrics(family, ttfUrl);
    results.push(metrics);
  }

  // ── Print results table ──────────────────────────────────────────────────

  process.stdout.write('\n--- Per-Family Metrics ---\n\n');

  const header = [
    'Family'.padEnd(20),
    'OS/2 Ver'.padEnd(10),
    'UPM'.padEnd(8),
    'sxHeight'.padEnd(10),
    'sCapHeight'.padEnd(12),
    'xH Ratio'.padEnd(10),
    'Status',
  ].join(' | ');

  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');

  for (const r of results) {
    const row = [
      r.family.padEnd(20),
      (r.os2Version !== null ? String(r.os2Version) : '-').padEnd(10),
      (r.unitsPerEm !== null ? String(r.unitsPerEm) : '-').padEnd(8),
      (r.sxHeight !== null ? String(r.sxHeight) : '-').padEnd(10),
      (r.sCapHeight !== null ? String(r.sCapHeight) : '-').padEnd(12),
      (r.xHeightRatio !== null ? String(r.xHeightRatio) : '-').padEnd(10),
      r.error ? `ERR: ${r.error}` : (r.sxHeight !== null ? 'OK' : 'NO sxHeight'),
    ].join(' | ');
    process.stdout.write(row + '\n');
  }

  // ── Compute coverage and verdict ─────────────────────────────────────────

  const resolved = results.filter((r) => r.ttfUrl !== null);
  const withXHeight = resolved.filter((r) => r.sxHeight !== null);
  const coverage = resolved.length > 0
    ? withXHeight.length / resolved.length
    : 0;
  const coveragePct = Math.round(coverage * 100);

  process.stdout.write(`\n--- Coverage ---\n`);
  process.stdout.write(`Resolved: ${resolved.length}/${results.length} families\n`);
  process.stdout.write(`With sxHeight: ${withXHeight.length}/${resolved.length} (${coveragePct}%)\n`);
  process.stdout.write(`Threshold: ${Math.round(COVERAGE_THRESHOLD * 100)}%\n\n`);

  if (coverage >= COVERAGE_THRESHOLD) {
    process.stdout.write(`VERDICT: VIABLE -- ${coveragePct}% of tested families have sxHeight data\n`);
  } else {
    process.stdout.write(`VERDICT: NOT VIABLE -- only ${coveragePct}% of tested families have sxHeight data\n`);
  }

  process.stdout.write('\n');
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
