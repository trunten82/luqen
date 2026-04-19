/**
 * Phase 31.2 Plan 04 — /admin/clients org-scoped visibility + Revoked/Org
 * columns + cross-org revoke defense + audit entry + soft-revoke cascade.
 *
 * Tests 1-6 (GET visibility + template columns — Task 1):
 *   - Test 1: admin (admin.system) sees ALL DCR rows (listAll path).
 *   - Test 2: admin.org in org-A sees only own-org DCR rows (findByOrg path),
 *             NOT cross-org rows, NOT NULL-registrant orphans.
 *   - Test 3: regular user (no admin.system / admin.org) receives 403.
 *   - Test 4: rendered list carries a revokedAtDisplay field per row (string
 *             or null); HBS template contains a Revoked column header.
 *   - Test 5: admin.system render carries showOrgColumn=true and the org
 *             NAME (NOT userId / UUID) in orgDisplayName; admin.org render
 *             carries showOrgColumn=false.
 *   - Test 6: a row with revokedAtDisplay non-null hides the Revoke button
 *             (canRevoke=false). HBS template uses {{#unless revokedAtDisplay}}.
 *
 * Tests A-E (revoke defense + audit — Task 2):
 *   - Test A: admin revokes cross-org DCR client → 200/302 + revoked_at set.
 *   - Test B: admin.org in org-A revokes own-org DCR → 200/302 + revoked_at set.
 *   - Test C: admin.org in org-A revoking cross-org → 403, revoked_at UNCHANGED,
 *             agent_audit_log row with tool_name='admin.clients.cross_org_revoke_attempt'.
 *   - Test D: admin.org revoking NULL-registrant DCR → 403 + audit row.
 *   - Test E: 3 cross-org revoke attempts → 3 audit rows (no de-dup).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { clientRoutes } from '../../../src/routes/admin/clients.js';
import { registerSession } from '../../../src/auth/session.js';

vi.mock('../../../src/compliance-client.js', () => ({
  listClients: vi.fn().mockResolvedValue([]),
  createClient: vi.fn(),
  revokeClient: vi.fn(),
}));

vi.mock('../../../src/branding-client.js', () => ({
  listBrandingClients: vi.fn().mockResolvedValue([]),
  createBrandingClient: vi.fn(),
  revokeBrandingClient: vi.fn(),
}));

const ENC_KEY = 'test-session-secret-at-least-32b';

interface OrgFixture {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly orgAId: string;
  readonly orgBId: string;
  readonly orgAName: string;
  readonly orgBName: string;
  readonly userAId: string;
  readonly userBId: string;
  readonly adminUserId: string;
  readonly regularUserId: string;
  readonly clientAlphaId: string;  // registered by userA (orgA)
  readonly clientBetaId: string;   // registered by userB (orgB)
  readonly clientOrphanId: string; // registered_by_user_id IS NULL
  readonly cleanup: () => Promise<void>;
}

type Viewer =
  | 'admin'           // admin.system (user.role === 'admin', currentOrgId === 'system')
  | 'admin-org-A'     // admin.org in org-A
  | 'admin-org-B'     // admin.org in org-B
  | 'regular';        // no admin.system / no admin.org

async function buildOrgFixture(viewer: Viewer): Promise<OrgFixture> {
  setEncryptionSalt('phase-31-2-plan-04-clients-salt');
  const dbPath = join(tmpdir(), `test-clients-plan04-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Seed two orgs with named org records.
  const orgA = await storage.organizations.createOrg({
    name: 'Acme Inc.', slug: `org-a-${randomUUID()}`,
  });
  const orgB = await storage.organizations.createOrg({
    name: 'Beta Corp', slug: `org-b-${randomUUID()}`,
  });

  // Seed two users, one per org, via team membership.
  const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
  const userB = await storage.users.createUser(`userB-${randomUUID()}`, 'pw', 'user');
  const teamA = await storage.teams.createTeam({
    name: 'Team A', description: '', orgId: orgA.id,
  });
  const teamB = await storage.teams.createTeam({
    name: 'Team B', description: '', orgId: orgB.id,
  });
  await storage.teams.addTeamMember(teamA.id, userA.id);
  await storage.teams.addTeamMember(teamB.id, userB.id);

  // An admin user (user.role === 'admin') with currentOrgId='system'.
  const db = storage.getRawDatabase();
  const adminUserId = randomUUID();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'admin', 1, ?)`,
  ).run(adminUserId, `admin-${adminUserId}`, new Date().toISOString());

  // A regular user with no admin permissions.
  const regularUser = await storage.users.createUser(`reg-${randomUUID()}`, 'pw', 'viewer');

  // Seed three DCR clients: alpha (userA/orgA), beta (userB/orgB), orphan (NULL).
  const alpha = await storage.oauthClients.register({
    clientName: 'Alpha (orgA)',
    redirectUris: ['http://localhost/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
    registeredByUserId: userA.id,
  });
  const beta = await storage.oauthClients.register({
    clientName: 'Beta (orgB)',
    redirectUris: ['http://localhost/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
    registeredByUserId: userB.id,
  });
  const orphan = await storage.oauthClients.register({
    clientName: 'Orphan (NULL user)',
    redirectUris: ['http://localhost/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
    // No registeredByUserId.
  });

  // Pick current user + perms based on viewer role.
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, ENC_KEY);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200)
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  server.addHook('preHandler', async (request) => {
    if (viewer === 'admin') {
      request.user = {
        id: adminUserId, username: 'admin', role: 'admin', currentOrgId: 'system',
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.system', 'admin.org', 'compliance.view', 'compliance.manage',
      ]);
    } else if (viewer === 'admin-org-A') {
      request.user = {
        id: userA.id, username: 'userA', role: 'user', currentOrgId: orgA.id,
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.org', 'compliance.view',
      ]);
    } else if (viewer === 'admin-org-B') {
      request.user = {
        id: userB.id, username: 'userB', role: 'user', currentOrgId: orgB.id,
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.org', 'compliance.view',
      ]);
    } else {
      // regular
      request.user = {
        id: regularUser.id, username: 'regular', role: 'viewer', currentOrgId: orgA.id,
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'compliance.view',
      ]);
    }
  });

  await clientRoutes(server, 'http://compliance.test', storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server,
    storage,
    orgAId: orgA.id,
    orgBId: orgB.id,
    orgAName: 'Acme Inc.',
    orgBName: 'Beta Corp',
    userAId: userA.id,
    userBId: userB.id,
    adminUserId,
    regularUserId: regularUser.id,
    clientAlphaId: alpha.clientId,
    clientBetaId: beta.clientId,
    clientOrphanId: orphan.clientId,
    cleanup,
  };
}

// ── Task 1 — Tests 1-3: GET visibility by role ───────────────────────────────

describe('GET /admin/clients — Task 1 visibility (Plan 04 D-19)', () => {
  it('Test 1: admin.system sees ALL DCR rows (listAll)', async () => {
    const fx = await buildOrgFixture('admin');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          clients: Array<{ clientId: string; kind: string }>;
          showOrgColumn: boolean;
          isGlobalAdmin: boolean;
        };
      };
      const dcrIds = body.data.clients
        .filter((c) => c.kind === 'DCR')
        .map((c) => c.clientId)
        .sort();
      expect(dcrIds).toEqual([fx.clientAlphaId, fx.clientBetaId, fx.clientOrphanId].sort());
      expect(body.data.isGlobalAdmin).toBe(true);
      expect(body.data.showOrgColumn).toBe(true);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 2: admin.org in org-A sees ONLY own-org DCR rows (no cross-org, no NULL-registrant)', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          clients: Array<{ clientId: string; kind: string }>;
          showOrgColumn: boolean;
          isGlobalAdmin: boolean;
        };
      };
      const dcrIds = body.data.clients
        .filter((c) => c.kind === 'DCR')
        .map((c) => c.clientId);
      expect(dcrIds).toContain(fx.clientAlphaId);
      expect(dcrIds).not.toContain(fx.clientBetaId);   // cross-org hidden
      expect(dcrIds).not.toContain(fx.clientOrphanId); // NULL registrant hidden
      expect(body.data.isGlobalAdmin).toBe(false);
      expect(body.data.showOrgColumn).toBe(false);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 3: regular user (no admin.system / no admin.org) is 403', async () => {
    const fx = await buildOrgFixture('regular');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(403);
    } finally {
      await fx.cleanup();
    }
  });
});

// ── Task 1 — Tests 4-6: Revoked column + Org column + hide-revoke-when-revoked ──

describe('GET /admin/clients — Task 1 columns (Plan 04 D-24)', () => {
  it('Test 4: every DCR row carries revokedAtDisplay (null when active); template has Revoked <th>', async () => {
    const fx = await buildOrgFixture('admin');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          clients: Array<{
            kind: string;
            revokedAtDisplay: string | null;
          }>;
        };
      };
      const dcrRows = body.data.clients.filter((c) => c.kind === 'DCR');
      // Every row has the field (may be null for non-revoked).
      for (const row of dcrRows) {
        expect(row).toHaveProperty('revokedAtDisplay');
      }
      // None seeded as revoked.
      for (const row of dcrRows) {
        expect(row.revokedAtDisplay).toBeNull();
      }

      // HBS template contains the Revoked column header.
      const hbs = readFileSync(
        join(process.cwd(), 'src', 'views', 'admin', 'clients.hbs'),
        'utf-8',
      );
      expect(hbs).toContain('Revoked');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 5: admin.system render shows org NAME (not UUID / userId) in orgDisplayName', async () => {
    const fx = await buildOrgFixture('admin');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          clients: Array<{
            clientId: string;
            kind: string;
            orgDisplayName: string;
          }>;
          showOrgColumn: boolean;
        };
      };
      expect(body.data.showOrgColumn).toBe(true);

      const alphaRow = body.data.clients.find(
        (c) => c.kind === 'DCR' && c.clientId === fx.clientAlphaId,
      );
      expect(alphaRow).toBeDefined();
      // Must be the org NAME ('Acme Inc.'), not the orgId (UUID-ish), not userId.
      expect(alphaRow!.orgDisplayName).toBe('Acme Inc.');
      expect(alphaRow!.orgDisplayName).not.toBe(fx.orgAId);
      expect(alphaRow!.orgDisplayName).not.toMatch(/^user:/);

      const betaRow = body.data.clients.find(
        (c) => c.kind === 'DCR' && c.clientId === fx.clientBetaId,
      );
      expect(betaRow).toBeDefined();
      expect(betaRow!.orgDisplayName).toBe('Beta Corp');

      const orphanRow = body.data.clients.find(
        (c) => c.kind === 'DCR' && c.clientId === fx.clientOrphanId,
      );
      expect(orphanRow).toBeDefined();
      // NULL-registrant orphan: display is '—'.
      expect(orphanRow!.orgDisplayName).toBe('—');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 5b: admin.org viewer does NOT see the Org column (showOrgColumn=false)', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { showOrgColumn: boolean } };
      expect(body.data.showOrgColumn).toBe(false);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 6: a revoked row (revoked_at non-null) renders canRevoke=false; HBS hides button via {{#unless revokedAtDisplay}}', async () => {
    const fx = await buildOrgFixture('admin');
    try {
      // Simulate a soft-revoked row via raw SQL (Plan 04 Task 2 will switch
      // repo.revoke to UPDATE revoked_at; Task 1 tests use a fixture that
      // matches the future soft-revoke shape).
      const db = fx.storage.getRawDatabase();
      db.prepare(
        `UPDATE oauth_clients_v2 SET revoked_at = ? WHERE client_id = ?`,
      ).run(new Date().toISOString(), fx.clientAlphaId);

      const res = await fx.server.inject({ method: 'GET', url: '/admin/clients' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: {
          clients: Array<{
            clientId: string;
            kind: string;
            canRevoke: boolean;
            revokedAtDisplay: string | null;
          }>;
        };
      };
      const alphaRow = body.data.clients.find(
        (c) => c.kind === 'DCR' && c.clientId === fx.clientAlphaId,
      );
      expect(alphaRow).toBeDefined();
      expect(alphaRow!.revokedAtDisplay).not.toBeNull();
      // Revoke button must be hidden for a row that's already revoked.
      expect(alphaRow!.canRevoke).toBe(false);

      // HBS template hides revoke button via {{#unless revokedAtDisplay}}.
      const hbs = readFileSync(
        join(process.cwd(), 'src', 'views', 'admin', 'clients.hbs'),
        'utf-8',
      );
      expect(hbs).toMatch(/\{\{#unless revokedAtDisplay\}\}/);
    } finally {
      await fx.cleanup();
    }
  });
});

// ── Task 2 — Tests A-E: revoke defense + audit ───────────────────────────────

describe('POST /admin/clients/dcr/:clientId/revoke — Task 2 defense (Plan 04 D-21)', () => {
  it('Test A: admin.system revokes ANY DCR client (cross-org allowed) → 200/302 + revoked_at set', async () => {
    const fx = await buildOrgFixture('admin');
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/clients/dcr/${encodeURIComponent(fx.clientBetaId)}/revoke`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect([200, 302]).toContain(res.statusCode);

      const row = await fx.storage.oauthClients.findByClientId(fx.clientBetaId);
      expect(row).not.toBeNull();
      expect(row!.revokedAt).not.toBeNull();
    } finally {
      await fx.cleanup();
    }
  });

  it('Test B: admin.org in org-A revokes own-org DCR → 200/302 + revoked_at set', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/clients/dcr/${encodeURIComponent(fx.clientAlphaId)}/revoke`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect([200, 302]).toContain(res.statusCode);

      const row = await fx.storage.oauthClients.findByClientId(fx.clientAlphaId);
      expect(row).not.toBeNull();
      expect(row!.revokedAt).not.toBeNull();
    } finally {
      await fx.cleanup();
    }
  });

  it('Test C: admin.org in org-A revoking cross-org DCR → 403 + revoked_at UNCHANGED + audit row', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/clients/dcr/${encodeURIComponent(fx.clientBetaId)}/revoke`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect(res.statusCode).toBe(403);

      const row = await fx.storage.oauthClients.findByClientId(fx.clientBetaId);
      expect(row).not.toBeNull();
      expect(row!.revokedAt).toBeNull();

      // Agent audit log has a cross_org_revoke_attempt row.
      const db = fx.storage.getRawDatabase();
      const auditRows = db
        .prepare(
          `SELECT tool_name, outcome, outcome_detail, user_id, org_id, args_json
             FROM agent_audit_log
            WHERE tool_name = 'admin.clients.cross_org_revoke_attempt'
            ORDER BY created_at DESC`,
        )
        .all() as Array<{
          tool_name: string;
          outcome: string;
          outcome_detail: string | null;
          user_id: string;
          org_id: string;
          args_json: string;
        }>;
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const row0 = auditRows[0]!;
      expect(row0.outcome).toBe('denied');
      expect(row0.user_id).toBe(fx.userAId);
      expect(row0.org_id).toBe(fx.orgAId);
      expect(row0.outcome_detail).toContain(fx.clientBetaId);
      expect(row0.args_json).toContain(fx.clientBetaId);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test D: admin.org revoking NULL-registrant DCR → 403 + audit row (cross-org treatment)', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/clients/dcr/${encodeURIComponent(fx.clientOrphanId)}/revoke`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect(res.statusCode).toBe(403);

      const row = await fx.storage.oauthClients.findByClientId(fx.clientOrphanId);
      expect(row).not.toBeNull();
      expect(row!.revokedAt).toBeNull();

      const db = fx.storage.getRawDatabase();
      const auditRows = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM agent_audit_log
            WHERE tool_name = 'admin.clients.cross_org_revoke_attempt'`,
        )
        .get() as { n: number };
      expect(auditRows.n).toBeGreaterThanOrEqual(1);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test E: 3 cross-org attempts on same clientId yield 3 audit rows (no de-dup)', async () => {
    const fx = await buildOrgFixture('admin-org-A');
    try {
      for (let i = 0; i < 3; i++) {
        const res = await fx.server.inject({
          method: 'POST',
          url: `/admin/clients/dcr/${encodeURIComponent(fx.clientBetaId)}/revoke`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: '',
        });
        expect(res.statusCode).toBe(403);
      }

      const db = fx.storage.getRawDatabase();
      const count = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM agent_audit_log
            WHERE tool_name = 'admin.clients.cross_org_revoke_attempt'`,
        )
        .get() as { n: number };
      expect(count.n).toBe(3);
    } finally {
      await fx.cleanup();
    }
  });
});
