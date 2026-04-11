import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { organizationRoutes } from '../../src/routes/admin/organizations.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import type { MatchAndScoreResult } from '../../src/services/branding/branding-orchestrator.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  matchSpy: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

async function createTestServer(
  role: 'admin' | 'viewer',
  stubResult: MatchAndScoreResult | Error,
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-bmode-test-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Test-only reply.view — returns JSON so we can inspect template+data.
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  // Build the spy with the stubbed behavior.
  const matchSpy = vi.fn(async () => {
    if (stubResult instanceof Error) throw stubResult;
    return stubResult;
  });

  // Decorate server.brandingOrchestrator BEFORE registering routes.
  server.decorate('brandingOrchestrator', {
    matchAndScore: matchSpy,
  });

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'test-user-id', username: 'testuser', role };
    const permissions =
      role === 'admin' ? new Set(ALL_PERMISSION_IDS) : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await organizationRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, matchSpy, cleanup };
}

describe('admin branding-test endpoint — BMODE-04 / Pitfall #5', () => {
  // ── Test 1: matched-embedded ─────────────────────────────────────────────

  describe('kind=matched, mode=embedded', () => {
    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await createTestServer('admin', {
        kind: 'matched',
        mode: 'embedded',
        brandedIssues: [],
        scoreResult: {
          kind: 'scored',
          overall: 90,
          color: { kind: 'scored', value: 90 },
          typography: { kind: 'scored', value: 85 },
          components: { kind: 'scored', value: 80 },
          coverage: { color: true, typography: true, components: true },
        } as MatchAndScoreResult extends { scoreResult: infer S } ? S : never,
        brandRelatedCount: 1,
      } as MatchAndScoreResult);
    });
    afterEach(() => { ctx.cleanup(); });

    it('routes through the production orchestrator and returns ok=true with routedVia=embedded', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Aperol Srl',
        slug: 'aperol-srl',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);

      // PITFALL #5 ENFORCEMENT: matchAndScore was called exactly once.
      expect(ctx.matchSpy).toHaveBeenCalledTimes(1);
      expect(ctx.matchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: org.id,
          issues: expect.any(Array),
          guideline: expect.objectContaining({ active: true }),
        }),
      );
      // The input must have non-empty issues and a non-null guideline
      // (proves the route constructed a real synthetic shape, not a stub).
      const call = ctx.matchSpy.mock.calls[0]![0] as {
        orgId: string;
        issues: readonly unknown[];
        guideline: { colors: readonly unknown[] } | null;
      };
      expect(call.issues.length).toBeGreaterThan(0);
      expect(call.guideline).not.toBeNull();
      expect(call.guideline!.colors.length).toBeGreaterThan(0);

      const body = res.json() as {
        template: string;
        data: {
          testResult: {
            ok: boolean;
            routedVia: string;
            details: { brandRelatedCount: number; scoreKind: string };
          };
        };
      };
      expect(body.template).toBe('admin/partials/branding-mode-toggle.hbs');
      expect(body.data.testResult.ok).toBe(true);
      expect(body.data.testResult.routedVia).toBe('embedded');
      expect(body.data.testResult.details.brandRelatedCount).toBe(1);
      expect(body.data.testResult.details.scoreKind).toBe('scored');
    });
  });

  // ── Test 2: matched-remote (proves routedVia comes from result.mode) ──

  describe('kind=matched, mode=remote', () => {
    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await createTestServer('admin', {
        kind: 'matched',
        mode: 'remote',
        brandedIssues: [],
        scoreResult: {
          kind: 'scored',
          overall: 75,
          color: { kind: 'scored', value: 80 },
          typography: { kind: 'scored', value: 70 },
          components: { kind: 'unscorable', reason: 'no-selectors' },
          coverage: { color: true, typography: true, components: false },
        } as MatchAndScoreResult extends { scoreResult: infer S } ? S : never,
        brandRelatedCount: 0,
      } as MatchAndScoreResult);
    });
    afterEach(() => { ctx.cleanup(); });

    it('returns routedVia=remote when the orchestrator says mode=remote', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Branded Bros',
        slug: 'branded-bros',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      expect(ctx.matchSpy).toHaveBeenCalledTimes(1);
      const body = res.json() as {
        data: { testResult: { routedVia: string; ok: boolean } };
      };
      expect(body.data.testResult.routedVia).toBe('remote');
      expect(body.data.testResult.ok).toBe(true);
    });
  });

  // ── Test 3: degraded ─────────────────────────────────────────────────────

  describe('kind=degraded, mode=remote, reason=remote-unavailable', () => {
    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await createTestServer('admin', {
        kind: 'degraded',
        mode: 'remote',
        reason: 'remote-unavailable',
        error: 'ECONNREFUSED 127.0.0.1:3002',
      } as MatchAndScoreResult);
    });
    afterEach(() => { ctx.cleanup(); });

    it('returns ok=false with escaped error details', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Carmine Co',
        slug: 'carmine-co',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      expect(ctx.matchSpy).toHaveBeenCalledTimes(1);

      const body = res.json() as {
        data: {
          testResult: {
            ok: boolean;
            routedVia: string;
            details: { reason: string; error: string };
          };
        };
      };
      expect(body.data.testResult.ok).toBe(false);
      expect(body.data.testResult.routedVia).toBe('remote');
      expect(body.data.testResult.details.reason).toBe('remote-unavailable');
      expect(body.data.testResult.details.error).toContain('ECONNREFUSED');
    });
  });

  // ── Test 4: no-guideline ─────────────────────────────────────────────────

  describe('kind=no-guideline', () => {
    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await createTestServer('admin', {
        kind: 'no-guideline',
        mode: 'embedded',
      } as MatchAndScoreResult);
    });
    afterEach(() => { ctx.cleanup(); });

    it('returns ok=true with explanatory note (match layer not fully exercised)', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Deco Dev',
        slug: 'deco-dev',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(200);
      expect(ctx.matchSpy).toHaveBeenCalledTimes(1);

      const body = res.json() as {
        data: {
          testResult: {
            ok: boolean;
            routedVia: string;
            details: { note?: string };
          };
        };
      };
      expect(body.data.testResult.ok).toBe(true);
      expect(body.data.testResult.routedVia).toBe('embedded');
      expect(body.data.testResult.details.note).toBeTruthy();
      expect(body.data.testResult.details.note).toMatch(/no linked guideline/i);
    });
  });

  // ── Test 5: non-admin 403, spy not invoked ──────────────────────────────

  describe('non-admin permission gate', () => {
    let ctx: TestContext;
    beforeEach(async () => {
      // stubResult value is irrelevant — the spy should never be called.
      ctx = await createTestServer('viewer', {
        kind: 'matched',
        mode: 'embedded',
        brandedIssues: [],
        scoreResult: {
          kind: 'scored', overall: 0,
          color: { kind: 'scored', value: 0 },
          typography: { kind: 'scored', value: 0 },
          components: { kind: 'scored', value: 0 },
          coverage: { color: true, typography: true, components: true },
        } as MatchAndScoreResult extends { scoreResult: infer S } ? S : never,
        brandRelatedCount: 0,
      } as MatchAndScoreResult);
    });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 and NEVER calls matchAndScore', async () => {
      const org = await ctx.storage.organizations.createOrg({
        name: 'Echo Entertainment',
        slug: 'echo-entertainment',
      });

      const res = await ctx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${encodeURIComponent(org.id)}/branding-test`,
        payload: '',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

      expect(res.statusCode).toBe(403);
      expect(ctx.matchSpy).toHaveBeenCalledTimes(0);
    });
  });
});
