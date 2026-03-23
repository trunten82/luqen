import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { monitorRoutes, isSourceStale, formatLastChecked, buildMonitorViewData } from '../../src/routes/admin/monitor.js';

vi.mock('../../src/compliance-client.js', () => ({
  listSources: vi.fn().mockResolvedValue([
    {
      id: 'src-1',
      name: 'W3C Feed',
      url: 'https://w3.org/feed',
      type: 'rss',
      schedule: 'daily',
      lastChecked: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago — fresh
    },
    {
      id: 'src-2',
      name: 'Stale Feed',
      url: 'https://example.com/feed',
      type: 'atom',
      schedule: 'weekly',
      lastChecked: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 48 hrs ago — stale
    },
    {
      id: 'src-3',
      name: 'Never Checked Feed',
      url: 'https://new.example.com/feed',
      type: 'rss',
      schedule: 'daily',
      lastChecked: undefined,
    },
  ]),
  listUpdateProposals: vi.fn().mockResolvedValue([
    {
      id: 'prop-1',
      status: 'pending',
      source: 'w3c-rss',
      type: 'requirement_change',
      summary: 'New WCAG criterion',
      detectedAt: '2024-06-01T10:00:00Z',
    },
    {
      id: 'prop-2',
      status: 'approved',
      source: 'eu-gov',
      type: 'regulation_update',
      summary: 'EN 301 549 update',
      detectedAt: '2024-05-01T08:00:00Z',
    },
  ]),
  scanSources: vi.fn().mockResolvedValue({ scanned: 3, proposalsCreated: 2 }),
}));

import * as complianceClient from '../../src/compliance-client.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const COMPLIANCE_URL = 'http://localhost:9999';

interface TestContext {
  server: FastifyInstance;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['admin.system']): Promise<TestContext> {
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'admin', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await monitorRoutes(server, COMPLIANCE_URL);
  await server.ready();

  const cleanup = (): void => { void server.close(); };
  return { server, cleanup };
}

describe('Monitor routes', () => {
  let ctx: TestContext;

  afterEach(() => { ctx.cleanup(); });

  describe('GET /admin/monitor', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 and renders monitor template', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/monitor.hbs');
    });

    it('includes sourcesCount and pendingProposalsCount in view data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      const body = response.json() as { data: { sourcesCount: number; pendingProposalsCount: number } };
      expect(body.data.sourcesCount).toBe(3);
      expect(body.data.pendingProposalsCount).toBe(1); // only prop-1 is pending
    });

    it('marks stale sources correctly', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      const body = response.json() as { data: { sources: Array<{ id: string; stale: boolean }> } };
      const src1 = body.data.sources.find((s) => s.id === 'src-1');
      const src2 = body.data.sources.find((s) => s.id === 'src-2');
      const src3 = body.data.sources.find((s) => s.id === 'src-3');
      expect(src1?.stale).toBe(false); // 30 min ago — fresh
      expect(src2?.stale).toBe(true);  // 48 hrs ago — stale
      expect(src3?.stale).toBe(true);  // never checked — stale
    });

    it('includes proposals in view data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      const body = response.json() as { data: { proposals: Array<{ id: string; detectedAtDisplay: string }> } };
      expect(body.data.proposals).toHaveLength(2);
      expect(body.data.proposals[0]).toHaveProperty('detectedAtDisplay');
    });

    it('includes lastScanTime in view data', async () => {
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      const body = response.json() as { data: { lastScanTime: string } };
      expect(typeof body.data.lastScanTime).toBe('string');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      expect(response.statusCode).toBe(403);
    });

    it('still renders when listSources throws (graceful degradation)', async () => {
      vi.mocked(complianceClient.listSources).mockRejectedValueOnce(new Error('Service down'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { sourcesCount: number; error: string } };
      expect(body.data.sourcesCount).toBe(0);
      expect(body.data.error).toBeTruthy();
    });

    it('still renders when listUpdateProposals throws (graceful degradation)', async () => {
      vi.mocked(complianceClient.listUpdateProposals).mockRejectedValueOnce(new Error('Proposals unavailable'));
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/monitor' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { pendingProposalsCount: number } };
      expect(body.data.pendingProposalsCount).toBe(0);
    });
  });

  describe('POST /admin/monitor/trigger (manual scan)', () => {
    beforeEach(async () => { ctx = await createTestServer(); });

    it('returns 200 with scan results HTML', async () => {
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/monitor/trigger' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Scan complete');
      expect(response.body).toContain('3');
      expect(response.body).toContain('2');
    });

    it('returns 403 without admin.system permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/monitor/trigger' });
      expect(response.statusCode).toBe(403);
    });

    it('returns 500 toast HTML when scan fails', async () => {
      vi.mocked(complianceClient.scanSources).mockRejectedValueOnce(new Error('Scan error'));
      const response = await ctx.server.inject({ method: 'POST', url: '/admin/monitor/trigger' });
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Scan error');
    });
  });
});

