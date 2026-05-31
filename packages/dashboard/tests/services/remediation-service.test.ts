import { describe, it, expect } from 'vitest';
import { buildRemediationRecord } from '../../src/services/remediation-service.js';
import type { RemediationEvent, ScanRecord } from '../../src/db/types.js';

function ev(partial: Partial<RemediationEvent> & { eventType: RemediationEvent['eventType']; createdAt: string }): RemediationEvent {
  return {
    id: `e-${partial.createdAt}-${partial.eventType}`,
    orgId: 'system',
    siteUrl: 'https://example.com',
    scanId: 'scan-1',
    criterion: null,
    detail: null,
    actor: null,
    ...partial,
  };
}

function scan(partial: Partial<ScanRecord> & { id: string; createdAt: string }): ScanRecord {
  return {
    siteUrl: 'https://example.com',
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'u',
    orgId: 'system',
    ...partial,
  } as ScanRecord;
}

describe('buildRemediationRecord', () => {
  it('returns an empty record for no events and ≤1 scan', () => {
    const rec = buildRemediationRecord([], []);
    expect(rec.isEmpty).toBe(true);
    expect(rec.events).toHaveLength(0);
    expect(rec.summary.total).toBe(0);
    expect(rec.summary.firstActivity).toBeNull();
  });

  it('counts events by type', () => {
    const rec = buildRemediationRecord(
      [
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-01T10:00:00Z' }),
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-02T10:00:00Z' }),
        ev({ eventType: 'developer-verified', createdAt: '2026-05-03T10:00:00Z' }),
        ev({ eventType: 'manual-verified', createdAt: '2026-05-04T10:00:00Z' }),
      ],
      [],
    );
    expect(rec.summary.aiProposed).toBe(2);
    expect(rec.summary.developerVerified).toBe(1);
    expect(rec.summary.manualVerified).toBe(1);
    expect(rec.summary.total).toBe(4);
    expect(rec.isEmpty).toBe(false);
  });

  it('orders events most-recent-first and truncates dates to YYYY-MM-DD', () => {
    const rec = buildRemediationRecord(
      [
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-01T10:00:00Z' }),
        ev({ eventType: 'developer-verified', createdAt: '2026-05-09T10:00:00Z' }),
      ],
      [],
    );
    expect(rec.events[0].type).toBe('developer-verified');
    expect(rec.events[0].date).toBe('2026-05-09');
    expect(rec.events[1].date).toBe('2026-05-01');
  });

  it('computes first/last activity across all events', () => {
    const rec = buildRemediationRecord(
      [
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-05T10:00:00Z' }),
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-01T10:00:00Z' }),
        ev({ eventType: 'ai-proposed', createdAt: '2026-05-09T10:00:00Z' }),
      ],
      [],
    );
    expect(rec.summary.firstActivity).toBe('2026-05-01');
    expect(rec.summary.lastActivity).toBe('2026-05-09');
  });

  it('caps surfaced events at maxEvents but counts all in the summary', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      ev({ eventType: 'ai-proposed', createdAt: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z` }),
    );
    const rec = buildRemediationRecord(many, [], { maxEvents: 3 });
    expect(rec.events).toHaveLength(3);
    expect(rec.summary.total).toBe(10);
  });

  it('builds a scan trend from completed scans only, oldest-first', () => {
    const rec = buildRemediationRecord(
      [],
      [
        scan({ id: 's1', createdAt: '2026-04-01T00:00:00Z', completedAt: '2026-04-01T01:00:00Z', totalIssues: 40, errors: 30 }),
        scan({ id: 's3', status: 'running', createdAt: '2026-04-20T00:00:00Z' }),
        scan({ id: 's2', createdAt: '2026-04-10T00:00:00Z', completedAt: '2026-04-10T01:00:00Z', totalIssues: 12, errors: 8 }),
      ],
    );
    expect(rec.scanTrend).toHaveLength(2); // running scan excluded
    expect(rec.scanTrend[0].date).toBe('2026-04-01');
    expect(rec.scanTrend[0].totalIssues).toBe(40);
    expect(rec.scanTrend[1].date).toBe('2026-04-10');
    expect(rec.scanTrend[1].totalIssues).toBe(12);
    expect(rec.isEmpty).toBe(false); // 2 completed scans → trend worth showing
  });

  it('a single scan with no events is still empty (no trend to show)', () => {
    const rec = buildRemediationRecord(
      [],
      [scan({ id: 's1', createdAt: '2026-04-01T00:00:00Z', completedAt: '2026-04-01T01:00:00Z', totalIssues: 5, errors: 2 })],
    );
    expect(rec.isEmpty).toBe(true);
  });

  it('preserves criterion, detail, and actor on surfaced events', () => {
    const rec = buildRemediationRecord(
      [ev({ eventType: 'developer-verified', createdAt: '2026-05-01T10:00:00Z', criterion: '1.1.1', detail: 'Issue marked fixed', actor: 'alice' })],
      [],
    );
    expect(rec.events[0]).toMatchObject({ criterion: '1.1.1', detail: 'Issue marked fixed', actor: 'alice' });
  });
});
