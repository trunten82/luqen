#!/usr/bin/env -S npx tsx
/**
 * Scanner latency benchmark — Phase 18 gate instrument.
 *
 * Runs the ScanOrchestrator end-to-end against 4 real-world target sites,
 * 1 warm-up run + 3 measured runs each (WARM protocol), prints a JSON result
 * block to stdout, and exits.
 *
 * Invoked BEFORE the Phase 18 rewire (plan 18-01) and AFTER the rewire
 * (plan 18-06). The raw output of both runs is captured in the phase artifacts
 * 18-01-BASELINE.md and 18-06-POST.md respectively. The <15% gate is applied
 * in plan 18-06 by comparing grand medians.
 *
 * Usage (from packages/dashboard):
 *   NODE_OPTIONS="--max-old-space-size=8192" npx tsx scripts/scanner-latency-bench.ts
 *
 * Output (stdout, last line is machine-parseable JSON):
 *   {"kind":"scanner-latency-bench","gitSha":"...","date":"...","runs":[...],"perSiteMedianMs":{...},"grandMedianMs":N}
 *
 * Informational progress lines go to stderr so stdout is always a single JSON line.
 *
 * Design notes:
 * - Each SITE gets a fresh SqliteStorageAdapter + ScanOrchestrator so pa11y
 *   + headless browser memory is released between sites. A single long-lived
 *   orchestrator exhausts the heap on large sites (observed on sap.com during
 *   initial bench attempts).
 * - Per-run wall-clock hard timeout: if a single run exceeds PER_RUN_TIMEOUT_MS
 *   the bench records the run as `terminalEvent: 'timeout'` and skips
 *   remaining runs for that site (per phase plan guidance). Other sites still
 *   run so the baseline grid is produced regardless.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteStorageAdapter } from '../src/db/sqlite/index.js';
import { ScanOrchestrator, type ScanConfig, type ScanProgressEvent } from '../src/scanner/orchestrator.js';

// ── Locked methodology (DO NOT change without replanning the phase) ─────────
const DEFAULT_TARGET_SITES = [
  'https://www.aperol.com/',
  'https://www.sap.com/',
  'https://www.inps.it/',
  'https://www.sky.it/',
] as const;
/**
 * Effective site list. Defaults to the locked 4-site grid. Can be narrowed
 * via the BENCH_SITES env var (comma-separated URLs) so the bench can be
 * driven site-by-site under an OS-level `timeout` wrapper — necessary because
 * pa11y's synchronous Puppeteer calls can starve the Node event loop and
 * delay our in-process PER_RUN_TIMEOUT_MS timer (observed on sap.com).
 */
const TARGET_SITES: readonly string[] = process.env.BENCH_SITES !== undefined
  ? process.env.BENCH_SITES.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  : DEFAULT_TARGET_SITES;
const WARM_UP_RUNS = 1;
const MEASURED_RUNS = 3;
const MAX_PAGES = 10;
/** Per-run wall-clock cap (in-process timer — can be delayed by event loop
 *  starvation in pa11y). Hard per-site guarantee is provided by an OS-level
 *  `timeout` wrapper around each bench subprocess invocation. */
const PER_RUN_TIMEOUT_MS = 10 * 60 * 1000;

interface RunResult {
  readonly site: string;
  readonly runIndex: number;         // 0 = warm-up, 1..3 = measured
  readonly measured: boolean;
  readonly wallMs: number;
  readonly terminalEvent: 'complete' | 'failed' | 'timeout';
  readonly error?: string;
}

