import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { teamRoutes } from '../../src/routes/admin/teams.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['users.activate']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-teams-${randomUUID()}.db`);
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

  await teamRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('Team routes', () => {
  describe('GET /admin/teams', () => {
    it('returns 403 without users.activate permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/teams' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with teams template when authorized', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/teams' });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/teams.hbs');
    });

    it('lists all teams in template data', async () => {
      const ctx = await createTestServer();
      await ctx.storage.teams.createTeam({ name: 'Frontend', description: 'Frontend team', orgId: 'system' });
      await ctx.storage.teams.createTeam({ name: 'Backend', description: 'Backend team', orgId: 'system' });
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/teams' });
      ctx.cleanup();
      const body = response.json() as { data: { teams: unknown[] } };
      expect(body.data.teams).toHaveLength(2);
    });
  });

  describe('POST /admin/teams', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without users.activate permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/teams',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=NewTeam',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when team name is missing', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/teams',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'description=Test',
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates a team and redirects', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/teams',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=MyTeam&description=My+team',
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/admin/teams');
      const teams = await ctx.storage.teams.listTeams('system');
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe('MyTeam');
    });

    it('creates a team and returns HTML row for HTMX request', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/admin/teams',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'hx-request': 'true',
        },
        payload: 'name=HxTeam&description=HTMX+team',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('HxTeam');
    });
  });

  describe('GET /admin/teams/:id', () => {
    it('returns 403 without users.activate permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/teams/some-id' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent team', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'GET', url: '/admin/teams/non-existent-id' });
      ctx.cleanup();
      expect(response.statusCode).toBe(404);
    });

    it('returns 200 with team detail template', async () => {
      const ctx = await createTestServer();
      const team = await ctx.storage.teams.createTeam({ name: 'DetailTeam', description: '', orgId: 'system' });
      const response = await ctx.server.inject({ method: 'GET', url: `/admin/teams/${team.id}` });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string };
      expect(body.template).toBe('admin/team-detail.hbs');
    });
  });

  describe('POST /admin/teams/:id/members', () => {
    let ctx: TestContext;
    beforeEach(async () => { ctx = await createTestServer(); });
    afterEach(() => { ctx.cleanup(); });

    it('returns 403 without users.activate permission', async () => {
      const noPerm = await createTestServer([]);
      const response = await noPerm.server.inject({
        method: 'POST',
        url: '/admin/teams/some-id/members',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'userId=user-2',
      });
      noPerm.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 when userId is missing', async () => {
      const team = await ctx.storage.teams.createTeam({ name: 'MemberTeam', description: '', orgId: 'system' });
      const response = await ctx.server.inject({
        method: 'POST',
        url: `/admin/teams/${team.id}/members`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect(response.statusCode).toBe(400);
    });

    it('adds a member to the team and redirects', async () => {
      const team = await ctx.storage.teams.createTeam({ name: 'MemberTeam2', description: '', orgId: 'system' });
      const response = await ctx.server.inject({
        method: 'POST',
        url: `/admin/teams/${team.id}/members`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'userId=bob',
      });
      // Non-HTMX request redirects to team detail
      expect(response.statusCode).toBe(302);
    });
  });

  describe('DELETE /admin/teams/:id/members/:userId', () => {
    it('returns 403 without users.activate permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/teams/some-id/members/user-2' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('removes a member from the team', async () => {
      const ctx = await createTestServer();
      const team = await ctx.storage.teams.createTeam({ name: 'RemoveTeam', description: '', orgId: 'system' });
      await ctx.storage.teams.addTeamMember(team.id, 'bob');
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/teams/${team.id}/members/bob` });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /admin/teams/:id', () => {
    it('returns 403 without users.activate permission', async () => {
      const ctx = await createTestServer([]);
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/teams/some-id' });
      ctx.cleanup();
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent team', async () => {
      const ctx = await createTestServer();
      const response = await ctx.server.inject({ method: 'DELETE', url: '/admin/teams/non-existent-id' });
      ctx.cleanup();
      expect(response.statusCode).toBe(404);
    });

    it('deletes a team', async () => {
      const ctx = await createTestServer();
      const team = await ctx.storage.teams.createTeam({ name: 'DeleteTeam', description: '', orgId: 'system' });
      const response = await ctx.server.inject({ method: 'DELETE', url: `/admin/teams/${team.id}` });
      ctx.cleanup();
      expect(response.statusCode).toBe(200);
    });
  });
});
