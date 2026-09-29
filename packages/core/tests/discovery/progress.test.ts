import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDiscoveryProgressReporter,
  DISCOVERY_PROGRESS_INTERVAL_MS,
  type DiscoveryProgress,
} from '../../src/discovery/progress.js';

describe('createDiscoveryProgressReporter (DISCOVERY-PROGRESS-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('DP1: the throttle interval is one second', () => {
    expect(DISCOVERY_PROGRESS_INTERVAL_MS).toBe(1000);
  });

  it('DP2: every phase change emits immediately, even inside the interval', () => {
    const events: DiscoveryProgress[] = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push(p));
    reporter.phase('sitemap');
    reporter.phase('crawl');
    reporter.phase('browser');
    expect(events.map((e) => e.phase)).toEqual(['sitemap', 'crawl', 'browser']);
    reporter.close();
  });

  it('DP3: found pages inside one interval collapse into at most one event, then a trailing event carries the latest count', () => {
    const events: DiscoveryProgress[] = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push(p));
    reporter.phase('crawl');
    for (let i = 0; i < 20; i++) reporter.found(`https://example.com/p${i}`);
    // Only the phase event so far — the 20 finds are held by the throttle.
    expect(events).toHaveLength(1);
    vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ phase: 'crawl', pagesFound: 20 });
    reporter.close();
  });

  it('DP4: over a 5 s crawl with a find every 100 ms, no two events in a phase are closer than the interval', () => {
    const events: Array<DiscoveryProgress & { at: number }> = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push({ ...p, at: Date.now() }));
    reporter.phase('browser');
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100);
      reporter.found(`https://example.com/p${i}`);
    }
    vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS);
    reporter.close();
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at - events[i - 1].at).toBeGreaterThanOrEqual(DISCOVERY_PROGRESS_INTERVAL_MS);
    }
    // 5 s of finds at 1 event/s plus the phase event — never one per find.
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.length).toBeLessThanOrEqual(7);
    expect(events[events.length - 1].pagesFound).toBe(50);
  });

  it('DP5: counts are distinct URLs and never decrease across phases', () => {
    const events: DiscoveryProgress[] = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push(p));
    reporter.phase('sitemap');
    reporter.foundMany(['https://example.com/a', 'https://example.com/b']);
    reporter.phase('crawl');
    reporter.found('https://example.com/a'); // duplicate — not a new page
    reporter.found('https://example.com/');
    reporter.phase('browser');
    reporter.found('https://example.com/c');
    vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS);
    reporter.close();
    const counts = events.map((e) => e.pagesFound);
    expect(counts).toEqual([...counts].sort((x, y) => x - y));
    expect(counts[counts.length - 1]).toBe(4);
  });

  it('DP6: the count is capped at maxPages so the live figure never exceeds the final one', () => {
    const events: DiscoveryProgress[] = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push(p), { maxPages: 3 });
    reporter.phase('crawl');
    for (let i = 0; i < 10; i++) reporter.found(`https://example.com/p${i}`);
    vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS);
    reporter.close();
    expect(Math.max(...events.map((e) => e.pagesFound))).toBe(3);
  });

  it('DP7: close() cancels a pending trailing event and silences later calls', () => {
    const events: DiscoveryProgress[] = [];
    const reporter = createDiscoveryProgressReporter((p) => events.push(p));
    reporter.phase('crawl');
    reporter.found('https://example.com/a');
    reporter.close();
    vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS * 3);
    reporter.phase('browser');
    reporter.found('https://example.com/b');
    expect(events).toHaveLength(1);
  });

  it('DP8: a throwing listener never breaks discovery', () => {
    const reporter = createDiscoveryProgressReporter(() => { throw new Error('listener boom'); });
    expect(() => reporter.phase('crawl')).not.toThrow();
    reporter.found('https://example.com/a');
    expect(() => vi.advanceTimersByTime(DISCOVERY_PROGRESS_INTERVAL_MS)).not.toThrow();
    reporter.close();
  });

  it('DP9: without a listener every call is a no-op', () => {
    const reporter = createDiscoveryProgressReporter(undefined);
    reporter.phase('crawl');
    reporter.found('https://example.com/a');
    reporter.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
