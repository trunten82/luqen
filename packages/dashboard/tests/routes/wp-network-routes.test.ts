/**
 * Phase 61 — wp-network route integration tests.
 *
 * Builds a minimal Fastify server with just the wp-network routes plus a
 * fake auth preHandler that injects `request.user`, so we exercise the
 * route handlers without needing the dashboard's full session/OAuth chain.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { wpNetworkApiRoutes } from '../../src/routes/api/wp-network.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      role?: string;
      currentOrgId?: string;
    };
  }
}

let storage: SqliteStorageAdapter;
let server: FastifyInstance;
let dbPath: string;

const orgA = 'org_a';
const orgB = 'org_b';

async function buildServerWithUser(user: {
  id: string;
  currentOrgId: string;
}): Promise<FastifyInstance> {
  const s = Fastify();
  s.addHook('preHandler', async (request) => {
    request.user = user;
  });
  await wpNetworkApiRoutes(s, storage);
  return s;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  if (server !== undefined) await server.close();
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// /api/v1/fleet
// ---------------------------------------------------------------------------

describe('POST + GET /api/v1/fleet', () => {
  it('registers a site and lists it back', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const reg = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://shop.example', wp_version: '7.0', plugin_version: '0.5.0' },
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json();
    expect(regBody.site_id).toMatch(/^site_/);

    const list = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    expect(list.statusCode).toBe(200);
    const sites = list.json().sites;
    expect(sites).toHaveLength(1);
    expect(sites[0].url).toBe('https://shop.example');
    expect(sites[0].wp_version).toBe('7.0');
    expect(sites[0].status).toBe('active');
  });

  it('GET /api/v1/fleet/:siteId returns the registered site', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const reg = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://detail.example', wp_version: '7.0', plugin_version: '0.6.0' },
    });
    const siteId = reg.json().site_id;

    const detail = await server.inject({ method: 'GET', url: `/api/v1/fleet/${siteId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().site).toMatchObject({
      id: siteId,
      url: 'https://detail.example',
      wp_version: '7.0',
      plugin_version: '0.6.0',
      status: 'active',
    });
  });

  it('GET /api/v1/fleet/:siteId 404s for unknown ids', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const detail = await server.inject({ method: 'GET', url: '/api/v1/fleet/site_does_not_exist' });
    expect(detail.statusCode).toBe(404);
  });

  it('GET /api/v1/fleet/:siteId 404s for sites in another org (no cross-tenant leak)', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const reg = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://leak.example' },
    });
    const siteId = reg.json().site_id;
    await server.close();

    server = await buildServerWithUser({ id: 'u2', currentOrgId: orgB });
    const detail = await server.inject({ method: 'GET', url: `/api/v1/fleet/${siteId}` });
    expect(detail.statusCode).toBe(404);
  });

  it('rejects request when no orgId on user', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: '' });
    const reg = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://shop.example' },
    });
    expect(reg.statusCode).toBe(401);
  });

  it('does not leak sites from another org', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://a.example' },
    });
    await server.close();

    server = await buildServerWithUser({ id: 'u2', currentOrgId: orgB });
    await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://b.example' },
    });
    const list = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    const sites = list.json().sites;
    expect(sites.map((s: { url: string }) => s.url)).toEqual(['https://b.example']);
  });

  it('POST is idempotent on (oauthClient, url)', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const r1 = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://shop.example', plugin_version: '0.5.0' },
    });
    const r2 = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://shop.example', plugin_version: '0.5.1' },
    });
    expect(r1.json().site_id).toBe(r2.json().site_id);
  });

  it('GET ?status=all surfaces stale rows', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://shop.example' },
    });
    await new Promise((r) => setTimeout(r, 5));
    await storage.wpSites.markStale(1);
    const active = await server.inject({ method: 'GET', url: '/api/v1/fleet?status=active' });
    expect(active.json().sites).toHaveLength(0);
    const all = await server.inject({ method: 'GET', url: '/api/v1/fleet?status=all' });
    expect(all.json().sites).toHaveLength(1);
    expect(all.json().sites[0].status).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// /api/v1/groups
// ---------------------------------------------------------------------------

describe('GET /api/v1/groups', () => {
  it("returns the org's teams", async () => {
    const team = await storage.teams.createTeam({
      name: 'EU compliance',
      description: 'EU team',
      orgId: orgA,
    });
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const res = await server.inject({ method: 'GET', url: '/api/v1/groups' });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups;
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.find((g: { id: string }) => g.id === team.id)).toBeDefined();
  });

  it('does not leak teams from another org', async () => {
    const teamA = await storage.teams.createTeam({
      name: 'Only A',
      description: '',
      orgId: orgA,
    });
    const teamB = await storage.teams.createTeam({
      name: 'Only B',
      description: '',
      orgId: orgB,
    });
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const res = await server.inject({ method: 'GET', url: '/api/v1/groups' });
    const ids = res.json().groups.map((g: { id: string }) => g.id);
    expect(ids).toContain(teamA.id);
    expect(ids).not.toContain(teamB.id);
  });
});

// ---------------------------------------------------------------------------
// /api/v1/users/link
// ---------------------------------------------------------------------------

describe('POST /api/v1/users/link', () => {
  it('linked=false when no matching dashboard user', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/users/link',
      payload: {
        site_url: 'https://shop.example',
        wp_user_id: 42,
        wp_login: 'alice',
        email: 'noone@example.test',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.linked).toBe(false);
    expect(body.dashboard_user).toBeNull();
    expect(body.groups).toEqual([]);
    expect(body.link_id).toMatch(/^wpl_/);
  });

  it('linked=true with groups when user exists + is on a team', async () => {
    const user = await storage.users.createUser(
      'alice@shop.example',
      'pw-not-checked-here',
      'user',
    );
    const team = await storage.teams.createTeam({
      name: 'EU',
      description: '',
      orgId: orgA,
    });
    await storage.teams.addTeamMember(team.id, user.id);

    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/users/link',
      payload: {
        site_url: 'https://shop.example',
        wp_user_id: 42,
        wp_login: 'alice',
        email: 'alice@shop.example',
      },
    });
    const body = res.json();
    expect(body.linked).toBe(true);
    expect(body.dashboard_user.id).toBe(user.id);
    expect(body.groups).toContain(team.id);
  });

  it('is idempotent on (site_url, wp_user_id)', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/users/link',
      payload: {
        site_url: 'https://shop.example',
        wp_user_id: 42,
        wp_login: 'alice',
        email: 'alice@shop.example',
      },
    });
    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/users/link',
      payload: {
        site_url: 'https://shop.example',
        wp_user_id: 42,
        wp_login: 'alice-renamed',
        email: 'alice@shop.example',
      },
    });
    expect(first.json().link_id).toBe(second.json().link_id);
  });

  it('rejects payload missing required fields', async () => {
    server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/users/link',
      payload: { site_url: 'https://shop.example' },
    });
    expect(res.statusCode).toBe(400);
  });
});
