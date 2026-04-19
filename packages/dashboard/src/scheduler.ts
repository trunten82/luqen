import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from './db/index.js';
import type { ScanOrchestrator } from './scanner/orchestrator.js';
import type { DashboardConfig } from './config.js';
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

export function startScheduler(
  storage: StorageAdapter,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const due = await storage.schedules.getDueSchedules();

      for (const schedule of due) {
        const scanId = randomUUID();
        const now = new Date();

        // Create a scan record
        await storage.scans.createScan({
          id: scanId,
          siteUrl: schedule.siteUrl,
          standard: schedule.standard,
          jurisdictions: schedule.jurisdictions,
          regulations: [],
          createdBy: `scheduler:${schedule.createdBy}`,
          createdAt: now.toISOString(),
          orgId: schedule.orgId,
        });

        // Start the scan via orchestrator
        orchestrator.startScan(scanId, {
          siteUrl: schedule.siteUrl,
          standard: schedule.standard,
          concurrency: config.maxConcurrentScans,
          jurisdictions: schedule.jurisdictions,
          regulations: [],
          scanMode: schedule.scanMode as 'single' | 'site',
          ...(config.webserviceUrl !== undefined ? { webserviceUrl: config.webserviceUrl } : {}),
          ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
            ? { webserviceUrls: config.webserviceUrls }
            : {}),
          complianceUrl: config.complianceUrl,
          maxPages: config.maxPages,
          ...(schedule.runner !== null ? { runner: schedule.runner as 'htmlcs' | 'axe' } : {}),
          ...(schedule.incremental ? { incremental: true } : {}),
          orgId: schedule.orgId,
        });

        // Update schedule: set last_run_at and compute next_run_at
        const nextRunAt = computeNextRunAt(schedule.frequency, now);
        await storage.schedules.updateSchedule(schedule.id, {
          lastRunAt: now.toISOString(),
          nextRunAt,
        });
      }
    } catch (err) {
      // Log but don't crash — the scheduler should be resilient
      console.error('[scheduler] Error processing due schedules:', err instanceof Error ? err.message : String(err));
    }
  }, intervalMs);
}
