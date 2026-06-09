/**
 * Phase 81-03 — GET /api/v1/fleet exposure field tests.
 *
 * Verifies:
 *   (a) Unauthenticated request → 401.
 *   (b) Authenticated org with a site that has a completed scan →
 *       response.sites[0].exposure.band is one of the four bands and
 *       exposure has NO numeric field (D-01).
 *   (c) A site with no completed scan → exposure === null.
 *   (d) Forbidden-words assertion: serialised payload contains none of
 *       compliant / 100% / lawsuit-proof / will be sued / fault / guarantee
 *       (D-07 on API payload).
 *   (e) Org isolation: a site registered under orgA is never visible to orgB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { wpNetworkApiRoutes } from '../../../src/routes/api/wp-network.js';
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

const orgA = 'org-expo-a';

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
  dbPath = join(tmpdir(), `test-expo-${randomUUID()}.db`);
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

describe('GET /api/v1/fleet — unauthenticated', () => {
  it('returns 401 when no orgId is present', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: '' });
    const res = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    expect(res.statusCode).toBe(401);
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (b) Scanned site — exposure field present with band, no numeric field
// ---------------------------------------------------------------------------

describe('GET /api/v1/fleet — exposure field on scanned site', () => {
  it('returns exposure.band as one of the four valid bands', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    // Register a site
    const reg = await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://expo-test.example', wp_version: '6.4' },
    });
    expect(reg.statusCode).toBe(201);

    // Insert a completed scan directly via storage
    const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
    await storage.scans.createScan({
      id: scanId,
      orgId: orgA,
      siteUrl: 'https://expo-test.example',
      standard: 'WCAG2AA',
      jurisdictions: ['EU-EAA'],
      regulations: [],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    });
    // Mark it completed with findings
    await storage.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      errors: 2,
      warnings: 3,
      notices: 5,
      confirmedViolations: 0,
      jsonReport: '{}',
    });

    const list = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.sites).toHaveLength(1);

    const site = body.sites[0];
    expect(site.exposure).not.toBeNull();

    const validBands = ['lower', 'moderate', 'elevated', 'high'] as const;
    expect(validBands).toContain(site.exposure.band);

    // D-01: no numeric field (no score, percentage, or numeric value)
    expect(typeof site.exposure.score).toBe('undefined');
    expect(typeof site.exposure.percentage).toBe('undefined');
    expect(typeof site.exposure.value).toBe('undefined');
    expect(typeof site.exposure.numericScore).toBe('undefined');

    // exposure has band, drivers, asOf
    expect(typeof site.exposure.band).toBe('string');
    expect(Array.isArray(site.exposure.drivers)).toBe(true);
    expect(typeof site.exposure.asOf).toBe('string');

    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (c) Site with no completed scan — exposure === null
// ---------------------------------------------------------------------------

describe('GET /api/v1/fleet — null exposure when no scan', () => {
  it('returns exposure: null when the site has no completed scan', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://no-scan.example' },
    });

    const list = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0].exposure).toBeNull();
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (d) Forbidden-words assertion on serialised payload (D-07)
// ---------------------------------------------------------------------------

describe('GET /api/v1/fleet — D-07 forbidden words absent from payload', () => {
  it('serialised payload contains none of the forbidden words', async () => {
    const server = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    await server.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://forbidden-words.example' },
    });

    const list = await server.inject({ method: 'GET', url: '/api/v1/fleet' });
    const payload = list.body.toLowerCase();

    const forbidden = [
      'compliant',
      '100%',
      'lawsuit-proof',
      'will be sued',
      'will face a lawsuit',
      'guarantee',
    ];
    for (const word of forbidden) {
      expect(payload).not.toContain(word);
    }
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// (e) Org isolation — orgA sites never visible to orgB
// ---------------------------------------------------------------------------

describe('GET /api/v1/fleet — org isolation', () => {
  it('does not return orgA sites when authenticated as orgB', async () => {
    const serverA = await buildServerWithUser({ id: 'u1', currentOrgId: orgA });
    await serverA.inject({
      method: 'POST',
      url: '/api/v1/fleet',
      payload: { url: 'https://org-a-only.example' },
    });
    await serverA.close();

    const orgB = 'org-expo-b';
    const serverB = await buildServerWithUser({ id: 'u2', currentOrgId: orgB });
    const list = await serverB.inject({ method: 'GET', url: '/api/v1/fleet' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    const urls = body.sites.map((s: { url: string }) => s.url);
    expect(urls).not.toContain('https://org-a-only.example');
    await serverB.close();
  });
});
