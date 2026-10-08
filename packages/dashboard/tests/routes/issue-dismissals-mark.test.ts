/**
 * Phase 87 Plan 04 — POST /api/v1/scans/:scanId/dismissals (mark).
 *
 * Plain Fastify + real SQLite; identity and permissions are injected so each
 * test states exactly who is calling. Every test seeds its own orgs/scans.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CODE,
  SELECTOR,
  OTHER_SELECTOR,
  openStore,
  buildRouteServer,
  seedOrg,
  seedScan,
  seedDismissal,
  type Store,
  type HarnessUser,
} from '../helpers/issue-dismissal-route-harness.js';

let store: Store;
let server: FastifyInstance | undefined;

beforeEach(async () => {
  store = await openStore();
});

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await store.cleanup();
});

const DISMISS = ['issues.dismiss'];

async function as(user: HarnessUser, permissions: readonly string[] = DISMISS) {
  server = await buildRouteServer(store.storage, { user, permissions });
  return server;
}

function mark(srv: FastifyInstance, scanId: string, payload: Record<string, unknown>) {
  return srv.inject({ method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, payload });
}

const good = { code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy' };

describe('POST /api/v1/scans/:scanId/dismissals — permission and access', () => {
  it('mark returns 403 without issues.dismiss', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org }, ['reports.view']);
    const res = await mark(srv, scan, good);
    expect(res.statusCode).toBe(403);
    expect(await store.storage.issueDismissals!.listForSite(org, 'https://example.test/dev/en-us')).toHaveLength(0);
  });

  it('an org user with issues.dismiss marks a finding on its own org scan (201)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, good);
    expect(res.statusCode).toBe(201);
    expect(res.json().org_id).toBe(org);
    expect(res.json().created_by).toBe('tester');
  });

  it('a global admin marks on any org scan and the org comes from the scan', async () => {
    const orgB = await seedOrg(store.storage, 'org_b');
    const scan = await seedScan(store.storage, { orgId: orgB });
    const srv = await as({ role: 'admin' });
    const res = await mark(srv, scan, good);
    expect(res.statusCode).toBe(201);
    expect(res.json().org_id).toBe(orgB);
  });

  it('404 for an org user on another org scan, on a system-org scan, and on an unknown scan', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const scanSystem = await seedScan(store.storage, { orgId: 'system' });
    const srv = await as({ role: 'user', currentOrgId: orgA });
    expect((await mark(srv, scanB, good)).statusCode).toBe(404);
    expect((await mark(srv, scanSystem, good)).statusCode).toBe(404);
    expect((await mark(srv, 'scan_does_not_exist', good)).statusCode).toBe(404);
    expect(await store.storage.issueDismissals!.listForSite(orgB, 'https://example.test/dev/en-us')).toHaveLength(0);
    expect(await store.storage.issueDismissals!.listForSite('system', 'https://example.test/dev/en-us')).toHaveLength(0);
  });

  it('404 for an org user with no current org', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: orgA });
    const srv = await as({ role: 'user' });
    expect((await mark(srv, scan, good)).statusCode).toBe(404);
  });

  it('404 for an org-scoped admin key identity on another org scan (it is not a global admin)', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const srv = await as({ role: 'admin', currentOrgId: orgA, orgScopedApiKey: true });
    const res = await mark(srv, scanB, good);
    expect(res.statusCode).toBe(404);
    expect(await store.storage.issueDismissals!.listForSite(orgB, 'https://example.test/dev/en-us')).toHaveLength(0);
  });
});

describe('POST /api/v1/scans/:scanId/dismissals — input validation', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['1001 characters', 'x'.repeat(1001)],
  ])('mark refuses a reason that is %s (400)', async (_label, reason) => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, { ...good, reason });
    expect(res.statusCode).toBe(400);
  });

  it('mark accepts a reason of exactly 1000 characters (201)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, { ...good, reason: 'x'.repeat(1000) });
    expect(res.statusCode).toBe(201);
    expect(res.json().reason).toHaveLength(1000);
  });

  it.each(['', 'html', 'BODY', ' :root ', 'html > body', '/html/body'])(
    'mark refuses a whole-page selector %j',
    async (selector) => {
      const org = await seedOrg(store.storage, 'org_a');
      const scan = await seedScan(store.storage, { orgId: org });
      const srv = await as({ role: 'user', currentOrgId: org });
      const res = await mark(srv, scan, { ...good, selector });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cannot identify an element');
      expect(await store.storage.issueDismissals!.listForSite(org, 'https://example.test/dev/en-us')).toHaveLength(0);
    },
  );

  it('mark refuses an empty rule code (400)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, { ...good, code: '' });
    expect(res.statusCode).toBe(400);
  });

  it('mark refuses a body with a missing field (400)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    expect((await mark(srv, scan, { code: CODE, selector: SELECTOR })).statusCode).toBe(400);
  });

  it('a client-supplied org_id or site_url is never used: the org comes from the scan (D-01)', async () => {
    // Fastify strips unknown body properties (ajv removeAdditional), so they are
    // ignored rather than rejected — what matters is that they cannot steer the write.
    const org = await seedOrg(store.storage, 'org_a');
    const other = await seedOrg(store.storage, 'org_b');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'admin' });
    const res = await mark(srv, scan, { ...good, org_id: other, site_url: 'https://evil.test/' });
    expect(res.statusCode).toBe(201);
    expect(res.json().org_id).toBe(org);
    expect(res.json().site_url).toBe('https://example.test/dev/en-us/');
    expect(await store.storage.issueDismissals!.listForSite(other, 'https://evil.test')).toHaveLength(0);
  });
});

describe('POST /api/v1/scans/:scanId/dismissals — report and conflicts', () => {
  it('422 for a (code, selector) that is not in the scan report', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const wrongSelector = await mark(srv, scan, { ...good, selector: '#not-there' });
    expect(wrongSelector.statusCode).toBe(422);
    const wrongCode = await mark(srv, scan, { ...good, code: 'WCAG2AA.Nope' });
    expect(wrongCode.statusCode).toBe(422);
    expect(await store.storage.issueDismissals!.listForSite(org, 'https://example.test/dev/en-us')).toHaveLength(0);
  });

  it('422 for a scan that is not completed', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org, status: 'queued' });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, good);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Scan has no completed report');
  });

  it('409 with existing_id when the finding is already dismissed', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const first = await mark(srv, scan, good);
    expect(first.statusCode).toBe(201);
    const second = await mark(srv, scan, good);
    expect(second.statusCode).toBe(409);
    expect(second.json().existing_id).toBe(first.json().id);
  });

  it('409 from a second scan of the same site whose url differs only by host case and trailing slash', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan1 = await seedScan(store.storage, { orgId: org, siteUrl: 'https://example.test/dev/en-us/' });
    const scan2 = await seedScan(store.storage, { orgId: org, siteUrl: 'https://EXAMPLE.test/dev/en-us' });
    const srv = await as({ role: 'user', currentOrgId: org });
    const first = await mark(srv, scan1, good);
    expect(first.statusCode).toBe(201);
    const second = await mark(srv, scan2, good);
    expect(second.statusCode).toBe(409);
    expect(second.json().existing_id).toBe(first.json().id);
  });

  it('the same finding on the same site in another org is not a conflict', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    await seedDismissal(store.storage, { orgId: orgA });
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const srv = await as({ role: 'user', currentOrgId: orgB });
    expect((await mark(srv, scanB, good)).statusCode).toBe(201);
  });

  it('a different selector on the same site and code is not a conflict', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    await seedDismissal(store.storage, { orgId: org });
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await mark(srv, scan, { code: 'WCAG2AA.Principle2.Other', selector: OTHER_SELECTOR, reason: 'r' });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/v1/scans/:scanId/dismissals — storage without dismissals', () => {
  it('503 when the storage adapter has no issueDismissals repository', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const bare = Object.create(store.storage, { issueDismissals: { value: undefined } });
    server = await buildRouteServer(bare, { user: { role: 'user', currentOrgId: org }, permissions: DISMISS });
    const res = await mark(server, scan, good);
    expect(res.statusCode).toBe(503);
  });
});
