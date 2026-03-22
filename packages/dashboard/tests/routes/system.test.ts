import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { registerSession } from '../../src/auth/session.js';
import { systemRoutes } from '../../src/routes/admin/system.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

// Mock external compliance client calls so tests don't hit the network
vi.mock('../../src/compliance-client.js', () => ({
  safeGetSystemHealth: vi.fn().mockResolvedValue({
    compliance: { status: 'ok' },
    pa11y: { status: 'ok' },
  }),
  getSeedStatus: vi.fn().mockResolvedValue({
    seeded: true,
    jurisdictions: 5,
    regulations: 10,
    requirements: 50,
  }),
}));

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  dbPath: string;
  cleanup: () => void;
}

async function createTestServer(role: string = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-system-${randomUUID()}.db`);

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
    request.user = { id: 'test-user-id', username: 'testadmin', role };
    const permissions = role === 'admin'
      ? new Set(ALL_PERMISSION_IDS)
      : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await systemRoutes(server, {
    complianceUrl: 'http://localhost:9999',
    webserviceUrl: 'http://localhost:9998',
    dbPath,
  });
  await server.ready();

  const cleanup = (): void => {
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, dbPath, cleanup };
}

// ── GET /admin/system ─────────────────────────────────────────────────────────

describe('GET /admin/system', () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestServer(); });
  afterEach(() => { ctx.cleanup(); });

  it('returns 200 with system template', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { template: string };
    expect(body.template).toBe('admin/system.hbs');
  });

  it('includes services info in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    const body = response.json() as {
      data: {
        services: {
          dashboard: { status: string; label: string };
          compliance: { status: string; label: string };
          pa11y: { status: string; label: string };
        };
      };
    };
    expect(body.data.services.dashboard.status).toBe('ok');
    expect(body.data.services.compliance).toBeDefined();
    expect(body.data.services.pa11y).toBeDefined();
  });

  it('includes db info in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    const body = response.json() as { data: { db: { sizeKb: string; path: string } } };
    expect(body.data.db.path).toBe(ctx.dbPath);
    expect(typeof body.data.db.sizeKb).toBe('string');
  });

  it('includes version and nodeVersion in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    const body = response.json() as {
      data: { version: string; nodeVersion: string; uptime: string };
    };
    expect(typeof body.data.version).toBe('string');
    expect(body.data.nodeVersion).toMatch(/^v\d+/);
    expect(typeof body.data.uptime).toBe('string');
  });

  it('includes seed status in template data', async () => {
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    const body = response.json() as {
      data: { seed: { seeded: boolean; jurisdictions: number } };
    };
    expect(body.data.seed).toBeDefined();
    expect(typeof body.data.seed.seeded).toBe('boolean');
  });
});

// ── Access control ────────────────────────────────────────────────────────────

describe('System admin access control', () => {
  it('non-admin (viewer role) gets 403 on GET /admin/system', async () => {
    const ctx = await createTestServer('viewer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (user role) gets 403 on GET /admin/system', async () => {
    const ctx = await createTestServer('user');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });

  it('non-admin (developer role) gets 403 on GET /admin/system', async () => {
    const ctx = await createTestServer('developer');
    const response = await ctx.server.inject({ method: 'GET', url: '/admin/system' });
    expect(response.statusCode).toBe(403);
    ctx.cleanup();
  });
});
