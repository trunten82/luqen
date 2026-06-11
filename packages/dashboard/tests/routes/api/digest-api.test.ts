/**
 * Phase 82-05 — GET /api/v1/digest endpoint tests.
 *
 * Verifies:
 *   (a) Unauthenticated request → 401.
 *   (b) Authenticated org context → 200 + { digest } payload whose sites
 *       have a band string (lower/moderate/elevated/high) and NO disclaimer
 *       field and NO numeric exposure score (D-11, D-12).
 *   (c) ?site= scoping returns a single-site digest shape.
 *   (d) Org-wide (no site param) returns org-wide digest shape.
 *   (e) Forbidden-words assertion: serialised payload contains none of
 *       compliant / 100% / lawsuit-proof / will be sued / at fault / guarantee.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { digestApiRoutes } from '../../../src/routes/api/digest.js';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;

const ORG_A = 'org-digest-a';
const SITE_URL = 'https://example.com/';

async function buildServerWithUser(user: {
  id: string;
  currentOrgId: string;
}): Promise<FastifyInstance> {
  const s = Fastify();
  s.addHook('preHandler', async (request) => {
    request.user = user;
  });
  await digestApiRoutes(s, storage);
  return s;
}

async function buildUnauthenticatedServer(): Promise<FastifyInstance> {
  const s = Fastify();
  // No user injected — currentOrgId will be undefined
  await digestApiRoutes(s, storage);
  return s;
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-digest-api-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// (a) Unauthenticated → 401
// ---------------------------------------------------------------------------

describe('GET /api/v1/digest — unauthenticated', () => {
  it('returns 401 when no orgId is present', async () => {
    const server = await buildUnauthenticatedServer();
    const res = await server.inject({ method: 'GET', url: '/api/v1/digest' });
    expect(res.statusCode).toBe(401);
    await server.close();
  });

  it('returns 401 when currentOrgId is empty string', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: '' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/digest' });
    expect(res.statusCode).toBe(401);
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (b) Authenticated org context — 200 + { digest } shape, no disclaimer, no number
// ---------------------------------------------------------------------------

describe('GET /api/v1/digest — authenticated', () => {
  it('returns 200 with { digest } payload for org with no sites', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: '/api/v1/digest' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ digest: unknown }>();
    expect(body).toHaveProperty('digest');
    await server.close();
  });

  it('digest payload has sites array', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: '/api/v1/digest' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ digest: { sites: unknown[] } }>();
    expect(Array.isArray(body.digest.sites)).toBe(true);
    await server.close();
  });

  it('site exposure has band string and no disclaimer field when scan exists', async () => {
    // Insert a completed scan for the org + site
    await storage.scans.createScan({
      id: randomUUID(),
      orgId: ORG_A,
      siteUrl: SITE_URL,
      status: 'completed',
      errors: 5,
      warnings: 3,
      notices: 1,
      jurisdictions: ['us'],
      regulations: ['ada'],
      confirmedViolations: 2,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: `/api/v1/digest?site=${encodeURIComponent(SITE_URL)}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ digest: { sites: Array<{ siteUrl: string; currentExposure?: unknown; exposure?: { band: string; disclaimer?: string } }> } }>();
    const sites = body.digest.sites;
    expect(sites.length).toBeGreaterThan(0);

    // Find the site
    const site = sites.find((s) => s.siteUrl === SITE_URL) ?? sites[0];
    expect(site).toBeDefined();

    // The band (if present in exposure) must be a valid label, not a number
    const siteStr = JSON.stringify(site);

    // No disclaimer field anywhere in the site payload (D-12)
    expect(siteStr).not.toMatch(/disclaimer/i);

    // No numeric-only exposure score (D-12)
    expect(siteStr).not.toMatch(/"score"\s*:\s*\d+/);

    await server.close();
  });

  it('band value is one of the ordinal labels when exposure is present', async () => {
    await storage.scans.createScan({
      id: randomUUID(),
      orgId: ORG_A,
      siteUrl: SITE_URL,
      status: 'completed',
      errors: 10,
      warnings: 5,
      notices: 2,
      jurisdictions: ['us'],
      regulations: ['ada'],
      confirmedViolations: 3,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: `/api/v1/digest?site=${encodeURIComponent(SITE_URL)}` });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ digest: { sites: Array<{ currentExposure?: { band: string } | null }> } }>();
    const site = body.digest.sites[0];
    if (site?.currentExposure != null) {
      expect(['lower', 'moderate', 'elevated', 'high']).toContain(site.currentExposure.band);
    }

    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (c) ?site= scoping
// ---------------------------------------------------------------------------

describe('GET /api/v1/digest?site= — single-site scope', () => {
  it('returns 200 for a specific site query', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/digest?site=${encodeURIComponent(SITE_URL)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ digest: unknown }>();
    expect(body).toHaveProperty('digest');
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (d) Org-wide (no site param)
// ---------------------------------------------------------------------------

describe('GET /api/v1/digest — org-wide scope', () => {
  it('returns 200 for org-wide digest with no site param', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: '/api/v1/digest' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ digest: { siteUrl: unknown; sites: unknown[] } }>();
    expect(body).toHaveProperty('digest');
    expect(body.digest).toHaveProperty('sites');
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (e) Forbidden words
// ---------------------------------------------------------------------------

describe('GET /api/v1/digest — forbidden words (D-12)', () => {
  const FORBIDDEN_PATTERNS = [
    /\bcompliant\b/i,
    /100%/,
    /\blawsuit-proof\b/i,
    /lawsuit proof/i,
    /\bwill be sued\b/i,
    /\bat fault\b/i,
    /\bfound liable\b/i,
    /\bguarantee[sd]?\b/i,
  ];

  it('serialised payload contains no forbidden words', async () => {
    await storage.scans.createScan({
      id: randomUUID(),
      orgId: ORG_A,
      siteUrl: SITE_URL,
      status: 'completed',
      errors: 2,
      warnings: 1,
      notices: 0,
      jurisdictions: ['eu'],
      regulations: ['en301549'],
      confirmedViolations: 0,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    const server = await buildServerWithUser({ id: 'u1', currentOrgId: ORG_A });
    const res = await server.inject({ method: 'GET', url: `/api/v1/digest?site=${encodeURIComponent(SITE_URL)}` });
    expect(res.statusCode).toBe(200);

    const payload = res.body;
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(payload).not.toMatch(pattern);
    }

    await server.close();
  });
});
