import type { StorageAdapter } from './db/index.js';
import type { ScanService } from './services/scan-service.js';
import { computeNextRunAt } from './routes/schedules.js';
import { runKeyHousekeeping } from './auth/oauth-key-rotation.js';

/**
 * Start the OAuth key-housekeeping sweep.
 *
 * Phase 31.1 Plan 04 Task 1. Runs nightly (24h interval) — sweeps expired
 * refresh tokens, marks retired keys past the D-25 overlap window as removed
 * from JWKS, and auto-rotates the current signing key if it's older than
 * `OAUTH_KEY_MAX_AGE_DAYS` (default 90 days).
 *
 * Uses `.unref()` so a running housekeeping timer does not prevent process
 * exit (mirrors the existing scheduler pattern).
 */
const KEY_HOUSEKEEPING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startKeyHousekeeping(
  storage: StorageAdapter,
  encryptionKey: string,
  intervalMs: number = KEY_HOUSEKEEPING_INTERVAL_MS,
): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      await runKeyHousekeeping(storage, encryptionKey);
    } catch (err) {
      // Log but don't crash — housekeeping failures must not crash the dashboard.
      // eslint-disable-next-line no-console
      console.error(
        '[scheduler] OAuth key housekeeping failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Run every schedule that is due now. One pass of the scheduler tick, exported
 * so a test can drive it without a timer.
 *
 * Each due schedule is handed to the scan service, which validates the stored
 * start URL before anything starts. The schedule always advances, whether the
 * start succeeded, was refused or threw, so a refused schedule is not
 * re-evaluated every minute. A failure of one schedule never stops the others.
 */
export async function runDueSchedules(
  storage: StorageAdapter,
  scanService: ScanService,
  now: Date = new Date(),
): Promise<void> {
  const due = await storage.schedules.getDueSchedules(now);

  for (const schedule of due) {
    try {
      await scanService.startScheduledScan(schedule, now);
    } catch (err) {
      // Log the schedule id and error name only: never the site URL.
      console.error(
        `[scheduler] Schedule ${schedule.id} could not start:`,
        err instanceof Error ? err.name : 'unknown error',
      );
    }

    await storage.schedules.updateSchedule(schedule.id, {
      lastRunAt: now.toISOString(),
      nextRunAt: computeNextRunAt(schedule.frequency, now),
    });
  }
}

export function startScheduler(
  storage: StorageAdapter,
  scanService: ScanService,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await runDueSchedules(storage, scanService);
    } catch (err) {
      // Log but don't crash — the scheduler should be resilient
      console.error('[scheduler] Error processing due schedules:', err instanceof Error ? err.message : String(err));
    }
  }, intervalMs);
}
