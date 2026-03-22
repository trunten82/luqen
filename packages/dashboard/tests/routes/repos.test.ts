import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { repoRoutes } from '../../src/routes/repos.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['repos.manage']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-repos-${randomUUID()}.db`);
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

  await repoRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

async function makeRepo(ctx: TestContext, siteUrlPattern = 'https://example.com', repoUrl = 'https://github.com/org/repo') {
  return ctx.storage.repos.createRepo({
    id: randomUUID(),
    siteUrlPattern,
    repoUrl,
    repoPath: undefined,
    branch: 'main',
    createdBy: 'alice',
    orgId: 'system',
  });
}

describe('Repo routes', () => {
  describe('GET /admin/repos', () => {
    it('returns 403 without repos.manage permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with repos template when authorized', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('repos.hbs');
    });

    it('lists connected repos in template data', async () => {
      const ctx = await createTestServer();
      await makeRepo(ctx, 'https://site1.com', 'https://github.com/org/repo1');
      await makeRepo(ctx, 'https://site2.com', 'https://github.com/org/repo2');
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/repos' });
      ctx.cleanup();
      const body = response.json() as { data: { repos: unknown[] } };
      expect(body.data.repos).toHaveLength(2);
    });
  });

  describe('POST /admin/repos', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without repos.manage permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 422 when siteUrlPattern is invalid', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=not-a-url&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 when repoUrl is invalid', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=ftp%3A%2F%2Finvalid',
      });
      expect(response.statusCode).toBe(422);
    });

    it('connects a new repo and redirects', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'siteUrlPattern=https%3A%2F%2Fexample.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo&branch=main',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/admin/repos');
      const repos = await ctx.storage.repos.listRepos('system');
      expect(repos).toHaveLength(1);
      expect(repos[0].repoUrl).toBe('https://github.com/org/repo');
    });

    it('creates a repo and returns view for HTMX', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/repos',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        payload: 'siteUrlPattern=https%3A%2F%2Fhtmx-site.com&repoUrl=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      });
      // HTMX path calls reply.view — stubbed as JSON
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /admin/repos/:id', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without repos.manage permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({ method: 'DELETE', url: '/admin/repos/some-id' });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent repo', async () => {
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/repos/non-existent-id' });
      expect(response.statusCode).toBe(404);
    });

    it('disconnects a repo and redirects', async () => {
      const repo = await makeRepo(ctx);
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/repos/${repo.id}` });
      expect(response.statusCode).toBe(302);
      const deleted = await ctx.storage.repos.getRepo(repo.id);
      expect(deleted).toBeNull();
    });

    it('disconnects a repo and returns toast for HTMX', async () => {
      const repo = await makeRepo(ctx);
      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/admin/repos/${repo.id}`,
        headers: { 'hx-request': 'true' },
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
