#!/usr/bin/env node
/**
 * comment-reporter-cli — reads a BaselineDiff JSON (from --gate-output) and
 * an optional enrichment JSON, then prints the GitHub PR comment body to stdout.
 *
 * Usage:
 *   node dist/comment-reporter-cli.js <diff-json-path> [enrichment-json-path]
 *
 * Exits 0 regardless of diff content (the gate step owns the exit code).
 * On parse failure emits a degraded/infra-error comment body — never a raw stack trace.
 *
 * Security: no network calls, no token handling. Pure file-in / stdout-out.
 */

import { readFileSync } from 'node:fs';
import { formatPrComment, type EnrichmentByCode, type EnrichmentEntry } from './reporter/comment-reporter.js';
import type { BaselineDiff } from './baseline/diff.js';

// ---------------------------------------------------------------------------
// Types for the enrichment JSON shape
// ---------------------------------------------------------------------------

interface EnrichmentJsonEntry {
  jurisdictionId?: string;
  jurisdictionName?: string;
  obligation?: string;
  regulationName?: string;
}

// ---------------------------------------------------------------------------
// runCli — exported for tests that want to import rather than spawn
// ---------------------------------------------------------------------------

export async function runCli(diffJsonPath?: string, enrichmentJsonPath?: string): Promise<void> {
  const resolvedDiffPath = diffJsonPath ?? process.argv[2];
  const resolvedEnrichmentPath = enrichmentJsonPath ?? process.argv[3];

  // Parse the diff JSON — on failure, emit degraded infra-error body
  let diff: BaselineDiff & { infraError?: boolean };
  try {
    if (!resolvedDiffPath) {
      throw new Error('No diff JSON path provided');
    }
    const raw = readFileSync(resolvedDiffPath, 'utf-8');
    diff = JSON.parse(raw) as BaselineDiff & { infraError?: boolean };
  } catch {
    // T-79-09: never emit raw parse errors to stdout (they would break the Markdown body)
    diff = {
      newFindings: [],
      fixedFindings: [],
      unchanged: [],
      infraError: true,
    };
  }

  // Build enrichment map from the optional enrichment JSON
  const enrichmentByCode: Map<string, readonly EnrichmentEntry[]> = new Map();
  if (resolvedEnrichmentPath) {
    try {
      const raw = readFileSync(resolvedEnrichmentPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, EnrichmentJsonEntry[]>;
      for (const [code, entries] of Object.entries(parsed)) {
        if (Array.isArray(entries)) {
          enrichmentByCode.set(code, entries.map((e) => ({
            jurisdictionName: e.jurisdictionName ?? e.jurisdictionId ?? '',
            obligation: e.obligation,
            regulationName: e.regulationName,
          })));
        }
      }
    } catch {
      // Enrichment parsing failure is non-fatal — proceed with empty map
    }
  }

  const baselinePath = (diff as unknown as Record<string, unknown>)['meta']
    ? ((diff as unknown as Record<string, unknown>)['meta'] as Record<string, unknown>)['baselinePath'] as string | undefined ?? '.luqen/baseline.json'
    : '.luqen/baseline.json';

  const body = formatPrComment(diff, enrichmentByCode as EnrichmentByCode, baselinePath);
  process.stdout.write(body);
}

// ---------------------------------------------------------------------------
// Main-guard: only execute when this file is the entry point
// ---------------------------------------------------------------------------

// In ESM, import.meta.url identifies this file. When run as main (node <file> ...)
// process.argv[1] will be the resolved path of this file.
const isMain = typeof process !== 'undefined'
  && process.argv[1]?.endsWith('comment-reporter-cli.ts')
  || process.argv[1]?.endsWith('comment-reporter-cli.js');

if (isMain) {
  runCli().catch((err) => {
    // Last-resort: if runCli throws unexpectedly, emit degraded body not a stack trace
    const fallbackBody = [
      '<!-- luqen-gate -->',
      '## Luqen accessibility gate',
      '',
      'Gate could not complete — internal error.',
      '',
      '> Not legal advice. This report identifies new accessibility findings vs the stored baseline.',
      '> A zero-new result does not assert conformance.',
    ].join('\n');
    process.stdout.write(fallbackBody);
    void err; // suppress unused warning
    process.exit(0);
  });
}
