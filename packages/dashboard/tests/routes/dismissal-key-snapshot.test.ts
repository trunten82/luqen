/**
 * HARD-08 (D-91-10, owner ruling "store the label") — a dismissal marked by an API key of the
 * scan's own organization carries a snapshot of that key's label and creation time, so the
 * Dismissed section can still name the key after it is deleted and can tell two same-label keys
 * apart. The snapshot never holds the api_keys row id or the secret (the 89-11 rule).
 *
 * Real SQLite through openStore; the route runs behind a preHandler that sets the identity the
 * real auth guard builds for an API key (id 'api-key' plus apiKeyId).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { issueDismissalRoutes } from '../../src/routes/api/issue-dismissals.js';
import {
  CODE,
  SELECTOR,
  SITE_URL,
  openStore,
  buildRouteServer,
  seedOrg,
  seedScan,
  seedDismissal,
  type Store,
} from '../helpers/issue-dismissal-route-harness.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';

const PERMS = ['issues.dismiss', 'reports.view'];
const good = { code: CODE, selector: SELECTOR, reason: 'Hidden noscript copy' };

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

interface KeyIdentity {
  readonly apiKeyId: string;
  readonly role: string;
  readonly currentOrgId?: string;
  readonly orgScopedApiKey?: boolean;
}

/** The request.user shape the auth guard builds for an API key (src/auth/middleware.ts). */
async function asKey(identity: KeyIdentity): Promise<FastifyInstance> {
  const srv = Fastify();
  srv.addHook('preHandler', async (request) => {
    request.user = {
      id: 'api-key',
      username: 'api-key',
      role: identity.role,
      apiKeyId: identity.apiKeyId,
      ...(identity.currentOrgId !== undefined ? { currentOrgId: identity.currentOrgId } : {}),
      ...(identity.orgScopedApiKey === true ? { orgScopedApiKey: true } : {}),
    } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(PERMS);
  });
  await issueDismissalRoutes(srv, store.storage);
  await srv.ready();
  server = srv;
  return srv;
}

function mark(srv: FastifyInstance, scanId: string) {
  return srv.inject({ method: 'POST', url: `/api/v1/scans/${scanId}/dismissals`, payload: good });
}

async function keyCreatedAt(orgId: string, keyId: string): Promise<string> {
  const row = (await store.storage.apiKeys.listKeys(orgId)).find((k) => k.id === keyId);
  if (row === undefined) throw new Error('seeded key not found');
  return row.createdAt;
}

function rawRow(id: string): Record<string, unknown> {
  return store.storage
    .getRawDatabase()
    .prepare('SELECT * FROM issue_dismissals WHERE id = ?')
    .get(id) as Record<string, unknown>;
}

