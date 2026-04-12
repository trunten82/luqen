import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { brandOverviewRoutes } from '../../src/routes/brand-overview.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScoreResult } from '../../src/services/scoring/types.js';
import type { BrandScoreHistoryEntry } from '../../src/db/interfaces/brand-score-repository.js';
import { computeOrgSummary, type SiteEntry } from '../../src/routes/brand-overview.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScoredResult(overall: number): ScoreResult {
  return {
    kind: 'scored' as const,
    overall,
    color: { kind: 'scored' as const, value: 80, detail: { dimension: 'color' as const, contrastPairs: 3, totalPairs: 4, avgRatio: 5.2 } },
    typography: { kind: 'scored' as const, value: 70, detail: { dimension: 'typography' as const, familyOk: true, sizeOk: true, lineHeightOk: false } },
    components: { kind: 'scored' as const, value: 90, detail: { dimension: 'components' as const, matched: 9, total: 10 } },
    coverage: { color: true, typography: true, components: true },
  };
}

function makeHistoryEntry(overall: number, computedAt: string): BrandScoreHistoryEntry {
  return { computedAt, result: makeScoredResult(overall) };
}

interface TestContext {
  server: FastifyInstance;
  storage: StorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['branding.view']): Promise<TestContext> {
  const storage = {
    scans: {
      getLatestPerSite: vi.fn().mockResolvedValue([]),
    },
    brandScores: {
      getHistoryForSite: vi.fn().mockResolvedValue([]),
    },
    branding: {
      getGuidelineForSite: vi.fn().mockResolvedValue(null),
    },
  } as unknown as StorageAdapter;

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
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'org-1' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await brandOverviewRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void server.close();
  };

  return { server, storage, cleanup };
}

// ---------------------------------------------------------------------------
// Unit tests: computeOrgSummary
// ---------------------------------------------------------------------------

