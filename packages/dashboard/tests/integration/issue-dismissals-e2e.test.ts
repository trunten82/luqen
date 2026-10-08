/**
 * Phase 87 Plan 04 — createServer-level proof for the issue-dismissal routes.
 *
 * Boots the REAL server (auth guard -> dark-aware permission resolution ->
 * route -> store -> audit) and drives it with Bearer API keys:
 *   - a global admin key (org 'system', role 'admin') marks a finding;
 *   - an org-scoped admin key (org A, role 'admin') is refused while
 *     issues.dismiss is dark (D-07 path 3, proven at server level here).
 *
 * The org-scoped-key refusal test is a PIN, not a TDD driver: PR #102's cap
 * already withholds issues.dismiss from such keys, so the only first-run red
 * is the route not being registered (404). Its failing direction is
 * BT-87-04-D (drop the orgScopedApiKey argument in server.ts).
 *
 * Storage is not decorated on the Fastify instance, so a second
 * SqliteStorageAdapter on the same file seeds and reads back (WAL; same
 * process).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const SELECTOR = '#hero > p';
const SITE_URL = 'https://example.test/dev/en-us/';
const SITE_KEY = 'https://example.test/dev/en-us';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgA: string;
let scanA: string;
let systemKey: string;
let orgAKey: string;

function report(pageUrls: string[]): string {
  return JSON.stringify({
    pages: pageUrls.map((url) => ({
      url,
      issues: [
        { type: 'error', code: CODE, message: 'contrast', selector: SELECTOR, context: '<p>x</p>' },
        { type: 'warning', code: 'WCAG2AA.Principle2.Other', message: 'other', selector: '#nav a', context: '<a>x</a>' },
      ],
    })),
    summary: { pagesScanned: pageUrls.length, totalIssues: pageUrls.length * 2, byLevel: { error: pageUrls.length, warning: pageUrls.length, notice: 0 } },
  });
}

async function seedScan(orgId: string, siteUrl: string): Promise<string> {
  const id = `scan_${randomUUID().replace(/-/g, '')}`;
  await seed.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'seed',
    createdAt: new Date().toISOString(),
    orgId,
  });
  await seed.scans.updateScan(id, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: report([`${siteUrl}`, `${siteUrl}about`]),
  });
  return id;
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-dash-dismissals-e2e-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  const config = {
    dbPath,
    reportsDir: join(tmpRoot, 'reports'),
    sessionSecret: 'a'.repeat(32),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  };
  app = (await createServer(config as never)) as FastifyInstance;
  await app.ready();

  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgA = (await seed.organizations.createOrg({ name: 'Org A', slug: 'org-a-dis' })).id;
  scanA = await seedScan(orgA, SITE_URL);
  systemKey = generateApiKey();
  orgAKey = generateApiKey();
  await seed.apiKeys.storeKey(systemKey, 'e2e-system-admin', 'system', 'admin');
  await seed.apiKeys.storeKey(orgAKey, 'e2e-org-a-admin', orgA, 'admin');
}, 60_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

function mark(scanId: string, key: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/scans/${scanId}/dismissals`,
    headers: { authorization: `Bearer ${key}` },
    payload: body,
  });
}

describe('issue dismissals through the real server (Phase 87-04)', () => {
  it('global admin api key marks a finding and the dismissal, its history and the audit row are stored', async () => {
    const res = await mark(scanA, systemKey, { code: CODE, selector: SELECTOR, reason: '  Hidden noscript copy  ' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('active');
    expect(body.reason).toBe('Hidden noscript copy');
    expect(body.site_key).toBe(SITE_KEY);
    expect(body.org_id).toBe(orgA);

    const active = await seed.issueDismissals!.listActiveForSite(orgA, SITE_KEY);
    expect(active).toHaveLength(1);
    const events = await seed.issueDismissals!.listEvents(body.id);
    expect(events.map((e) => e.action)).toEqual(['mark']);
    const audit = await seed.audit.query({ resourceType: 'issue_dismissal' });
    const entry = audit.entries.find((e) => e.resourceId === body.id);
    expect(entry).toBeDefined();
    expect(entry?.orgId).toBe(orgA);
  });

  it('org-scoped admin api key is refused on mark while the permission is dark', async () => {
    const res = await mark(scanA, orgAKey, { code: CODE, selector: '#other', reason: 'should never be stored' });
    expect(res.statusCode).toBe(403);
    const active = await seed.issueDismissals!.listActiveForSite(orgA, SITE_KEY);
    expect(active.map((d) => d.selector)).not.toContain('#other');
  });
});

async function freshTenant(): Promise<{ orgId: string; scanId: string; key: string; siteKey: string }> {
  const slug = `org-${randomUUID().slice(0, 8)}`;
  const orgId = (await seed.organizations.createOrg({ name: slug, slug })).id;
  const siteUrl = `https://${slug}.test/dev/en-us/`;
  const scanId = await seedScan(orgId, siteUrl);
  const key = generateApiKey();
  await seed.apiKeys.storeKey(key, `e2e-${slug}`, orgId, 'admin');
  return { orgId, scanId, key, siteKey: `https://${slug}.test/dev/en-us` };
}

function authed(method: 'GET' | 'POST', url: string, key: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, ...(payload !== undefined ? { payload } : {}) });
}

describe('issue dismissals through the real server — list and revoke', () => {
  it('org-scoped admin api key lists its own org\'s dismissals', async () => {
    const t = await freshTenant();
    const marked = await seed.issueDismissals!.mark({
      orgId: t.orgId, siteUrl: `${t.siteKey}/`, siteKey: t.siteKey, code: CODE, selector: SELECTOR, reason: 'seeded', actor: 'seed',
    });
    expect(marked.kind).toBe('created');
    const res = await authed('GET', `/api/v1/scans/${t.scanId}/dismissals`, t.key);
    expect(res.statusCode).toBe(200);
    const items = res.json().dismissals as Array<{ selector: string; status: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].selector).toBe(SELECTOR);
    expect(items[0].status).toBe('active');
  });

  it('org-scoped admin api key cannot list another org\'s scan', async () => {
    const mine = await freshTenant();
    const theirs = await freshTenant();
    const res = await authed('GET', `/api/v1/scans/${theirs.scanId}/dismissals`, mine.key);
    expect(res.statusCode).toBe(404);
  });

  it('global admin revokes and the list shows both events', async () => {
    const t = await freshTenant();
    const marked = await authed('POST', `/api/v1/scans/${t.scanId}/dismissals`, systemKey, {
      code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy',
    });
    expect(marked.statusCode).toBe(201);
    const id = marked.json().id as string;
    const revoked = await authed('POST', `/api/v1/dismissals/${id}/revoke`, systemKey, { comment: 'no longer true' });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe('revoked');

    const res = await authed('GET', `/api/v1/scans/${t.scanId}/dismissals`, systemKey);
    expect(res.statusCode).toBe(200);
    const items = res.json().dismissals as Array<{ id: string; events: Array<{ action: string }> }>;
    expect(items.find((i) => i.id === id)?.events.map((e) => e.action)).toEqual(['mark', 'revoke']);
  });
});
