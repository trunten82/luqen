import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { auditRoutes } from '../../src/routes/admin/audit.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['audit.view']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-audit-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

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
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await auditRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('Audit routes', () => {
  describe('GET /admin/audit-log', () => {
    it('returns 403 without audit.view permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with audit-log template when authorized', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/audit-log.hbs');
    });

    it('renders log with entries', async () => {
      const ctx = await createTestServer();
      await ctx.storage.audit.log({ actor: 'alice', action: 'scan.create', resourceType: 'scan', resourceId: 'scan-1', orgId: 'system' });
      await ctx.storage.audit.log({ actor: 'bob', action: 'report.delete', resourceType: 'report', resourceId: 'report-1', orgId: 'system' });
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log' });
      ctx.cleanup();
      const body = response.json() as { data: { entries: unknown[]; total: number } };
      expect(body.data.entries).toHaveLength(2);
      expect(body.data.total).toBe(2);
    });

    it('includes pagination data in template', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log?limit=10&offset=0' });
      ctx.cleanup();
      const body = response.json() as { data: { limit: number; offset: number; hasMore: boolean } };
      expect(body.data.limit).toBe(10);
      expect(body.data.offset).toBe(0);
      expect(body.data.hasMore).toBe(false);
    });

    it('uses default limit of 50', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log' });
      ctx.cleanup();
      const body = response.json() as { data: { limit: number } };
      expect(body.data.limit).toBe(50);
    });

    it('filters by actor query param', async () => {
      const ctx = await createTestServer();
      await ctx.storage.audit.log({ actor: 'alice', action: 'scan.create', resourceType: 'scan', resourceId: 'scan-1', orgId: 'system' });
      await ctx.storage.audit.log({ actor: 'bob', action: 'scan.create', resourceType: 'scan', resourceId: 'scan-2', orgId: 'system' });
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/audit-log?actor=alice' });
      ctx.cleanup();
      const body = response.json() as { data: { entries: Array<{ actor: string }>; filters: { actor: string } } };
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.entries[0].actor).toBe('alice');
      expect(body.data.filters.actor).toBe('alice');
    });
  });
});