async function runOne(
  orchestrator: ScanOrchestrator,
  storage: SqliteStorageAdapter,
  site: string,
  runIndex: number,
  measured: boolean,
): Promise<RunResult> {
  const scanId = randomUUID();
  await storage.scans.createScan({
    id: scanId,
    siteUrl: site,
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'bench',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });

  const config: ScanConfig = {
    siteUrl: site,
    standard: 'WCAG2AA',
    concurrency: 2,
    jurisdictions: [],
    regulations: [],
    scanMode: 'site',
    maxPages: MAX_PAGES,
    orgId: 'system',
    runner: 'htmlcs',
  };

  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const listener = (event: ScanProgressEvent): void => {
      if (settled) return;
      if (event.type === 'complete' || event.type === 'failed') {
        settled = true;
        clearTimeout(timeoutHandle);
        const wallMs = performance.now() - start;
        orchestrator.off(scanId, listener);
        const error = event.data.error;
        resolve({
          site,
          runIndex,
          measured,
          wallMs,
          terminalEvent: event.type,
          ...(error !== undefined ? { error } : {}),
        });
      }
    };
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      orchestrator.off(scanId, listener);
      const wallMs = performance.now() - start;
      resolve({
        site,
        runIndex,
        measured,
        wallMs,
        terminalEvent: 'timeout',
        error: `Exceeded per-run cap ${PER_RUN_TIMEOUT_MS}ms`,
      });
    }, PER_RUN_TIMEOUT_MS);
    orchestrator.on(scanId, listener);
    orchestrator.startScan(scanId, config);
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function runSite(site: string, reportsBase: string): Promise<RunResult[]> {
  // Fresh storage + orchestrator per site so pa11y/headless-browser memory
  // is released between sites. Observed OOM when sharing a single
  // orchestrator across all 4 sites on sap.com.
  const tmp = mkdtempSync(join(tmpdir(), 'luqen-bench-'));
  const dbPath = join(tmp, 'bench.sqlite');
  const reportsDir = join(reportsBase, randomUUID());

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const orchestrator = new ScanOrchestrator(storage, reportsDir, { maxConcurrent: 1 });
  const siteRuns: RunResult[] = [];

  try {
    process.stderr.write(`[info] warming ${site} ...\n`);
    let sawTimeout = false;
    for (let i = 0; i < WARM_UP_RUNS && !sawTimeout; i++) {
      const r = await runOne(orchestrator, storage, site, i, false);
      siteRuns.push(r);
      process.stderr.write(
        `[info]  warm-up ${site}: ${r.wallMs.toFixed(0)}ms (${r.terminalEvent})\n`,
      );
      if (r.terminalEvent === 'timeout') {
        sawTimeout = true;
        process.stderr.write(
          `[warn] ${site} warm-up hit timeout cap — skipping measured runs for this site.\n`,
        );
      }
    }
    for (let i = 0; i < MEASURED_RUNS && !sawTimeout; i++) {
      process.stderr.write(`[info] measuring ${site} run ${i + 1}/${MEASURED_RUNS} ...\n`);
      const r = await runOne(orchestrator, storage, site, i + 1, true);
      siteRuns.push(r);
      process.stderr.write(
        `[info]  measured ${site} #${i + 1}: ${r.wallMs.toFixed(0)}ms (${r.terminalEvent})\n`,
      );
      if (r.terminalEvent === 'timeout') {
        sawTimeout = true;
        process.stderr.write(
          `[warn] ${site} measured run hit timeout cap — skipping remaining runs for this site.\n`,
        );
      }
    }
  } finally {
    await storage.disconnect();
    rmSync(tmp, { recursive: true, force: true });
  }

  return siteRuns;
}

async function main(): Promise<void> {
  const reportsBase = mkdtempSync(join(tmpdir(), 'luqen-bench-reports-'));

  // Safe: execFileSync with argv, no shell, hardcoded binary and args.
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }).toString().trim();
  const date = new Date().toISOString();
  const runs: RunResult[] = [];

  try {
    for (const site of TARGET_SITES) {
      const siteRuns = await runSite(site, reportsBase);
      runs.push(...siteRuns);
    }
  } finally {
    rmSync(reportsBase, { recursive: true, force: true });
  }

  const perSiteMedianMs: Record<string, number> = {};
  for (const site of TARGET_SITES) {
    const siteMeasured = runs
      .filter((r) => r.site === site && r.measured && r.terminalEvent === 'complete')
      .map((r) => r.wallMs);
    perSiteMedianMs[site] = siteMeasured.length > 0 ? Math.round(median(siteMeasured)) : -1;
  }
  const grandMedianMs = Math.round(
    median(Object.values(perSiteMedianMs).filter((v) => v >= 0)),
  );

  const output = {
    kind: 'scanner-latency-bench',
    gitSha,
    date,
    methodology: {
      sites: TARGET_SITES,
      warmUpRuns: WARM_UP_RUNS,
      measuredRuns: MEASURED_RUNS,
      maxPages: MAX_PAGES,
      perRunTimeoutMs: PER_RUN_TIMEOUT_MS,
      metric: 'wall-clock ms from startScan() to complete|failed event',
      concurrency: 1,
    },
    runs: runs.map((r) => ({
      site: r.site,
      runIndex: r.runIndex,
      measured: r.measured,
      wallMs: Math.round(r.wallMs),
      terminalEvent: r.terminalEvent,
      ...(r.error !== undefined ? { error: r.error } : {}),
    })),
    perSiteMedianMs,
    grandMedianMs,
  };

  process.stdout.write(JSON.stringify(output) + '\n');
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
