/**
 * Phase 76 — Periodic retention purge for the llm_usage table.
 *
 * Default policy: keep 90 days of raw rows. Override via
 *   LLM_USAGE_RETENTION_DAYS=<integer>
 * Set to 0 to disable purging entirely (compliance-frozen tenants).
 *
 * The purge runs:
 *   1. Once shortly after process start (10s delay so initial traffic
 *      isn't competing with a DELETE), and
 *   2. Every 24 hours thereafter.
 *
 * Errors are logged but never propagate — the LLM service must stay
 * up even if the purge fails (e.g. transient disk contention).
 */

import type { DbAdapter } from '../db/adapter.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 10_000;

interface RetentionLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export function resolveRetentionDays(): number {
  const raw = process.env['LLM_USAGE_RETENTION_DAYS'];
  if (raw === undefined) return 90;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 90;
  return parsed;
}

export function computeCutoffIso(retentionDays: number, now: Date = new Date()): string {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  return cutoff.toISOString();
}

export async function purgeOnce(
  db: DbAdapter,
  log: RetentionLogger,
  retentionDays: number,
): Promise<number> {
  if (retentionDays === 0) {
    log.info({ retentionDays }, 'usage-retention: purge disabled (retention=0)');
    return 0;
  }
  const cutoff = computeCutoffIso(retentionDays);
  try {
    const purged = await db.purgeUsageBefore(cutoff);
    if (purged > 0) {
      log.info({ purged, cutoff, retentionDays }, 'usage-retention: purged stale rows');
    }
    return purged;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : 'unknown', cutoff },
      'usage-retention: purge failed (will retry on next interval)',
    );
    return 0;
  }
}

export function startUsageRetention(
  db: DbAdapter,
  log: RetentionLogger,
  options: { readonly intervalMs?: number; readonly initialDelayMs?: number } = {},
): NodeJS.Timeout {
  const retentionDays = resolveRetentionDays();
  const interval = options.intervalMs ?? DAY_MS;
  const initial = options.initialDelayMs ?? INITIAL_DELAY_MS;
  log.info({ retentionDays }, 'usage-retention: scheduled');
  setTimeout(() => { void purgeOnce(db, log, retentionDays); }, initial).unref();
  const handle = setInterval(() => { void purgeOnce(db, log, retentionDays); }, interval);
  handle.unref();
  return handle;
}
