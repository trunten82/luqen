import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { registerSession } from '../../src/auth/session.js';
import { brandOverviewRoutes } from '../../src/routes/brand-overview.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { RescoreService } from '../../src/services/rescore/rescore-service.js';
import type { RescoreProgress } from '../../src/services/rescore/rescore-types.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgress(overrides: Partial<RescoreProgress> = {}): RescoreProgress {
  return {
    id: 'progress-1',
    orgId: 'org-1',
    status: 'running',
    totalScans: 100,
    processedScans: 50,
    scoredCount: 45,
    skippedCount: 5,
    warningCount: 0,
    lastProcessedScanId: 'scan-50',
    error: null,
    createdAt: '2026-04-13T00:00:00Z',
    updatedAt: '2026-04-13T00:01:00Z',
    ...overrides,
  };
}

interface TestContext {
  server: FastifyInstance;
  storage: StorageAdapter;
  rescoreService: RescoreService;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['branding.view', 'branding.manage']): Promise<TestContext> {
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
    organizations: {
      getBrandScoreTarget: vi.fn().mockResolvedValue(null),
      setBrandScoreTarget: vi.fn().mockResolvedValue(undefined),
      listOrgs: vi.fn().mockResolvedValue([]),
    },
  } as unknown as StorageAdapter;

  const rescoreService = {
    startRescore: vi.fn(),
    processNextBatch: vi.fn().mockResolvedValue(null),
    getProgress: vi.fn().mockResolvedValue(null),
    getCandidateCount: vi.fn().mockResolvedValue(0),
  } as unknown as RescoreService;

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

  await brandOverviewRoutes(server, storage, rescoreService);
  await server.ready();

  const cleanup = (): void => {
    void server.close();
  };

  return { server, storage, rescoreService, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Brand Overview Rescore Routes', () => {
  let ctx: TestContext;

  describe('POST /brand-overview/rescore/start', () => {
    beforeEach(async () => {
      ctx = await createTestServer();
    });
    afterEach(() => ctx.cleanup());

    it('returns progress HTML when rescore starts successfully', async () => {
      (ctx.rescoreService.startRescore as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'started',
        candidateCount: 100,
      });
      (ctx.rescoreService.getProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeProgress({ totalScans: 100, processedScans: 0 }),
      );

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/brand-overview/rescore/start',
        payload: { _csrf: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('partials/rescore-progress.hbs');
      expect(body.data.totalScans).toBe(100);
      expect(body.data.currentBatch).toBe(1);
    });

    it('returns alert--info HTML when already running (D-09)', async () => {
      (ctx.rescoreService.startRescore as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'already-running',
        candidateCount: 0,
      });
      (ctx.rescoreService.getProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeProgress(),
      );

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/brand-overview/rescore/start',
        payload: { _csrf: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.body;
      expect(body).toContain('alert--info');
      expect(body).toContain('already in progress');
    });

    it('returns 403 without branding.manage permission', async () => {
      ctx.cleanup();
      ctx = await createTestServer(['branding.view']); // no branding.manage

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/brand-overview/rescore/start',
        payload: { _csrf: 'test' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns button partial with candidateCount=0 when no candidates', async () => {
      (ctx.rescoreService.startRescore as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 'no-candidates',
        candidateCount: 0,
      });

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/brand-overview/rescore/start',
        payload: { _csrf: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('partials/rescore-button.hbs');
      expect(body.data.candidateCount).toBe(0);
    });
  });

  describe('GET /brand-overview/rescore/progress', () => {
    beforeEach(async () => {
      ctx = await createTestServer();
    });
    afterEach(() => ctx.cleanup());

    it('returns progress HTML with batch counter when running', async () => {
      (ctx.rescoreService.getProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeProgress({ totalScans: 100, processedScans: 50 }),
      );

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview/rescore/progress',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('partials/rescore-progress.hbs');
      expect(body.data.processedScans).toBe(50);
      expect(body.data.totalScans).toBe(100);
      expect(body.data.totalBatches).toBe(2); // 100 / 50
    });

    it('returns complete HTML when status is completed (D-06)', async () => {
      (ctx.rescoreService.getProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeProgress({ status: 'completed', scoredCount: 90, skippedCount: 8, warningCount: 2 }),
      );

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview/rescore/progress',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('partials/rescore-complete.hbs');
      expect(body.data.scoredCount).toBe(90);
      expect(body.data.skippedCount).toBe(8);
      expect(body.data.warningCount).toBe(2);
    });

    it('returns error HTML when status is failed', async () => {
      (ctx.rescoreService.getProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeProgress({ status: 'failed', error: 'Batch processing failed' }),
      );

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview/rescore/progress',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('partials/rescore-error.hbs');
      expect(body.data.errorReason).toBe('Batch processing failed');
    });
  });

  describe('GET /brand-overview with rescore state', () => {
    afterEach(() => ctx.cleanup());

    it('shows candidateCount when canManageBranding is true', async () => {
      ctx = await createTestServer(['branding.view', 'branding.manage']);
      (ctx.rescoreService.getCandidateCount as ReturnType<typeof vi.fn>).mockResolvedValue(42);

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { candidateCount: number; canManageBranding: boolean } };
      expect(body.data.canManageBranding).toBe(true);
      expect(body.data.candidateCount).toBe(42);
    });

    it('does NOT include rescore state when canManageBranding is false', async () => {
      ctx = await createTestServer(['branding.view']); // no branding.manage

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/brand-overview',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { candidateCount: number; canManageBranding: boolean } };
      expect(body.data.canManageBranding).toBe(false);
      expect(body.data.candidateCount).toBe(0);
      // rescoreService.getCandidateCount should NOT have been called
      expect(ctx.rescoreService.getCandidateCount).not.toHaveBeenCalled();
    });
  });
});