describe('HARD-08 dismissal key snapshot — written at mark time', () => {
  it('HARD-08 a dismissal by an api key stores the key label and creation time', async () => {
    const org = await seedOrg(store.storage, 'fabrikam');
    const scanId = await seedScan(store.storage, { orgId: org });
    const secret = 'lq-test-secret-value-0001';
    const keyId = await store.storage.apiKeys.storeKey(secret, 'CI deploy', org, 'admin');
    const createdAt = await keyCreatedAt(org, keyId);

    const srv = await asKey({ apiKeyId: keyId, role: 'admin', currentOrgId: org, orgScopedApiKey: true });
    const res = await mark(srv, scanId);
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;

    const stored = await store.storage.issueDismissals!.getById(id);
    expect(stored?.createdByKeySnapshot).toEqual({ label: 'CI deploy', keyCreatedAt: createdAt });

    // The key id appears only where it did before (created_by / created_by_id); the secret nowhere.
    const row = rawRow(id);
    for (const [column, value] of Object.entries(row)) {
      if (column === 'created_by' || column === 'created_by_id') continue;
      expect(String(value ?? ''), column).not.toContain(keyId);
    }
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row['created_by']).toBe(`api-key:${keyId}`);
    expect(row['created_by_id']).toBe(`api-key:${keyId}`);
  });

  it('HARD-08 a key of another org is not snapshotted', async () => {
    const org = await seedOrg(store.storage, 'fabrikam');
    const scanId = await seedScan(store.storage, { orgId: org });
    // A global admin key lives in org 'system'; it may mark on a Fabrikam scan.
    const keyId = await store.storage.apiKeys.storeKey('lq-test-secret-value-0002', 'Ops admin', undefined, 'admin');

    const srv = await asKey({ apiKeyId: keyId, role: 'admin' });
    const res = await mark(srv, scanId);
    expect(res.statusCode).toBe(201);
    const stored = await store.storage.issueDismissals!.getById((res.json() as { id: string }).id);
    expect(stored).not.toBeNull();
    expect(stored?.createdBy).toBe(`api-key:${keyId}`);
    expect(stored?.createdByKeySnapshot ?? null).toBeNull();
  });

  it('HARD-08 the snapshot keeps the organization rule when the key list answers for every organization', async () => {
    const org = await seedOrg(store.storage, 'fabrikam');
    const other = await seedOrg(store.storage, 'northwind');
    const scanId = await seedScan(store.storage, { orgId: org });
    const keyId = await store.storage.apiKeys.storeKey('lq-test-secret-value-0004', 'Northwind CI', other, 'admin');
    const otherKey = (await store.storage.apiKeys.listKeys(other)).find((k) => k.id === keyId);
    expect(otherKey).toBeDefined();
    // A key list that answers for every organization: it returns the other organization's key row.
    const spy = vi.spyOn(store.storage.apiKeys, 'listKeys').mockResolvedValue([otherKey!]);
    try {
      const srv = await asKey({ apiKeyId: keyId, role: 'admin' });
      const res = await mark(srv, scanId);
      expect(res.statusCode).toBe(201);
      expect(spy).toHaveBeenCalled(); // positive control: the key list was read
      const stored = await store.storage.issueDismissals!.getById((res.json() as { id: string }).id);
      expect(stored).not.toBeNull();
      expect(stored?.createdByKeySnapshot ?? null).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('HARD-08 a session user mark stores no snapshot', async () => {
    const org = await seedOrg(store.storage, 'fabrikam');
    const scanId = await seedScan(store.storage, { orgId: org });
    await store.storage.apiKeys.storeKey('lq-test-secret-value-0003', 'CI deploy', org, 'admin');

    server = await buildRouteServer(store.storage, {
      user: { id: 'u-alice', username: 'alice', role: 'user', currentOrgId: org },
      permissions: PERMS,
    });
    const res = await mark(server, scanId);
    expect(res.statusCode).toBe(201);
    const stored = await store.storage.issueDismissals!.getById((res.json() as { id: string }).id);
    expect(stored?.createdBy).toBe('alice');
    expect(stored?.createdByKeySnapshot ?? null).toBeNull();
  });
});

describe('HARD-08 dismissal key snapshot — read back defensively', () => {
  async function seedWithSnapshot(value: string | null): Promise<string> {
    const org = await seedOrg(store.storage, `fabrikam-${Math.random().toString(36).slice(2, 8)}`);
    const d = await seedDismissal(store.storage, { orgId: org });
    store.storage
      .getRawDatabase()
      .prepare('UPDATE issue_dismissals SET created_by_key_snapshot = ? WHERE id = ?')
      .run(value, d.id);
    return d.id;
  }

  it('HARD-08 a malformed snapshot reads as none', async () => {
    const at = '2026-01-02T03:04:05.000Z';
    const malformed = [
      'not json',
      '{"label":"CI deploy"',
      'null',
      '[]',
      '"CI deploy"',
      JSON.stringify({ label: 5, keyCreatedAt: at }),
      JSON.stringify({ label: 'CI deploy' }),
      JSON.stringify({ label: 'CI deploy', keyCreatedAt: 'not a date' }),
      JSON.stringify({ label: 'CI deploy', keyCreatedAt: 12 }),
      JSON.stringify({ label: '   ', keyCreatedAt: at }),
    ];
    for (const value of malformed) {
      const id = await seedWithSnapshot(value);
      const byId = await store.storage.issueDismissals!.getById(id);
      expect(byId, value).not.toBeNull();
      expect(byId?.createdByKeySnapshot, value).toBeNull();
      const listed = await store.storage.issueDismissals!.listForSite(byId!.orgId, toSiteKey(SITE_URL));
      expect(listed.map((d) => d.createdByKeySnapshot), value).toEqual([null]);
    }
    // Control: a well-formed value reads back.
    const ok = await seedWithSnapshot(JSON.stringify({ label: 'CI deploy', keyCreatedAt: at }));
    expect((await store.storage.issueDismissals!.getById(ok))?.createdByKeySnapshot).toEqual({
      label: 'CI deploy',
      keyCreatedAt: at,
    });
  });

  it('HARD-08 a stored snapshot label is trimmed and capped', async () => {
    const at = '2026-01-02T03:04:05.000Z';
    const padded = await seedWithSnapshot(JSON.stringify({ label: '  CI deploy  ', keyCreatedAt: at }));
    expect((await store.storage.issueDismissals!.getById(padded))?.createdByKeySnapshot?.label).toBe('CI deploy');

    const long = await seedWithSnapshot(JSON.stringify({ label: 'x'.repeat(150), keyCreatedAt: at }));
    expect((await store.storage.issueDismissals!.getById(long))?.createdByKeySnapshot?.label).toBe('x'.repeat(100));
  });
});