describe('computeOrgSummary', () => {
  it('computes average score rounded to nearest integer', () => {
    const sites: SiteEntry[] = [
      { score: 80, delta: 5 } as SiteEntry,
      { score: 60, delta: -3 } as SiteEntry,
      { score: 90, delta: 0 } as SiteEntry,
    ];
    const summary = computeOrgSummary(sites);
    // (80 + 60 + 90) / 3 = 76.666 => 77
    expect(summary.avgScore).toBe(77);
  });

  it('counts improving, regressing, and stable sites', () => {
    const sites: SiteEntry[] = [
      { score: 80, delta: 5 } as SiteEntry,    // improving (delta > 0)
      { score: 60, delta: -3 } as SiteEntry,   // regressing (delta < 0)
      { score: 90, delta: 0 } as SiteEntry,    // stable (delta === 0)
    ];
    const summary = computeOrgSummary(sites);
    expect(summary.improving).toBe(1);
    expect(summary.regressing).toBe(1);
    expect(summary.stable).toBe(1);
    expect(summary.totalScored).toBe(3);
  });

  it('counts null delta as stable', () => {
    const sites: SiteEntry[] = [
      { score: 75, delta: null } as SiteEntry,  // first-ever score, no delta
    ];
    const summary = computeOrgSummary(sites);
    expect(summary.improving).toBe(0);
    expect(summary.regressing).toBe(0);
    expect(summary.stable).toBe(1);
  });

  it('returns null avgScore when no scored sites', () => {
    const summary = computeOrgSummary([]);
    expect(summary.avgScore).toBeNull();
    expect(summary.totalScored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

describe('Brand Overview Routes', () => {
  let ctx: TestContext;

  describe('Permission gate', () => {
    beforeEach(async () => {
      ctx = await createTestServer([]);  // no permissions
    });
    afterEach(() => ctx.cleanup());

    it('returns 403 without branding.view permission', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('With branding.view permission', () => {
    beforeEach(async () => {
      ctx = await createTestServer(['branding.view']);
    });
    afterEach(() => ctx.cleanup());

    it('returns 200 with brand-overview.hbs template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('brand-overview.hbs');
    });

    it('returns empty state when org has no branded sites', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { hasSites: boolean; sites: unknown[] } };
      expect(body.data.hasSites).toBe(false);
      expect(body.data.sites).toEqual([]);
    });

    it('returns site data when org has branded scans', async () => {
      // Mock: one site with brand score history
      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'scan-1', siteUrl: 'https://example.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 5, totalIssues: 20 },
      ]);
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeHistoryEntry(85, '2026-04-10T10:00:00Z'),
        makeHistoryEntry(80, '2026-04-09T10:00:00Z'),
      ]);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { hasSites: boolean; sites: Array<{ siteUrl: string; score: number }>; activeSite: { siteUrl: string } } };
      expect(body.data.hasSites).toBe(true);
      expect(body.data.sites).toHaveLength(1);
      expect(body.data.sites[0].siteUrl).toBe('https://example.com');
      expect(body.data.sites[0].score).toBe(85);
      expect(body.data.activeSite.siteUrl).toBe('https://example.com');
    });

    it('selects site from query param when ?site= provided', async () => {
      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'scan-1', siteUrl: 'https://alpha.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 2, totalIssues: 10 },
        { id: 'scan-2', siteUrl: 'https://beta.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 3, totalIssues: 15 },
      ]);
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeHistoryEntry(70, '2026-04-10T10:00:00Z')])
        .mockResolvedValueOnce([makeHistoryEntry(90, '2026-04-10T10:00:00Z')]);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview?site=https://beta.com',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { selectedSite: string } };
      expect(body.data.selectedSite).toBe('https://beta.com');
    });

    it('falls back to first site when ?site= param does not match', async () => {
      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'scan-1', siteUrl: 'https://alpha.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 2, totalIssues: 10 },
      ]);
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>)
        .mockResolvedValue([makeHistoryEntry(70, '2026-04-10T10:00:00Z')]);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview?site=https://unknown.com',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { selectedSite: string } };
      expect(body.data.selectedSite).toBe('https://alpha.com');
    });

    it('computes org summary with correct average, improving, regressing', async () => {
      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 's1', siteUrl: 'https://a.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 1, totalIssues: 5 },
        { id: 's2', siteUrl: 'https://b.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 2, totalIssues: 8 },
        { id: 's3', siteUrl: 'https://c.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 0, totalIssues: 3 },
      ]);
      // Site a: scores [80, 75] => delta = +5, improving
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeHistoryEntry(80, '2026-04-10'), makeHistoryEntry(75, '2026-04-09')])
        .mockResolvedValueOnce([makeHistoryEntry(60, '2026-04-10'), makeHistoryEntry(63, '2026-04-09')])
        .mockResolvedValueOnce([makeHistoryEntry(90, '2026-04-10'), makeHistoryEntry(90, '2026-04-09')]);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { summary: { avgScore: number; improving: number; regressing: number; stable: number; totalScored: number } } };
      // avg = round((80 + 60 + 90) / 3) = 77
      expect(body.data.summary.avgScore).toBe(77);
      expect(body.data.summary.improving).toBe(1);   // site a: +5
      expect(body.data.summary.regressing).toBe(1);  // site b: -3
      expect(body.data.summary.stable).toBe(1);       // site c: 0
      expect(body.data.summary.totalScored).toBe(3);
    });

    it('populates dimensionSparklines on activeSite with gap handling', async () => {
      // 4 history entries: entry 1 & 3 have all dimensions scored,
      // entry 0 & 2 have typography unscorable
      const makeEntry = (overall: number, computedAt: string, typoUnscorable: boolean): BrandScoreHistoryEntry => ({
        computedAt,
        result: {
          kind: 'scored' as const,
          overall,
          color: { kind: 'scored' as const, value: 80, detail: { dimension: 'color' as const, passes: 3, fails: 1 } },
          typography: typoUnscorable
            ? { kind: 'unscorable' as const, reason: 'no-typography-data' as const }
            : { kind: 'scored' as const, value: 70, detail: { dimension: 'typography' as const, fontOk: true, sizeOk: true, lineHeightOk: false } },
          components: { kind: 'scored' as const, value: 90, detail: { dimension: 'components' as const, matched: 9, total: 10 } },
          coverage: { color: true, typography: !typoUnscorable, components: true, contributingWeight: typoUnscorable ? 0.67 : 1 },
        },
      });

      // History returned newest-first; route reverses to chronological
      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'scan-1', siteUrl: 'https://example.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 5, totalIssues: 20 },
      ]);
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEntry(85, '2026-04-10', true),   // newest — typo unscorable
        makeEntry(82, '2026-04-09', false),   // typo scored
        makeEntry(78, '2026-04-08', true),    // typo unscorable
        makeEntry(75, '2026-04-07', false),   // oldest — typo scored
      ]);

      const response = await ctx.server.inject({ method: 'GET', url: '/brand-overview' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { activeSite: { dimensionSparklines: { color: { points: string; hasData: boolean }; typography: { points: string; hasData: boolean }; components: { points: string; hasData: boolean } } } } };
      const ds = body.data.activeSite.dimensionSparklines;

      // Color and components: all 4 entries scored => 4 points
      expect(ds.color.hasData).toBe(true);
      expect(ds.color.points.split(' ')).toHaveLength(4);
      expect(ds.components.hasData).toBe(true);
      expect(ds.components.points.split(' ')).toHaveLength(4);

      // Typography: 2 of 4 scored (indices 1 and 3 in chronological order) => 2 points
      expect(ds.typography.hasData).toBe(true);
      expect(ds.typography.points.split(' ')).toHaveLength(2);
    });

    it('sets hasData=false for dimension with only 1 scored entry', async () => {
      const makeEntry = (overall: number, computedAt: string, colorScored: boolean): BrandScoreHistoryEntry => ({
        computedAt,
        result: {
          kind: 'scored' as const,
          overall,
          color: colorScored
            ? { kind: 'scored' as const, value: 80, detail: { dimension: 'color' as const, passes: 3, fails: 1 } }
            : { kind: 'unscorable' as const, reason: 'no-branded-issues' as const },
          typography: { kind: 'scored' as const, value: 70, detail: { dimension: 'typography' as const, fontOk: true, sizeOk: true, lineHeightOk: false } },
          components: { kind: 'scored' as const, value: 90, detail: { dimension: 'components' as const, matched: 9, total: 10 } },
          coverage: { color: colorScored, typography: true, components: true, contributingWeight: colorScored ? 1 : 0.67 },
        },
      });

      (ctx.storage.scans.getLatestPerSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'scan-1', siteUrl: 'https://example.com', status: 'completed', orgId: 'org-1', brandRelatedCount: 5, totalIssues: 20 },
      ]);
      // 3 entries, only 1 has color scored
      (ctx.storage.brandScores.getHistoryForSite as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEntry(85, '2026-04-10', false),
        makeEntry(82, '2026-04-09', true),  // only scored color entry
        makeEntry(78, '2026-04-08', false),
      ]);

      const response = await ctx.server.inject({ method: 'GET', url: '/brand-overview' });
      const body = response.json() as { data: { activeSite: { dimensionSparklines: { color: { points: string; hasData: boolean }; typography: { points: string; hasData: boolean }; components: { points: string; hasData: boolean } } } } };
      const ds = body.data.activeSite.dimensionSparklines;

      // Color: only 1 scored entry => hasData=false, empty points
      expect(ds.color.hasData).toBe(false);
      expect(ds.color.points).toBe('');

      // Typography & components: all 3 scored => hasData=true
      expect(ds.typography.hasData).toBe(true);
      expect(ds.components.hasData).toBe(true);
    });

    it('HTMX partial: does NOT return JSON when hx-request present (view stub always returns JSON though)', async () => {
      // NOTE: In the real app, server.ts handles HTMX partial rendering by
      // compiling templates without layout. In tests, reply.view is a JSON stub
      // so we can't test the actual HTML output. Instead, verify the route
      // processes the request successfully with the hx-request header.
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
        headers: { 'hx-request': 'true' },
      });
      // Route should still respond 200 (auth passes, data is computed)
      expect(response.statusCode).toBe(200);
    });
  });
});