// ── Pure helper unit tests ────────────────────────────────────────────────────

describe('isSourceStale', () => {
  it('returns true when lastChecked is undefined', () => {
    expect(isSourceStale(undefined)).toBe(true);
  });

  it('returns true when lastChecked is an invalid date string', () => {
    expect(isSourceStale('not-a-date')).toBe(true);
  });

  it('returns true when lastChecked is more than 24 hours ago', () => {
    const twoDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();
    expect(isSourceStale(twoDaysAgo)).toBe(true);
  });

  it('returns false when lastChecked is within the last 24 hours', () => {
    const oneHourAgo = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    expect(isSourceStale(oneHourAgo)).toBe(false);
  });
});

describe('formatLastChecked', () => {
  it('returns "Never" when lastChecked is undefined', () => {
    expect(formatLastChecked(undefined)).toBe('Never');
  });

  it('returns "Never" for invalid date strings', () => {
    expect(formatLastChecked('not-a-date')).toBe('Never');
  });

  it('returns a formatted date string for a valid ISO date', () => {
    const result = formatLastChecked('2024-06-01T10:00:00Z');
    expect(result).not.toBe('Never');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('buildMonitorViewData', () => {
  const mockSources = [
    {
      id: 'src-1',
      name: 'Fresh Feed',
      url: 'https://example.com/feed',
      type: 'rss',
      schedule: 'daily',
      lastChecked: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 min ago
    },
    {
      id: 'src-2',
      name: 'Old Feed',
      url: 'https://old.example.com/feed',
      type: 'atom',
      schedule: 'weekly',
      lastChecked: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(), // 30 hrs ago
    },
  ];

  const mockProposals = [
    { id: 'p-1', status: 'pending', source: 'w3c', type: 'change', summary: 'A', detectedAt: '2024-06-01T10:00:00Z' },
    { id: 'p-2', status: 'pending', source: 'eu', type: 'update', summary: 'B', detectedAt: '2024-05-01T08:00:00Z' },
    { id: 'p-3', status: 'approved', source: 'eu', type: 'update', summary: 'C', detectedAt: '2024-04-01T07:00:00Z' },
  ];

  it('returns correct sourcesCount', () => {
    const result = buildMonitorViewData(mockSources, []);
    expect(result.sourcesCount).toBe(2);
  });

  it('counts only pending proposals', () => {
    const result = buildMonitorViewData([], mockProposals);
    expect(result.pendingProposalsCount).toBe(2);
  });

  it('marks stale sources', () => {
    const result = buildMonitorViewData(mockSources, []);
    const src1 = result.sources.find((s) => s.id === 'src-1');
    const src2 = result.sources.find((s) => s.id === 'src-2');
    expect(src1?.stale).toBe(false);
    expect(src2?.stale).toBe(true);
  });

  it('returns "Never" as lastScanTime when no sources have been checked', () => {
    const result = buildMonitorViewData([], []);
    expect(result.lastScanTime).toBe('Never');
  });

  it('uses the most recent lastChecked for lastScanTime', () => {
    const result = buildMonitorViewData(mockSources, []);
    expect(result.lastScanTime).not.toBe('Never');
  });

  it('maps proposals with detectedAtDisplay', () => {
    const result = buildMonitorViewData([], mockProposals);
    expect(result.proposals[0]).toHaveProperty('detectedAtDisplay');
    expect(result.proposals[0].detectedAtDisplay).not.toBe('');
  });
});
