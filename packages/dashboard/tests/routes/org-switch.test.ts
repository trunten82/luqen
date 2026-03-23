import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { orgRoutes } from '../../src/routes/orgs.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(userId = 'test-user-id'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-org-switch-${randomUUID()}.db`);

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  // Stub reply.view
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  // Inject user into all requests
  server.addHook('preHandler', async (request) => {
    request.user = { id: userId, username: 'testuser', role: 'user' };
  });

  await orgRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('POST /orgs/switch', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('sets session org context when user belongs to org', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await ctx.storage.organizations.addMember(org.id, 'test-user-id', 'member');

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: `orgId=${org.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/');

    // The session cookie should be set
    const cookies = response.cookies;
    expect(cookies.length).toBeGreaterThan(0);
  });

  it('clears org context when orgId is "system"', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: 'orgId=system',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/');
  });

  it('clears org context when orgId is empty', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: 'orgId=',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/');
  });

  it('rejects switch to org user does not belong to', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'OtherOrg', slug: 'other-org' });
    // Do NOT add user as member

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: `orgId=${org.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects switch to non-existent org', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: `orgId=${randomUUID()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('redirects to referer when available', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await ctx.storage.organizations.addMember(org.id, 'test-user-id', 'member');

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: `orgId=${org.id}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: '/home',
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/home');
  });

  it('persists org context across requests via session', async () => {
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await ctx.storage.organizations.addMember(org.id, 'test-user-id', 'member');

    // Switch to org
    const switchResponse = await ctx.server.inject({
      method: 'POST',
      url: '/orgs/switch',
      payload: `orgId=${org.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    // Extract session cookie
    const sessionCookie = switchResponse.cookies.find(
      (c) => c.name === 'session',
    );
    expect(sessionCookie).toBeDefined();

    // GET /orgs/current with session cookie to verify persistence
    const currentResponse = await ctx.server.inject({
      method: 'GET',
      url: '/orgs/current',
      cookies: { session: sessionCookie!.value },
    });

    expect(currentResponse.statusCode).toBe(200);
    const body = currentResponse.json() as { currentOrgId: string; currentOrg: { id: string; name: string } };
    expect(body.currentOrgId).toBe(org.id);
    expect(body.currentOrg.name).toBe('Acme');
  });
});
