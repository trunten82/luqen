/**
 * Phase 64.1 — admin badge oversight route tests.
 *
 * Light-weight: build a minimal Fastify with the admin badge route + fake
 * preHandler that injects request.user + request.permissions. Verifies
 * org scoping (admin.system sees all, admin.org sees own only) and
 * revoke endpoints flip the right flags.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { resolve, join } from 'node:path';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { adminBadgeRoutes } from '../../src/routes/admin/badges.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let server: FastifyInstance;

async function buildServer(perms: string[], orgId: string) {
  const s = Fastify();
  await s.register(fastifyView, {
    engine: { handlebars: Handlebars },
    root: resolve(join(__dirname, '..', '..', 'src', 'views')),
    layout: false,
  });
  // Stub helpers used by the partial / view system that might fire on the
  // page render. The admin badges view doesn't reference them, but if
  // future polish adds {{t}} they need a no-op.
  Handlebars.registerHelper('t', (k: string) => k);
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper('startsWith', (s: unknown, p: string) =>
    typeof s === 'string' && s.startsWith(p),
  );
  s.addHook('preHandler', async (request) => {
    request.user = { id: 'u-tester', role: 'admin', currentOrgId: orgId } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(perms);
  });
  await adminBadgeRoutes(s, storage);
  return s;
}

async function seedScan(id: string, orgId: string, siteUrl: string) {
  await storage.scans.createScan({
    id, siteUrl, standard: 'WCAG22AA', jurisdictions: [],
    createdBy: 'u1', orgId, createdAt: '2025-12-01T00:00:00Z',
  });
  await storage.scans.updateScan(id, {
    status: 'completed', completedAt: '2026-01-01T00:00:00Z',
  });
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

describe('GET /admin/badges', () => {
  it('admin.org sees only own-org badges', async () => {
    await seedScan('s1', 'org_a', 'https://a.example');
    await seedScan('s2', 'org_b', 'https://b.example');
    await storage.scans.setPublicShare('s1', 'org_a', true, 'u-test');
    await storage.scans.setPublicShare('s2', 'org_b', true, 'u-test');
    await storage.siteBadges.enable('org_a', 'https://a.example', 'u-test');
    await storage.siteBadges.enable('org_b', 'https://b.example', 'u-test');

    server = await buildServer(['admin.org'], 'org_a');
    const r = await server.inject({ method: 'GET', url: '/admin/badges' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('https://a.example');
    expect(r.body).not.toContain('https://b.example');
  });

  it('admin.system sees every org', async () => {
    await seedScan('s1', 'org_a', 'https://a.example');
    await seedScan('s2', 'org_b', 'https://b.example');
    await storage.scans.setPublicShare('s1', 'org_a', true, 'u-test');
    await storage.scans.setPublicShare('s2', 'org_b', true, 'u-test');

    server = await buildServer(['admin.system'], 'org_a');
    const r = await server.inject({ method: 'GET', url: '/admin/badges' });
    expect(r.body).toContain('https://a.example');
    expect(r.body).toContain('https://b.example');
  });
});

describe('POST /admin/badges/static/:scanId/revoke', () => {
  it('admin.org cannot revoke another org\'s badge', async () => {
    await seedScan('s1', 'org_b', 'https://b.example');
    await storage.scans.setPublicShare('s1', 'org_b', true, 'u-test');
    server = await buildServer(['admin.org'], 'org_a');
    const r = await server.inject({ method: 'POST', url: '/admin/badges/static/s1/revoke' });
    expect(r.statusCode).toBe(403);
    const fresh = await storage.scans.getScan('s1');
    expect(fresh?.publicShareEnabled).toBe(true); // unchanged
  });

  it('admin.system revoke flips publicShareEnabled off', async () => {
    await seedScan('s1', 'org_a', 'https://a.example');
    await storage.scans.setPublicShare('s1', 'org_a', true, 'u-test');
    server = await buildServer(['admin.system'], 'org_a');
    const r = await server.inject({ method: 'POST', url: '/admin/badges/static/s1/revoke' });
    expect([302, 303]).toContain(r.statusCode);
    const fresh = await storage.scans.getScan('s1');
    expect(fresh?.publicShareEnabled).toBe(false);
  });
});

describe('POST /admin/badges/live/:badgeId/revoke', () => {
  it('admin.system revoke disables the badge', async () => {
    const b = await storage.siteBadges.enable('org_a', 'https://x.example', 'u-test');
    server = await buildServer(['admin.system'], 'org_a');
    const r = await server.inject({ method: 'POST', url: `/admin/badges/live/${b.id}/revoke` });
    expect([302, 303]).toContain(r.statusCode);
    const fresh = await storage.siteBadges.get(b.id);
    expect(fresh?.enabled).toBe(false);
  });

  it('returns 404 for unknown badge id', async () => {
    server = await buildServer(['admin.system'], 'org_a');
    const r = await server.inject({ method: 'POST', url: '/admin/badges/live/sbdg_nope/revoke' });
    expect(r.statusCode).toBe(404);
  });
});
