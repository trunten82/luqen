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
 * Each due schedule is claimed first: its last and next run are written before
 * the slow start work, so a later pass over the same instant does not find it
 * due and start it twice. The claim holds whether the start then succeeds, is
 * refused or throws. The stored start URL is validated by the scan service
 * before anything starts. Each schedule is handled on its own: a failure of one
 * (its claim or its start) is logged by id and error name and never stops the
 * others. A schedule whose claim could not be written starts nothing this pass.
 */
export async function runDueSchedules(
  storage: StorageAdapter,
  scanService: ScanService,
  now: Date = new Date(),
): Promise<void> {
  const due = await storage.schedules.getDueSchedules(now);

  for (const schedule of due) {
    try {
      await storage.schedules.updateSchedule(schedule.id, {
        lastRunAt: now.toISOString(),
        nextRunAt: computeNextRunAt(schedule.frequency, now),
      });
    } catch (err) {
      logScheduleFailure(schedule.id, 'could not be claimed', err);
      continue;
    }

    try {
      await scanService.startScheduledScan(schedule, now);
    } catch (err) {
      logScheduleFailure(schedule.id, 'could not start', err);
    }
  }
}

/** Log the schedule id and the error name only: never the site URL or the message. */
function logScheduleFailure(id: string, what: string, err: unknown): void {
  console.error(
    `[scheduler] Schedule ${id} ${what}:`,
    err instanceof Error ? err.name : 'unknown error',
  );
}

/**
 * Run {@link runDueSchedules} on an interval. A tick that finds the previous
 * one still running does nothing: passes never overlap.
 */
export function startScheduler(
  storage: StorageAdapter,
  scanService: ScanService,
  intervalMs = 60_000,
): NodeJS.Timeout {
  let inFlight = false;
  return setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runDueSchedules(storage, scanService);
    } catch (err) {
      // Log but don't crash — the scheduler should be resilient
      console.error('[scheduler] Error processing due schedules:', err instanceof Error ? err.message : String(err));
    } finally {
      inFlight = false;
    }
  }, intervalMs);
}
