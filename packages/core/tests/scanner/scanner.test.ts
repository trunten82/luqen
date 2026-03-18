import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanUrls } from '../../src/scanner/scanner.js';
import { WebserviceClient } from '../../src/scanner/webservice-client.js';
import type { DiscoveredUrl, ScanProgress } from '../../src/types.js';

vi.mock('../../src/scanner/webservice-client.js');

function makeUrls(count: number): DiscoveredUrl[] {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/page-${i}`, discoveryMethod: 'sitemap' as const }));
}

describe('scanUrls', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
      runTask: vi.fn().mockResolvedValue(undefined),
      getResults: vi.fn().mockResolvedValue([{
        date: '2026-03-18',
        issues: [{ code: 'WCAG2AA.H37', type: 'error', message: 'Image missing alt', selector: 'img', context: '<img src="photo.jpg">' }],
      }]),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('scans a single URL through the full lifecycle', async () => {
    const results = await scanUrls(makeUrls(1), mockClient as WebserviceClient, {
      standard: 'WCAG2AA', concurrency: 5, timeout: 30000, pollTimeout: 60000, ignore: [], hideElements: '', headers: {}, wait: 0,
    });
    expect(mockClient.createTask).toHaveBeenCalledTimes(1);
    expect(mockClient.runTask).toHaveBeenCalledTimes(1);
    expect(mockClient.getResults).toHaveBeenCalled();
    expect(mockClient.deleteTask).toHaveBeenCalledTimes(1);
    expect(results.pages).toHaveLength(1);
    expect(results.pages[0].issueCount).toBe(1);
    expect(results.pages[0].issues[0].fixSuggestion).toContain('WCAG');
    expect(results.errors).toHaveLength(0);
  });

  it('emits progress events', async () => {
    const events: ScanProgress[] = [];
    await scanUrls(makeUrls(2), mockClient as WebserviceClient, {
      standard: 'WCAG2AA', concurrency: 5, timeout: 30000, pollTimeout: 60000, ignore: [], hideElements: '', headers: {}, wait: 0,
      onProgress: (event) => events.push(event),
    });
    expect(events.filter((e) => e.type === 'scan:start').length).toBe(2);
    expect(events.filter((e) => e.type === 'scan:complete').length).toBe(2);
  });

  it('records scan error on timeout with retry', async () => {
    mockClient.getResults.mockResolvedValue([]); // Never completes
    const results = await scanUrls(makeUrls(1), mockClient as WebserviceClient, {
      standard: 'WCAG2AA', concurrency: 5, timeout: 30000, pollTimeout: 100, ignore: [], hideElements: '', headers: {}, wait: 0,
    });
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].code).toBe('TIMEOUT');
    expect(results.errors[0].retried).toBe(true);
    expect(mockClient.deleteTask).toHaveBeenCalled();
  });
});
