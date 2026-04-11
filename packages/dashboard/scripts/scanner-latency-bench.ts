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
 *   npx tsx scripts/scanner-latency-bench.ts
 *
 * Output (stdout, last line is machine-parseable JSON):
 *   {"kind":"scanner-latency-bench","gitSha":"...","date":"...","runs":[...],"perSiteMedianMs":{...},"grandMedianMs":N}
 *
 * Informational progress lines go to stderr so stdout is always a single JSON line.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteStorageAdapter } from '../src/db/sqlite/index.js';
import { ScanOrchestrator, type ScanConfig, type ScanProgressEvent } from '../src/scanner/orchestrator.js';

// ── Locked methodology (DO NOT change without replanning the phase) ─────────
const TARGET_SITES = [
  'https://www.aperol.com/',
  'https://www.sap.com/',
  'https://www.inps.it/',
  'https://www.sky.it/',
] as const;
const WARM_UP_RUNS = 1;
const MEASURED_RUNS = 3;
const MAX_PAGES = 10;

interface RunResult {
  readonly site: string;
  readonly runIndex: number;         // 0 = warm-up, 1..3 = measured
  readonly measured: boolean;
  readonly wallMs: number;
  readonly terminalEvent: 'complete' | 'failed';
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
    const listener = (event: ScanProgressEvent): void => {
      if (event.type === 'complete' || event.type === 'failed') {
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

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'luqen-bench-'));
  const dbPath = join(tmp, 'bench.sqlite');
  const reportsDir = join(tmp, 'reports');

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const orchestrator = new ScanOrchestrator(storage, reportsDir, { maxConcurrent: 1 });

  // Safe: execFileSync with argv, no shell, hardcoded binary and args.
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }).toString().trim();
  const date = new Date().toISOString();
  const runs: RunResult[] = [];

  try {
    for (const site of TARGET_SITES) {
      process.stderr.write(`[info] warming ${site} ...\n`);
      for (let i = 0; i < WARM_UP_RUNS; i++) {
        const r = await runOne(orchestrator, storage, site, i, false);
        runs.push(r);
        process.stderr.write(`[info]  warm-up ${site}: ${r.wallMs.toFixed(0)}ms (${r.terminalEvent})\n`);
      }
      for (let i = 0; i < MEASURED_RUNS; i++) {
        process.stderr.write(`[info] measuring ${site} run ${i + 1}/${MEASURED_RUNS} ...\n`);
        const r = await runOne(orchestrator, storage, site, i + 1, true);
        runs.push(r);
        process.stderr.write(`[info]  measured ${site} #${i + 1}: ${r.wallMs.toFixed(0)}ms (${r.terminalEvent})\n`);
      }
    }
  } finally {
    await storage.disconnect();
    rmSync(tmp, { recursive: true, force: true });
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
