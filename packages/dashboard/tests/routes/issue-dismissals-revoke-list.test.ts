/**
 * Phase 87 Plan 04 — POST /api/v1/dismissals/:id/revoke and
 * GET /api/v1/scans/:scanId/dismissals (list).
 *
 * Plain Fastify + real SQLite; identity and permissions are injected.
 * Every test seeds its own orgs/scans/dismissals.
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

const DISMISS = ['issues.dismiss', 'reports.view'];

async function as(user: HarnessUser, permissions: readonly string[] = DISMISS) {
  server = await buildRouteServer(store.storage, { user, permissions });
  return server;
}

const revoke = (srv: FastifyInstance, id: string, payload: Record<string, unknown> = {}) =>
  srv.inject({ method: 'POST', url: `/api/v1/dismissals/${id}/revoke`, payload });

const list = (srv: FastifyInstance, scanId: string) =>
  srv.inject({ method: 'GET', url: `/api/v1/scans/${scanId}/dismissals` });

const SITE_KEY = 'https://example.test/dev/en-us';

describe('POST /api/v1/dismissals/:id/revoke', () => {
  it('revoke returns 403 without issues.dismiss', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org }, ['reports.view']);
    const res = await revoke(srv, d.id);
    expect(res.statusCode).toBe(403);
    expect((await store.storage.issueDismissals!.getById(d.id))?.status).toBe('active');
  });

  it('revokes with a trimmed comment, keeps the record and audits it (200)', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', username: 'bob', id: 'u-bob', currentOrgId: org });
    const res = await revoke(srv, d.id, { comment: '  was wrong  ' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('revoked');
    expect(body.revoke_comment).toBe('was wrong');
    expect(body.revoked_by).toBe('bob');
    expect(body.revoked_by_id).toBe('u-bob');
    expect(body.id).toBe(d.id);
    expect(await store.storage.issueDismissals!.getById(d.id)).not.toBeNull();
    const audit = await store.storage.audit.query({ resourceType: 'issue_dismissal', action: 'issue_dismissal.revoke' });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].resourceId).toBe(d.id);
    expect(audit.entries[0].orgId).toBe(org);
  });

  it('an empty body stores a null comment', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await revoke(srv, d.id, {});
    expect(res.statusCode).toBe(200);
    expect(res.json().revoke_comment).toBeNull();
  });

  it('400 for a comment longer than 1000 characters', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const res = await revoke(srv, d.id, { comment: 'x'.repeat(1001) });
    expect(res.statusCode).toBe(400);
    expect((await store.storage.issueDismissals!.getById(d.id))?.status).toBe('active');
  });

  it('409 on a second revoke', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    expect((await revoke(srv, d.id)).statusCode).toBe(200);
    const second = await revoke(srv, d.id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('This dismissal is already revoked');
  });

  it('404 for an unknown id and for an org user of another org', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const d = await seedDismissal(store.storage, { orgId: orgA });
    const srv = await as({ role: 'user', currentOrgId: orgB });
    expect((await revoke(srv, 'does-not-exist')).statusCode).toBe(404);
    expect((await revoke(srv, d.id)).statusCode).toBe(404);
    expect((await store.storage.issueDismissals!.getById(d.id))?.status).toBe('active');
  });

  it('404 for an org-scoped admin key identity on another org dismissal; a global admin may revoke it', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const d = await seedDismissal(store.storage, { orgId: orgA });
    const keySrv = await as({ role: 'admin', currentOrgId: orgB, orgScopedApiKey: true });
    expect((await revoke(keySrv, d.id)).statusCode).toBe(404);
    await keySrv.close();
    const adminSrv = await as({ role: 'admin' });
    expect((await revoke(adminSrv, d.id)).statusCode).toBe(200);
  });

  it('503 when the storage adapter has no issueDismissals repository', async () => {
    const bare = Object.create(store.storage, { issueDismissals: { value: undefined } });
    server = await buildRouteServer(bare, { user: { role: 'admin' }, permissions: DISMISS });
    expect((await revoke(server, 'anything')).statusCode).toBe(503);
  });
});

describe('GET /api/v1/scans/:scanId/dismissals', () => {
  it('list returns 403 without reports.view', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org }, ['issues.dismiss']);
    expect((await list(srv, scan)).statusCode).toBe(403);
  });

  it('returns active and revoked dismissals, each with its events oldest first', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const kept = await seedDismissal(store.storage, { orgId: org, selector: OTHER_SELECTOR, code: 'WCAG2AA.Principle2.Other' });
    const gone = await seedDismissal(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    expect((await revoke(srv, gone.id, { comment: 'undo' })).statusCode).toBe(200);

    const res = await list(srv, scan);
    expect(res.statusCode).toBe(200);
    const items = res.json().dismissals as Array<{ id: string; status: string; events: Array<{ action: string; text: string | null }> }>;
    expect(items).toHaveLength(2);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(kept.id)?.status).toBe('active');
    expect(byId.get(kept.id)?.events.map((e) => e.action)).toEqual(['mark']);
    expect(byId.get(gone.id)?.status).toBe('revoked');
    expect(byId.get(gone.id)?.events.map((e) => e.action)).toEqual(['mark', 'revoke']);
    expect(byId.get(gone.id)?.events[1].text).toBe('undo');
  });

  it('does not contain another org dismissal of the same site url', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    await seedDismissal(store.storage, { orgId: orgA });
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const srv = await as({ role: 'user', currentOrgId: orgB });
    const res = await list(srv, scanB);
    expect(res.statusCode).toBe(200);
    expect(res.json().dismissals).toEqual([]);
  });

  it('does not contain a dismissal of another site of the same org', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    await seedDismissal(store.storage, { orgId: org, siteUrl: 'https://other.test/' });
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    expect((await list(srv, scan)).json().dismissals).toEqual([]);
  });

  it('contains the dismissal when listing a scan of the trailing-slash / host-case variant of the same site', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const d = await seedDismissal(store.storage, { orgId: org, siteUrl: 'https://example.test/dev/en-us/' });
    const variant = await seedScan(store.storage, { orgId: org, siteUrl: 'https://EXAMPLE.test/dev/en-us' });
    const srv = await as({ role: 'user', currentOrgId: org });
    const items = (await list(srv, variant)).json().dismissals as Array<{ id: string; site_key: string }>;
    expect(items.map((i) => i.id)).toEqual([d.id]);
    expect(items[0].site_key).toBe(SITE_KEY);
  });

  it('404 for an unknown scan and for another org scan; a global admin can list any scan', async () => {
    const orgA = await seedOrg(store.storage, 'org_a');
    const orgB = await seedOrg(store.storage, 'org_b');
    const scanB = await seedScan(store.storage, { orgId: orgB });
    const userSrv = await as({ role: 'user', currentOrgId: orgA });
    expect((await list(userSrv, 'scan_nope')).statusCode).toBe(404);
    expect((await list(userSrv, scanB)).statusCode).toBe(404);
    await userSrv.close();
    const adminSrv = await as({ role: 'admin' });
    expect((await list(adminSrv, scanB)).statusCode).toBe(200);
  });

  it('503 when the storage adapter has no issueDismissals repository', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const bare = Object.create(store.storage, { issueDismissals: { value: undefined } });
    server = await buildRouteServer(bare, { user: { role: 'user', currentOrgId: org }, permissions: DISMISS });
    expect((await list(server, scan)).statusCode).toBe(503);
  });
});

describe('audit trail of mark and revoke', () => {
  it('each mark and revoke leaves exactly one audit_log entry with the right action', async () => {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    const srv = await as({ role: 'user', currentOrgId: org });
    const marked = await srv.inject({
      method: 'POST',
      url: `/api/v1/scans/${scan}/dismissals`,
      payload: { code: CODE, selector: SELECTOR, reason: 'fp' },
    });
    expect(marked.statusCode).toBe(201);
    const id = marked.json().id as string;

    let entries = (await store.storage.audit.query({ resourceType: 'issue_dismissal' })).entries;
    expect(entries.map((e) => e.action)).toEqual(['issue_dismissal.mark']);

    expect((await revoke(srv, id)).statusCode).toBe(200);
    entries = (await store.storage.audit.query({ resourceType: 'issue_dismissal' })).entries;
    expect(entries.map((e) => e.action).sort()).toEqual(['issue_dismissal.mark', 'issue_dismissal.revoke']);
    expect(entries.every((e) => e.resourceId === id && e.orgId === org)).toBe(true);
  });
});
