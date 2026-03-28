import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { gitCredentialRoutes } from '../../src/routes/git-credentials.js';
import type { DashboardConfig } from '../../src/config.js';

// Mock the git-hosts registry so we control validation behavior
vi.mock('../../src/git-hosts/registry.js', () => ({
  getGitHostPlugin: vi.fn(),
}));

import { getGitHostPlugin } from '../../src/git-hosts/registry.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

const fakeConfig = {
  sessionSecret: TEST_SESSION_SECRET,
} as DashboardConfig;

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(permissions: string[] = ['repos.credentials']): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-git-creds-${randomUUID()}.db`);
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
    request.user = { id: 'user-1', username: 'alice', role: 'developer', currentOrgId: 'org-1' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await gitCredentialRoutes(server, storage, fakeConfig);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

// Helper: create a git host config in the DB
async function createHostConfig(storage: SqliteStorageAdapter, overrides: Record<string, string> = {}) {
  return storage.gitHosts.createConfig({
    orgId: overrides.orgId ?? 'org-1',
    pluginType: overrides.pluginType ?? 'github',
    hostUrl: overrides.hostUrl ?? 'https://github.com',
    displayName: overrides.displayName ?? 'GitHub',
  });
}

describe('Git credential routes', () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx?.cleanup();
    vi.restoreAllMocks();
  });

  // ── GET /account/git-credentials ──────────────────────────────────────

  describe('GET /account/git-credentials', () => {
    it('returns 200 with credentials page', async () => {
      ctx = await createTestServer();
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/account/git-credentials',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { template: string; data: Record<string, unknown> };
      expect(body.template).toBe('account/git-credentials.hbs');
      expect(body.data).toHaveProperty('credentials');
      expect(body.data).toHaveProperty('availableHosts');
      expect(body.data.pageTitle).toBe('Git Credentials');
    });

    it('returns 403 without repos.credentials permission', async () => {
      ctx = await createTestServer([]);
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/account/git-credentials',
      });

      expect(response.statusCode).toBe(403);
    });

    it('lists stored credentials and available hosts', async () => {
      ctx = await createTestServer();
      const config1 = await createHostConfig(ctx.storage);
      const config2 = await createHostConfig(ctx.storage, {
        pluginType: 'gitlab',
        hostUrl: 'https://gitlab.com',
        displayName: 'GitLab',
      });

      // Store a credential for config1
      await ctx.storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config1.id,
        encryptedToken: 'encrypted-abc',
        tokenHint: '••••abcd',
        validatedUsername: 'alice-gh',
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/account/git-credentials',
      });

      const body = response.json() as {
        data: {
          credentials: Array<{ gitHostConfigId: string; hostDisplayName: string }>;
          availableHosts: Array<{ id: string }>;
        };
      };

      expect(body.data.credentials).toHaveLength(1);
      expect(body.data.credentials[0].gitHostConfigId).toBe(config1.id);
      expect(body.data.credentials[0].hostDisplayName).toBe('GitHub');

      // config2 should be available (no credential stored)
      expect(body.data.availableHosts).toHaveLength(1);
      expect(body.data.availableHosts[0].id).toBe(config2.id);
    });
  });

  // ── POST /account/git-credentials ─────────────────────────────────────

  describe('POST /account/git-credentials', () => {
    it('validates token and stores encrypted credential', async () => {
      ctx = await createTestServer();
      const config = await createHostConfig(ctx.storage);

      const mockPlugin = {
        type: 'github',
        displayName: 'GitHub',
        validateToken: vi.fn().mockResolvedValue({ valid: true, username: 'alice-gh' }),
        readFile: vi.fn(),
        listFiles: vi.fn(),
        createPullRequest: vi.fn(),
      };
      vi.mocked(getGitHostPlugin).mockReturnValue(mockPlugin);

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/git-credentials',
        payload: {
          gitHostConfigId: config.id,
          token: 'ghp_testtoken1234',
        },
      });

      // Should redirect on non-HTMX request
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/account/git-credentials');

      // Verify token was validated with correct args
      expect(mockPlugin.validateToken).toHaveBeenCalledWith('https://github.com', 'ghp_testtoken1234');

      // Verify credential was stored
      const creds = await ctx.storage.gitHosts.listCredentials('user-1');
      expect(creds).toHaveLength(1);
      expect(creds[0].validatedUsername).toBe('alice-gh');
      expect(creds[0].tokenHint).toBe('••••1234');
    });

    it('returns error for invalid token', async () => {
      ctx = await createTestServer();
      const config = await createHostConfig(ctx.storage);

      const mockPlugin = {
        type: 'github',
        displayName: 'GitHub',
        validateToken: vi.fn().mockResolvedValue({ valid: false, error: 'Bad credentials' }),
        readFile: vi.fn(),
        listFiles: vi.fn(),
        createPullRequest: vi.fn(),
      };
      vi.mocked(getGitHostPlugin).mockReturnValue(mockPlugin);

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/git-credentials',
        payload: {
          gitHostConfigId: config.id,
          token: 'ghp_badtoken',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.body).toContain('Bad credentials');

      // Verify no credential was stored
      const creds = await ctx.storage.gitHosts.listCredentials('user-1');
      expect(creds).toHaveLength(0);
    });

    it('returns 422 when fields are missing', async () => {
      ctx = await createTestServer();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/git-credentials',
        payload: {
          gitHostConfigId: '',
          token: '',
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.body).toContain('required');
    });

    it('returns 404 when git host config does not exist', async () => {
      ctx = await createTestServer();

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/git-credentials',
        payload: {
          gitHostConfigId: 'nonexistent-id',
          token: 'ghp_sometoken1234',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 without repos.credentials permission', async () => {
      ctx = await createTestServer([]);

      const response = await ctx.server.inject({
        method: 'POST',
        url: '/account/git-credentials',
        payload: {
          gitHostConfigId: 'any',
          token: 'any',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ── DELETE /account/git-credentials/:id ───────────────────────────────

  describe('DELETE /account/git-credentials/:id', () => {
    it('removes credential', async () => {
      ctx = await createTestServer();
      const config = await createHostConfig(ctx.storage);

      const cred = await ctx.storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-xyz',
        tokenHint: '••••wxyz',
        validatedUsername: 'alice-gh',
      });

      const response = await ctx.server.inject({
        method: 'DELETE',
        url: `/account/git-credentials/${cred.id}`,
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Credential removed');

      // Verify deletion
      const remaining = await ctx.storage.gitHosts.listCredentials('user-1');
      expect(remaining).toHaveLength(0);
    });

    it('returns 403 without repos.credentials permission', async () => {
      ctx = await createTestServer([]);

      const response = await ctx.server.inject({
        method: 'DELETE',
        url: '/account/git-credentials/some-id',
        headers: { 'hx-request': 'true' },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
