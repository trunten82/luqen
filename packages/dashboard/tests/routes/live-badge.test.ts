/**
 * Phase 64 — live (dynamic) badge route integration tests.
 *
 * Builds a minimal Fastify with badgeRoutes (public) + a fake-user
 * preHandler-gated reportRoutes (for the toggle endpoint).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { badgeRoutes } from '../../src/routes/badge.js';
import { reportRoutes } from '../../src/routes/reports.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; role?: string; currentOrgId?: string };
  }
}

const orgA = 'org_a';
const orgB = 'org_b';
let storage: SqliteStorageAdapter;
let dbPath: string;
let server: FastifyInstance;

async function buildServer(user: { id: string; role?: string; currentOrgId: string } | null) {
  const s = Fastify();
  if (user !== null) {
    s.addHook('preHandler', async (request) => { request.user = user; });
  }
  await badgeRoutes(s, storage);
  await reportRoutes(s, storage, () => null, {});
  return s;
}

async function seedScan(orgId: string, siteUrl: string, opts: {
  id: string; completedAt?: string; status?: string; errors?: number;
}) {
  await storage.scans.createScan({
    id: opts.id,
    siteUrl,
    standard: 'WCAG21AA',
    jurisdictions: [],
    createdBy: 'u1',
    orgId,
    createdAt: '2025-12-01T00:00:00Z',
  });
  if (opts.status === 'completed' || opts.completedAt !== undefined) {
    await storage.scans.updateScan(opts.id, {
      status: 'completed',
      completedAt: opts.completedAt ?? '2026-01-01T00:00:00Z',
      ...(opts.errors !== undefined ? { errors: opts.errors } : {}),
    });
  }
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
// Live badge SVG resolution
// ---------------------------------------------------------------------------

describe('GET /api/v1/badge/live/:badgeId.svg', () => {
  it('404 for unknown badge id', async () => {
    server = await buildServer(null);
    const r = await server.inject({ method: 'GET', url: '/api/v1/badge/live/sbdg_nope.svg' });
    expect(r.statusCode).toBe(404);
  });

  it('404 when badge is disabled', async () => {
    await seedScan(orgA, 'https://shop.example', { id: 's1', status: 'completed' });
    const b = await storage.siteBadges.enable(orgA, 'https://shop.example');
    await storage.siteBadges.setEnabled(b.id, orgA, false);
    server = await buildServer(null);
    const r = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.svg` });
    expect(r.statusCode).toBe(404);
  });

  it('404 when no completed scan exists for the site', async () => {
    const b = await storage.siteBadges.enable(orgA, 'https://shop.example');
    server = await buildServer(null);
    const r = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.svg` });
    expect(r.statusCode).toBe(404);
  });

  it('renders the latest completed scan as SVG', async () => {
    await seedScan(orgA, 'https://shop.example', {
      id: 'old', completedAt: '2026-01-01T00:00:00Z', errors: 5,
    });
    await seedScan(orgA, 'https://shop.example', {
      id: 'newest', completedAt: '2026-05-01T00:00:00Z', errors: 0,
    });
    const b = await storage.siteBadges.enable(orgA, 'https://shop.example');
    server = await buildServer(null);
    const r = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.svg` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/svg/);
    expect(r.body).toContain('<svg');
    // VERIFIED label appears because the newest scan has 0 errors / violations.
    expect(r.body).toContain('VERIFIED');
    // The 2026-05-01 date should be embedded.
    expect(r.body).toContain('2026-05-01');
  });

  it('JSON variant returns the scan id of the latest scan', async () => {
    await seedScan(orgA, 'https://x.example', {
      id: 'older', completedAt: '2026-01-01T00:00:00Z',
    });
    await seedScan(orgA, 'https://x.example', {
      id: 'newer', completedAt: '2026-02-01T00:00:00Z',
    });
    const b = await storage.siteBadges.enable(orgA, 'https://x.example');
    server = await buildServer(null);
    const r = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.json` });
    expect(r.statusCode).toBe(200);
    expect(r.json().scanId).toBe('newer');
    expect(r.json().siteUrl).toBe('https://x.example');
  });

  it('automatically tracks newer scans without changing the URL', async () => {
    await seedScan(orgA, 'https://acme.example', {
      id: 's-old', completedAt: '2026-01-01T00:00:00Z',
    });
    const b = await storage.siteBadges.enable(orgA, 'https://acme.example');
    server = await buildServer(null);

    const first = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.json` });
    expect(first.json().scanId).toBe('s-old');

    // New scan lands later.
    await seedScan(orgA, 'https://acme.example', {
      id: 's-new', completedAt: '2026-06-01T00:00:00Z',
    });

    const second = await server.inject({ method: 'GET', url: `/api/v1/badge/live/${b.id}.json` });
    expect(second.json().scanId).toBe('s-new');
  });
});

// ---------------------------------------------------------------------------
// Toggle endpoint
// ---------------------------------------------------------------------------

describe('POST /api/v1/reports/:id/site-badge', () => {
  it('rejects when scan is in another org', async () => {
    await seedScan(orgA, 'https://x.example', { id: 'sA', status: 'completed' });
    server = await buildServer({ id: 'u', currentOrgId: orgB });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/reports/sA/site-badge',
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(403);
  });

  it('returns 404 for unknown scan', async () => {
    server = await buildServer({ id: 'u', currentOrgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/reports/nope/site-badge',
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(404);
  });

  it('enable creates a site_badges row and returns embed URLs', async () => {
    await seedScan(orgA, 'https://shop.example', { id: 'sA', status: 'completed' });
    server = await buildServer({ id: 'u', currentOrgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/reports/sA/site-badge',
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.badgeId).toMatch(/^sbdg_/);
    expect(body.enabled).toBe(true);
    expect(body.badgeUrlSvg).toContain('/api/v1/badge/live/');
    expect(body.badgeUrlSvg.endsWith('.svg')).toBe(true);
    // The row must exist.
    const row = await storage.siteBadges.get(body.badgeId);
    expect(row?.enabled).toBe(true);
  });

  it('disable flips an existing badge off', async () => {
    await seedScan(orgA, 'https://shop.example', { id: 'sA', status: 'completed' });
    const b = await storage.siteBadges.enable(orgA, 'https://shop.example');
    server = await buildServer({ id: 'u', currentOrgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/reports/sA/site-badge',
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(200);
    const row = await storage.siteBadges.get(b.id);
    expect(row?.enabled).toBe(false);
  });

  it('disable on a site that never had a badge returns synthetic disabled', async () => {
    await seedScan(orgA, 'https://shop.example', { id: 'sA', status: 'completed' });
    server = await buildServer({ id: 'u', currentOrgId: orgA });
    const r = await server.inject({
      method: 'POST',
      url: '/api/v1/reports/sA/site-badge',
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
    expect(r.json().badgeId).toBe('');
  });
});
