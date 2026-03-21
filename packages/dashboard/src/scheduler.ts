import { randomUUID } from 'node:crypto';
import type { ScanDb } from './db/scans.js';
import type { ScanOrchestrator } from './scanner/orchestrator.js';
import type { DashboardConfig } from './config.js';
import { computeNextRunAt } from './routes/schedules.js';

export function startScheduler(
  db: ScanDb,
  orchestrator: ScanOrchestrator,
  config: DashboardConfig,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const due = db.getDueSchedules();

      for (const schedule of due) {
        const scanId = randomUUID();
        const now = new Date();

        // Create a scan record
        db.createScan({
          id: scanId,
          siteUrl: schedule.siteUrl,
          standard: schedule.standard,
          jurisdictions: schedule.jurisdictions,
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
          scanMode: schedule.scanMode as 'single' | 'site',
          webserviceUrl: config.webserviceUrl,
          ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
            ? { webserviceUrls: config.webserviceUrls }
            : {}),
          complianceUrl: config.complianceUrl,
          maxPages: config.maxPages,
          ...(schedule.runner !== null ? { runner: schedule.runner as 'htmlcs' | 'axe' } : {}),
          ...(schedule.incremental ? { incremental: true, orgId: schedule.orgId } : {}),
        });

        // Update schedule: set last_run_at and compute next_run_at
        const nextRunAt = computeNextRunAt(schedule.frequency, now);
        db.updateSchedule(schedule.id, {
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
