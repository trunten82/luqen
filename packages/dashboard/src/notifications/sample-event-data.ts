/**
 * Phase 50-03 — curated sample event-data fixtures used by the notification
 * preview pane. Read-only; never persisted; never sent to plugins outside the
 * test-send route.
 */

import type { NotificationEventType } from '../db/types.js';

export const SAMPLE_EVENT_DATA: Readonly<Record<NotificationEventType, Record<string, unknown>>> = {
  'scan.complete': {
    site: 'example.com',
    siteUrl: 'https://example.com',
    scanId: 'scan-2026-04-28-001',
    score: 78,
    issueCount: 12,
    topIssues: [
      { criterion: '1.1.1', count: 4 },
      { criterion: '1.4.3', count: 3 },
      { criterion: '2.4.4', count: 2 },
    ],
    reportUrl: '/reports/sample',
    completedAt: '2026-04-28T09:30:00Z',
  },
  'scan.failed': {
    site: 'example.com',
    siteUrl: 'https://example.com',
    scanId: 'scan-2026-04-28-002',
    error: 'Timeout connecting to site',
    failedAt: '2026-04-28T09:35:00Z',
    reportUrl: null,
  },
  'violation.found': {
    site: 'example.com',
    siteUrl: 'https://example.com',
    regulation: 'EU-EAA',
    regulationName: 'European Accessibility Act',
    criterion: '1.1.1',
    severity: 'error',
    message: 'Image is missing alt text',
    foundAt: '2026-04-28T09:40:00Z',
  },
  'regulation.changed': {
    regulationId: 'EU-EAA',
    regulationName: 'European Accessibility Act',
    change: 'Effective date moved to 2026-09-01',
    regulationUrl: '/admin/regulations/EU-EAA',
    changedAt: '2026-04-28T08:00:00Z',
  },
};

export function getSampleEventData(eventType: NotificationEventType): Record<string, unknown> {
  return { ...(SAMPLE_EVENT_DATA[eventType] ?? {}) };
}
