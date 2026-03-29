import { describe, it, expect } from 'vitest';
import {
  isSourceStale,
  formatLastChecked,
  buildMonitorViewData,
  type MonitorSource,
  type MonitorProposal,
} from '../src/routes/admin/monitor.js';

describe('admin/monitor', () => {
  // ---------------------------------------------------------------------------
  // isSourceStale
  // ---------------------------------------------------------------------------
  describe('isSourceStale', () => {
    it('returns true when lastChecked is undefined', () => {
      expect(isSourceStale(undefined)).toBe(true);
    });

    it('returns true when daily source is overdue', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      expect(isSourceStale(twoDaysAgo, 'daily')).toBe(true);
    });

    it('returns false when weekly source was checked 2 days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      expect(isSourceStale(twoDaysAgo, 'weekly')).toBe(false);
    });

    it('returns false when lastChecked is within schedule window', () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      expect(isSourceStale(oneHourAgo)).toBe(false);
    });

    it('returns false when lastChecked is exactly now', () => {
      const now = new Date().toISOString();
      expect(isSourceStale(now)).toBe(false);
    });

    it('returns true for an invalid date string', () => {
      expect(isSourceStale('not-a-date')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // formatLastChecked
  // ---------------------------------------------------------------------------
  describe('formatLastChecked', () => {
    it('returns "Never" when lastChecked is undefined', () => {
      expect(formatLastChecked(undefined)).toBe('Never');
    });

    it('returns a formatted string for a valid date', () => {
      const date = '2025-06-15T10:30:00Z';
      const result = formatLastChecked(date);
      expect(result).toContain('2025');
      expect(typeof result).toBe('string');
      expect(result).not.toBe('Never');
    });

    it('returns "Never" for an invalid date', () => {
      expect(formatLastChecked('not-a-date')).toBe('Never');
    });
  });

  // ---------------------------------------------------------------------------
  // buildMonitorViewData
  // ---------------------------------------------------------------------------
  describe('buildMonitorViewData', () => {
    const baseSources: MonitorSource[] = [
      {
        id: 's1',
        name: 'EU Official Journal',
        url: 'https://eur-lex.europa.eu/rss',
        type: 'rss',
        schedule: 'daily',
        lastCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 's2',
        name: 'UK Legislation',
        url: 'https://legislation.gov.uk/feed',
        type: 'rss',
        schedule: 'daily',
        lastCheckedAt: undefined,
      },
    ];

    const baseProposals: MonitorProposal[] = [
      {
        id: 'p1',
        status: 'pending',
        source: 'EU Official Journal',
        type: 'amendment',
        summary: 'Updated WCAG 2.2 mapping for EN 301 549',
        detectedAt: '2025-06-14T08:00:00Z',
      },
      {
        id: 'p2',
        status: 'approved',
        source: 'UK Legislation',
        type: 'amendment',
        summary: 'New accessibility regulation added',
        detectedAt: '2025-06-13T12:00:00Z',
      },
    ];

    it('returns the correct sources count', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      expect(data.sourcesCount).toBe(2);
    });

    it('returns the correct pending proposals count', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      expect(data.pendingProposalsCount).toBe(1);
    });

    it('marks stale sources correctly', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      const source1 = data.sources.find((s) => s.id === 's1');
      const source2 = data.sources.find((s) => s.id === 's2');

      expect(source1?.stale).toBe(false);
      expect(source2?.stale).toBe(true);
    });

    it('formats lastChecked as human-readable string', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      const source2 = data.sources.find((s) => s.id === 's2');
      expect(source2?.lastCheckedDisplay).toBe('Never');
    });

    it('computes lastScanTime from the most recent source check', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      expect(data.lastScanTime).not.toBe('Never');
      expect(data.lastScanTime).toContain('2');
    });

    it('returns "Never" for lastScanTime when no sources have been checked', () => {
      const uncheckedSources: MonitorSource[] = [
        { id: 's1', name: 'Test', url: 'https://example.com', type: 'rss', schedule: 'daily' },
      ];
      const data = buildMonitorViewData(uncheckedSources, []);
      expect(data.lastScanTime).toBe('Never');
    });

    it('handles empty sources and proposals gracefully', () => {
      const data = buildMonitorViewData([], []);
      expect(data.sourcesCount).toBe(0);
      expect(data.pendingProposalsCount).toBe(0);
      expect(data.sources).toEqual([]);
      expect(data.proposals).toEqual([]);
      expect(data.lastScanTime).toBe('Never');
    });

    it('includes formatted proposal dates', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      expect(data.proposals[0].detectedAtDisplay).toContain('2025');
    });

    it('preserves all proposal fields', () => {
      const data = buildMonitorViewData(baseSources, baseProposals);
      const p = data.proposals[0];
      expect(p.id).toBe('p1');
      expect(p.status).toBe('pending');
      expect(p.summary).toBe('Updated WCAG 2.2 mapping for EN 301 549');
    });
  });
});
