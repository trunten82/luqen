import { scanSources } from './compliance-client.js';
import type { DashboardConfig } from './config.js';
import type { ServiceTokenManager } from './auth/service-token.js';

/**
 * Starts a periodic compliance source monitor that triggers scans
 * based on each source's configured schedule (daily/weekly/monthly).
 *
 * The compliance API's scan endpoint checks each source's lastCheckedAt
 * against the current time and its schedule frequency to decide whether
 * to actually fetch and compare content. This scheduler just triggers
 * the scan periodically — the compliance API does the smart filtering.
 *
 * Interval: checks every 15 minutes whether a scan cycle is due.
 * A full scan cycle runs at most once per hour to avoid hammering sources.
 */
export function startSourceMonitorScheduler(
  config: DashboardConfig,
  tokenManager: ServiceTokenManager,
  intervalMs = 15 * 60 * 1000,
): NodeJS.Timeout {
  let lastFullScanAt = 0;
  const MIN_SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour minimum between full scans

  return setInterval(async () => {
    try {
      const now = Date.now();
      if (now - lastFullScanAt < MIN_SCAN_INTERVAL_MS) return;

      const token = await tokenManager.getToken();
      if (!token) return;

      // No force flag — the API filters sources by their schedule/lastCheckedAt
      await scanSources(config.complianceUrl, token);
      lastFullScanAt = now;
    } catch (err) {
      console.error(
        '[source-monitor] Error during scheduled scan:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, intervalMs);
}
