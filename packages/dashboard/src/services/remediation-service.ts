/**
 * Remediation record assembly for the VPAT / ACR.
 *
 * Pure, side-effect-free: given the append-only remediation events for a site
 * plus its completed scan history, it assembles a "remediation record" — a
 * dated, attributed good-faith remediation log that demonstrates an active,
 * ongoing effort. This is a core US-lawsuit-protection artifact (ADA Title III
 * defense rests on showing documented good-faith remediation, not on claiming
 * compliance).
 *
 * LEGAL DEFENSIBILITY: this module only REPORTS what actually happened — every
 * row is backed by a real logged event (an AI fix PR was opened; a developer
 * moved an issue to fixed/verified) or a real completed scan. It never asserts
 * conformance or implies the site is "fixed". Empty input yields an empty
 * record, never an optimistic one.
 *
 * No fs, no Fastify, no I/O — unit-tests deterministically.
 */

import type { RemediationEvent, RemediationEventType, ScanRecord } from '../db/types.js';

export interface RemediationRecordEvent {
  readonly date: string;
  readonly type: RemediationEventType;
  readonly criterion: string | null;
  readonly detail: string | null;
  readonly actor: string | null;
}

export interface RemediationScanPoint {
  readonly date: string;
  readonly totalIssues: number;
  readonly errors: number;
}

export interface RemediationSummary {
  readonly aiProposed: number;
  readonly developerVerified: number;
  readonly manualVerified: number;
  readonly total: number;
  readonly firstActivity: string | null;
  readonly lastActivity: string | null;
}

export interface RemediationRecord {
  readonly events: readonly RemediationRecordEvent[];
  readonly summary: RemediationSummary;
  readonly scanTrend: readonly RemediationScanPoint[];
  /** True when there is nothing to show — callers can skip rendering. */
  readonly isEmpty: boolean;
}

export interface BuildRemediationOptions {
  /** Cap the number of events surfaced (most recent first). Default 50. */
  readonly maxEvents?: number;
}

/** ISO timestamp → YYYY-MM-DD (date-only display). */
function toDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Assembles a remediation record from raw events + completed scans. Events are
 * ordered most-recent-first; the scan trend is ordered oldest-first so a reader
 * can see issue counts change over time.
 */
export function buildRemediationRecord(
  events: readonly RemediationEvent[],
  scans: readonly ScanRecord[],
  opts: BuildRemediationOptions = {},
): RemediationRecord {
  const maxEvents = opts.maxEvents ?? 50;

  const sortedEvents = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const summary: RemediationSummary = {
    aiProposed: events.filter((e) => e.eventType === 'ai-proposed').length,
    developerVerified: events.filter((e) => e.eventType === 'developer-verified').length,
    manualVerified: events.filter((e) => e.eventType === 'manual-verified').length,
    total: events.length,
    firstActivity:
      events.length > 0
        ? toDate(events.reduce((min, e) => (e.createdAt < min ? e.createdAt : min), events[0].createdAt))
        : null,
    lastActivity:
      events.length > 0
        ? toDate(events.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), events[0].createdAt))
        : null,
  };

  const recordEvents: RemediationRecordEvent[] = sortedEvents.slice(0, maxEvents).map((e) => ({
    date: toDate(e.createdAt),
    type: e.eventType,
    criterion: e.criterion,
    detail: e.detail,
    actor: e.actor,
  }));

  // Scan trend: completed scans only, oldest-first, with their issue counts.
  const scanTrend: RemediationScanPoint[] = [...scans]
    .filter((s) => s.status === 'completed')
    .sort((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt))
    .map((s) => ({
      date: toDate(s.completedAt ?? s.createdAt),
      totalIssues: s.totalIssues ?? 0,
      errors: s.errors ?? 0,
    }));

  return {
    events: recordEvents,
    summary,
    scanTrend,
    isEmpty: events.length === 0 && scanTrend.length <= 1,
  };
}
