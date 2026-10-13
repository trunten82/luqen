/**
 * Phase 89 Plan 01 — API-key dismissal actors are attributable (D-12 / IN-02, FP-18).
 *
 * Before the dismissal permission is granted to anyone but global admins, every dismissal
 * made with an API key must name WHICH key made it: actor = actor_id = 'api-key:<api_keys row id>'
 * in issue_dismissals, issue_dismissal_events and audit_log, on every path a key can
 * authenticate by. The key id travels in a NEW AuthUser field (apiKeyId); request.user.id
 * stays 'api-key' because four sites use it as a discriminator.
 *
 * Two layers, on purpose: createServer-level tests prove the auth guard actually carries the
 * field (the guard rebuilds request.user field by field), and harness tests prove the route's
 * fallback for identities that bypass the guard.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey } from '../../src/auth/api-key.js';
import { createAuthGuard } from '../../src/auth/middleware.js';
import type { AuthService } from '../../src/auth/auth-service.js';
import type { AuthResult } from '../../src/plugins/types.js';
import {
  CODE,
  SELECTOR,
  openStore,
  buildRouteServer,
  seedOrg,
  seedScan,
  type Store,
} from '../helpers/issue-dismissal-route-harness.js';

const MARK_BODY = { code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy' };

interface Recorded {
  readonly createdBy: string;
  readonly createdById: string | null;
  readonly eventActors: readonly string[];
  readonly eventActorIds: readonly (string | null)[];
  readonly auditActors: readonly string[];
  readonly auditActorIds: readonly (string | null)[];
}

// ---------------------------------------------------------------------------
// createServer layer
// ---------------------------------------------------------------------------

describe('API-key dismissal actors through the real server', () => {
  let tmpRoot: string;
  let app: FastifyInstance;
  let seed: SqliteStorageAdapter;
  let systemKey: string;
  let systemKeyId: string;
  const rawKeys: string[] = [];

  beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-dash-api-key-actor-'));
    const dbPath = join(tmpRoot, 'dashboard.db');
    app = (await createServer({
      dbPath,
      reportsDir: join(tmpRoot, 'reports'),
      sessionSecret: 'a'.repeat(32),
      catalogueUrl: '',
      catalogueCacheTtl: 0,
      redisUrl: '',
      maxConcurrentScans: 1,
    } as never)) as FastifyInstance;
    await app.ready();
    seed = new SqliteStorageAdapter(dbPath);
    await seed.migrate();
    systemKey = generateApiKey();
    rawKeys.push(systemKey);
    systemKeyId = await seed.apiKeys.storeKey(systemKey, 'actor-system-admin', 'system', 'admin');
  }, 60_000);

  afterAll(async () => {
    if (seed !== undefined) await seed.disconnect();
    if (app !== undefined) await app.close();
    if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function tenant(): Promise<{ orgId: string; scanId: string; siteKey: string }> {
    const slug = `org-${randomUUID().slice(0, 8)}`;
    const orgId = (await seed.organizations.createOrg({ name: slug, slug })).id;
    const siteUrl = `https://${slug}.test/dev/en-us/`;
    const scanId = `scan_${randomUUID().replace(/-/g, '')}`;
    await seed.scans.createScan({
      id: scanId,
      siteUrl,
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'seed',
      createdAt: new Date().toISOString(),
      orgId,
    });
    await seed.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: JSON.stringify({
        pages: [{ url: siteUrl, issues: [{ type: 'error', code: CODE, message: 'contrast', selector: SELECTOR, context: '<p>x</p>' }] }],
        summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
      }),
    });
    return { orgId, scanId, siteKey: `https://${slug}.test/dev/en-us` };
  }

  async function recordedFor(orgId: string, siteKey: string, dismissalId: string): Promise<Recorded> {
    const row = (await seed.issueDismissals!.listForSite(orgId, siteKey)).find((d) => d.id === dismissalId);
    if (row === undefined) throw new Error('dismissal not stored');
    const events = await seed.issueDismissals!.listEvents(dismissalId);
    const audit = (await seed.audit.query({ resourceType: 'issue_dismissal' })).entries.filter((e) => e.resourceId === dismissalId);
    return {
      createdBy: row.createdBy,
      createdById: row.createdById,
      eventActors: events.map((e) => e.actor),
      eventActorIds: events.map((e) => e.actorId),
      auditActors: audit.map((e) => e.actor),
      auditActorIds: audit.map((e) => e.actorId),
    };
  }

  const expectedActor = (): string => `api-key:${systemKeyId}`;

  it('a Bearer key mark records api-key and the key row id as actor in the dismissal, its event and the audit row', async () => {
    const t = await tenant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      headers: { authorization: `Bearer ${systemKey}` },
      payload: MARK_BODY,
    });
    expect(res.statusCode).toBe(201);
    const rec = await recordedFor(t.orgId, t.siteKey, res.json().id as string);
    expect(systemKeyId).not.toBe('');
    expect(rec.createdBy).toBe(expectedActor());
    expect(rec.createdById).toBe(expectedActor());
    expect(rec.eventActors).toEqual([expectedActor()]);
    expect(rec.eventActorIds).toEqual([expectedActor()]);
    expect(rec.auditActors).toEqual([expectedActor()]);
    expect(rec.auditActorIds).toEqual([expectedActor()]);
  });

  it('a Bearer key revoke records the same actor on the revoke event and its audit row', async () => {
    const t = await tenant();
    const marked = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      headers: { authorization: `Bearer ${systemKey}` },
      payload: MARK_BODY,
    });
    const id = marked.json().id as string;
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/dismissals/${id}/revoke`,
      headers: { authorization: `Bearer ${systemKey}` },
      payload: { comment: 'no longer true' },
    });
    expect(revoked.statusCode).toBe(200);
    const rec = await recordedFor(t.orgId, t.siteKey, id);
    expect(rec.eventActors).toEqual([expectedActor(), expectedActor()]);
    expect(rec.eventActorIds).toEqual([expectedActor(), expectedActor()]);
    expect(rec.auditActors).toEqual([expectedActor(), expectedActor()]);
    expect(rec.auditActorIds).toEqual([expectedActor(), expectedActor()]);
  });

  it('an X-API-Key header mark records the same actor', async () => {
    const t = await tenant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      headers: { 'x-api-key': systemKey },
      payload: MARK_BODY,
    });
    expect(res.statusCode).toBe(201);
    const rec = await recordedFor(t.orgId, t.siteKey, res.json().id as string);
    expect([rec.createdBy, rec.createdById]).toEqual([expectedActor(), expectedActor()]);
    expect(rec.auditActors).toEqual([expectedActor()]);
  });

  it('an X-Org-Id override keeps the key id in the actor', async () => {
    const t = await tenant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      headers: { authorization: `Bearer ${systemKey}`, 'x-org-id': t.orgId },
      payload: MARK_BODY,
    });
    expect(res.statusCode).toBe(201);
    const rec = await recordedFor(t.orgId, t.siteKey, res.json().id as string);
    expect([rec.createdBy, rec.createdById]).toEqual([expectedActor(), expectedActor()]);
    expect(rec.eventActors).toEqual([expectedActor()]);
    expect(rec.auditActors).toEqual([expectedActor()]);
  });

  it('a /login API-key session mark records the key row id', async () => {
    const t = await tenant();
    // POST /login is a browser form: it needs the CSRF token the login page renders and the
    // session cookie that token is bound to.
    const page = await app.inject({ method: 'GET', url: '/login' });
    const token = /name="csrf-token" content="([^"]+)"|name="_csrf" value="([^"]+)"/.exec(page.body);
    const csrf = token?.[1] ?? token?.[2];
    expect(csrf).toBeDefined();
    const pageCookie = page.cookies.find((c) => c.name === 'session');
    expect(pageCookie).toBeDefined();
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      cookies: { session: pageCookie!.value },
      headers: { 'x-csrf-token': csrf! },
      payload: { apiKey: systemKey },
    });
    expect(login.statusCode).toBe(302);
    const cookie = login.cookies.find((c) => c.name === 'session');
    expect(cookie).toBeDefined();
    // A cookie session sends the report page's CSRF token, as issue-dismissals.js does (WR-02).
    const reportPage = await app.inject({ method: 'GET', url: `/reports/${t.scanId}`, cookies: { session: cookie!.value } });
    expect(reportPage.statusCode).toBe(200);
    const pageCsrf = /name="csrf-token" content="([^"]+)"/.exec(reportPage.body)?.[1];
    expect(pageCsrf).toBeDefined();
    const sessionCookie = reportPage.cookies.find((c) => c.name === 'session')?.value ?? cookie!.value;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      cookies: { session: sessionCookie },
      headers: { 'x-csrf-token': pageCsrf! },
      payload: MARK_BODY,
    });
    expect(res.statusCode).toBe(201);
    const rec = await recordedFor(t.orgId, t.siteKey, res.json().id as string);
    expect([rec.createdBy, rec.createdById]).toEqual([expectedActor(), expectedActor()]);
    expect(rec.eventActors).toEqual([expectedActor()]);
    expect(rec.auditActors).toEqual([expectedActor()]);
  });

  it('the key secret appears in no stored dismissal, event or audit row', async () => {
    const t = await tenant();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/scans/${t.scanId}/dismissals`,
      headers: { authorization: `Bearer ${systemKey}` },
      payload: MARK_BODY,
    });
    const id = res.json().id as string;
    const dismissals = await seed.issueDismissals!.listForSite(t.orgId, t.siteKey);
    const events = await seed.issueDismissals!.listEvents(id);
    const audit = await seed.audit.query({ resourceType: 'issue_dismissal' });
    const stored = JSON.stringify({ dismissals, events, audit: audit.entries });
    for (const raw of rawKeys) {
      expect(stored).not.toContain(raw);
    }
    expect(stored).toContain(`api-key:${systemKeyId}`);
  });
});

// ---------------------------------------------------------------------------
// Route fallback for identities that bypass the auth guard
// ---------------------------------------------------------------------------

describe('dismissal actor of an identity without a key id', () => {
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

  async function markAs(
    userFor: (orgId: string) => { id?: string; username?: string; role: string; currentOrgId?: string },
  ) {
    const org = await seedOrg(store.storage, 'org_a');
    const scan = await seedScan(store.storage, { orgId: org });
    server = await buildRouteServer(store.storage, { user: userFor(org), permissions: ['issues.dismiss'] });
    const res = await server.inject({ method: 'POST', url: `/api/v1/scans/${scan}/dismissals`, payload: MARK_BODY });
    expect(res.statusCode).toBe(201);
    return res.json() as { created_by: string; created_by_id: string | null; id: string };
  }

  it('a session that predates the key id records api-key:session', async () => {
    const body = await markAs(() => ({ id: 'api-key', username: 'admin', role: 'admin' }));
    expect(body.created_by).toBe('api-key:session');
    expect(body.created_by_id).toBe('api-key:session');
    const events = await store.storage.issueDismissals!.listEvents(body.id);
    expect(events.map((e) => [e.actor, e.actorId])).toEqual([['api-key:session', 'api-key:session']]);
    const audit = (await store.storage.audit.query({ resourceType: 'issue_dismissal' })).entries;
    expect(audit.map((e) => [e.actor, e.actorId])).toEqual([['api-key:session', 'api-key:session']]);
  });

  it("a password user's actor is unchanged", async () => {
    const body = await markAs((org) => ({ role: 'user', currentOrgId: org }));
    // The harness user defaults to username 'tester', id 'u-tester'.
    expect(body.created_by).toBe('tester');
    expect(body.created_by_id).toBe('u-tester');
  });
});

// ---------------------------------------------------------------------------
// The auth guard rebuild
// ---------------------------------------------------------------------------

describe('the auth guard rebuild carries apiKeyId', () => {
  function runGuard(result: AuthResult): Promise<FastifyRequest> {
    const authService = { authenticateRequest: vi.fn().mockResolvedValue(result) } as unknown as AuthService;
    const request = { url: '/api/v1/scans', headers: {}, session: { get: vi.fn() } } as unknown as FastifyRequest;
    const reply = { code: vi.fn(), redirect: vi.fn() } as unknown as FastifyReply;
    return createAuthGuard(authService)(request, reply).then(() => request);
  }

  it('the auth guard rebuild carries apiKeyId and a password session gets none', async () => {
    const keyRequest = await runGuard({
      authenticated: true,
      user: { id: 'api-key', username: 'api-key', role: 'admin', apiKeyId: 'key-row-1' },
    } as AuthResult);
    expect(keyRequest.user).toMatchObject({ id: 'api-key', username: 'api-key', apiKeyId: 'key-row-1' });

    const passwordRequest = await runGuard({
      authenticated: true,
      user: { id: 'u-1', username: 'alice', role: 'user' },
    });
    expect(passwordRequest.user).toEqual({ id: 'u-1', username: 'alice', role: 'user' });
    expect(Object.keys(passwordRequest.user ?? {})).not.toContain('apiKeyId');

    const emptyRequest = await runGuard({
      authenticated: true,
      user: { id: 'api-key', username: 'admin', role: 'admin', apiKeyId: '' },
    } as AuthResult);
    expect(Object.keys(emptyRequest.user ?? {})).not.toContain('apiKeyId');
  });
});
