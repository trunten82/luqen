/**
 * Phase 31.1 Plan 01 Task 1 — OauthClientRepository contract tests.
 *
 * Covers MCPAUTH-02 data-layer foundation:
 *   - register() returns dcr_-prefixed client_id and (for confidential
 *     clients) a raw client_secret returned ONCE.
 *   - client_secret_hash is the ONLY persisted form; verifyClientSecret
 *     uses bcrypt.compare.
 *   - redirect_uris + grant_types round-trip as JSON arrays.
 *   - listByUserId returns rows ordered created_at DESC.
 *   - revoke() deletes the row.
 *
 * Harness pattern: temp-file sqlite + storage.migrate() (matches
 * agent-audit-repository.test.ts from Phase 31).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOauthClientRepository — register (public)', () => {
  it('returns a dcr_-prefixed client_id and null client_secret for public clients', async () => {
    const result = await storage.oauthClients.register({
      clientName: 'Claude Desktop',
      redirectUris: ['http://127.0.0.1:33418/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
    });

    expect(result.clientId).toMatch(/^dcr_[a-f0-9]{32}$/);
    expect(result.clientSecret).toBeNull();
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SqliteOauthClientRepository — register (confidential)', () => {
  it('returns a non-null client_secret for client_secret_basic and stores only the bcrypt hash', async () => {
    const result = await storage.oauthClients.register({
      clientName: 'Server-Side MCP Client',
      redirectUris: ['https://app.example.com/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scope: 'read',
    });

    expect(result.clientSecret).not.toBeNull();
    expect(typeof result.clientSecret).toBe('string');
    // 32 random bytes → 64 hex chars
    expect(result.clientSecret!).toMatch(/^[a-f0-9]{64}$/);

    const persisted = await storage.oauthClients.findByClientId(result.clientId);
    expect(persisted).not.toBeNull();
    // Raw secret is NEVER readable from DB — only the bcrypt hash.
    expect(persisted!.clientSecretHash).not.toBeNull();
    expect(persisted!.clientSecretHash).not.toBe(result.clientSecret);
    expect(persisted!.clientSecretHash!.startsWith('$2')).toBe(true);
  });
});

describe('SqliteOauthClientRepository — findByClientId', () => {
  it('returns the persisted client with hash (not raw secret) or null for unknown id', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Test Client',
      redirectUris: ['https://x.example/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    const found = await storage.oauthClients.findByClientId(reg.clientId);
    expect(found).not.toBeNull();
    expect(found!.clientId).toBe(reg.clientId);
    expect(found!.clientName).toBe('Test Client');
    // Public client: secret hash is null (no confidential secret stored).
    expect(found!.clientSecretHash).toBeNull();

    const missing = await storage.oauthClients.findByClientId('dcr_nonexistent');
    expect(missing).toBeNull();
  });
});

describe('SqliteOauthClientRepository — verifyClientSecret', () => {
  it('returns true for the secret returned at registration, false otherwise', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Confidential',
      redirectUris: ['https://x.example/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scope: 'read',
    });

    const ok = await storage.oauthClients.verifyClientSecret(
      reg.clientId,
      reg.clientSecret!,
    );
    expect(ok).toBe(true);

    const bad = await storage.oauthClients.verifyClientSecret(
      reg.clientId,
      'not-the-real-secret',
    );
    expect(bad).toBe(false);

    // Public client (no hash) always verifies false.
    const pub = await storage.oauthClients.register({
      clientName: 'Public',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });
    const pubCheck = await storage.oauthClients.verifyClientSecret(
      pub.clientId,
      'any-secret',
    );
    expect(pubCheck).toBe(false);

    // Unknown client id always false.
    const unknown = await storage.oauthClients.verifyClientSecret(
      'dcr_nonexistent',
      'x',
    );
    expect(unknown).toBe(false);
  });
});

describe('SqliteOauthClientRepository — listByUserId', () => {
  it('returns all clients registered by the user ordered created_at DESC, empty array for unknown user', async () => {
    const user = await storage.users.createUser(
      `u-${randomUUID()}`,
      'pass123',
      'user',
    );

    const first = await storage.oauthClients.register({
      clientName: 'First',
      redirectUris: ['https://x/1'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: user.id,
    });

    // Tiny wait so created_at differs (ISO-ms precision).
    await new Promise((r) => setTimeout(r, 10));

    const second = await storage.oauthClients.register({
      clientName: 'Second',
      redirectUris: ['https://x/2'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: user.id,
    });

    const list = await storage.oauthClients.listByUserId(user.id);
    expect(list).toHaveLength(2);
    // DESC — newest first.
    expect(list[0]!.clientId).toBe(second.clientId);
    expect(list[1]!.clientId).toBe(first.clientId);

    const empty = await storage.oauthClients.listByUserId('no-such-user');
    expect(empty).toEqual([]);
  });
});

describe('SqliteOauthClientRepository — revoke (Phase 31.2 D-20 soft revoke)', () => {
  it('sets revoked_at and preserves the row (soft revoke)', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Doomed',
      redirectUris: ['https://x/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    const before = await storage.oauthClients.findByClientId(reg.clientId);
    expect(before).not.toBeNull();
    expect(before?.revokedAt).toBeNull();

    await storage.oauthClients.revoke(reg.clientId);

    // Phase 31.2 D-20: row is preserved; revokedAt is stamped so the admin
    // UI can render the Revoked badge and middleware can block in-flight
    // access tokens whose owning client is revoked.
    const after = await storage.oauthClients.findByClientId(reg.clientId);
    expect(after).not.toBeNull();
    expect(after?.revokedAt).not.toBeNull();
  });

  it('is idempotent — second revoke does not bump revoked_at', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Doomed2',
      redirectUris: ['https://x/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    await storage.oauthClients.revoke(reg.clientId);
    const first = await storage.oauthClients.findByClientId(reg.clientId);
    const firstRevokedAt = first?.revokedAt;

    await new Promise((r) => setTimeout(r, 10));
    await storage.oauthClients.revoke(reg.clientId);
    const second = await storage.oauthClients.findByClientId(reg.clientId);

    expect(second?.revokedAt).toBe(firstRevokedAt);
  });
});

describe('SqliteOauthClientRepository — findByOrg (Phase 31.2 D-19)', () => {
  // Setup shared by every test in this block:
  //   - org-A + org-B
  //   - userA (member of team-A in org-A), userB (member of team-B in org-B)
  //   - clientAlpha registered by userA
  //   - clientBeta  registered by userB
  //   - clientOrphan registered by NO user (simulates pre-D-18 backfill rows)
  async function setupOrgFixture(): Promise<{
    userAId: string;
    userBId: string;
    teamAId: string;
    teamBId: string;
    clientAlphaId: string;
    clientBetaId: string;
    clientOrphanId: string;
  }> {
    const orgA = await storage.organizations.createOrg({
      name: 'Org A', slug: `org-a-${randomUUID()}`,
    });
    const orgB = await storage.organizations.createOrg({
      name: 'Org B', slug: `org-b-${randomUUID()}`,
    });

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

    const alpha = await storage.oauthClients.register({
      clientName: 'Alpha (userA)',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
      registeredByUserId: userA.id,
    });

    const beta = await storage.oauthClients.register({
      clientName: 'Beta (userB)',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
      registeredByUserId: userB.id,
    });

    const orphan = await storage.oauthClients.register({
      clientName: 'Orphan (pre-D-18, no user)',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
      // No registeredByUserId — simulates pre-backfill row.
    });

    return {
      userAId: userA.id,
      userBId: userB.id,
      teamAId: teamA.id,
      teamBId: teamB.id,
      // orgA.id + orgB.id are re-derivable via teams, but the tests pass them
      // directly from the returned objects as captured closures.
      clientAlphaId: alpha.clientId,
      clientBetaId: beta.clientId,
      clientOrphanId: orphan.clientId,
    };
  }

  it('returns a client whose registrant is a member of a team in that org', async () => {
    const orgA = await storage.organizations.createOrg({
      name: 'Org A', slug: `org-a-${randomUUID()}`,
    });
    const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
    const teamA = await storage.teams.createTeam({
      name: 'Team A', description: '', orgId: orgA.id,
    });
    await storage.teams.addTeamMember(teamA.id, userA.id);

    const alpha = await storage.oauthClients.register({
      clientName: 'Alpha',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: userA.id,
    });

    const rows = await storage.oauthClients.findByOrg(orgA.id);
    expect(rows.map((r) => r.clientId)).toEqual([alpha.clientId]);
  });

  it('enforces cross-org isolation — a client registered in org-B is NOT returned for org-A', async () => {
    const fx = await setupOrgFixture();
    // Derive orgA id via the team created above; simpler: query it back.
    const teamA = await storage.teams.getTeam(fx.teamAId);
    const teamB = await storage.teams.getTeam(fx.teamBId);
    expect(teamA).not.toBeNull();
    expect(teamB).not.toBeNull();

    const rowsForA = await storage.oauthClients.findByOrg(teamA!.orgId);
    const clientIdsForA = rowsForA.map((r) => r.clientId);
    expect(clientIdsForA).toContain(fx.clientAlphaId);
    expect(clientIdsForA).not.toContain(fx.clientBetaId);

    const rowsForB = await storage.oauthClients.findByOrg(teamB!.orgId);
    const clientIdsForB = rowsForB.map((r) => r.clientId);
    expect(clientIdsForB).toContain(fx.clientBetaId);
    expect(clientIdsForB).not.toContain(fx.clientAlphaId);
  });

  it('excludes rows where registered_by_user_id IS NULL (pre-D-18 backfill rows — admin.system only via listAll)', async () => {
    const fx = await setupOrgFixture();
    const teamA = await storage.teams.getTeam(fx.teamAId);
    const teamB = await storage.teams.getTeam(fx.teamBId);

    const rowsForA = await storage.oauthClients.findByOrg(teamA!.orgId);
    const rowsForB = await storage.oauthClients.findByOrg(teamB!.orgId);

    expect(rowsForA.map((r) => r.clientId)).not.toContain(fx.clientOrphanId);
    expect(rowsForB.map((r) => r.clientId)).not.toContain(fx.clientOrphanId);

    // But listAll (admin.system) MUST still see the orphan row.
    const allRows = await storage.oauthClients.listAll();
    expect(allRows.map((r) => r.clientId)).toContain(fx.clientOrphanId);
  });

  it('returns an empty array for orgId="system" (admin.system uses listAll)', async () => {
    // Seed some clients so we prove emptiness is a filter, not an empty DB.
    await setupOrgFixture();

    const rows = await storage.oauthClients.findByOrg('system');
    expect(rows).toEqual([]);
  });

  it('returns a client only once even when the registrant is a member of multiple teams in the same org (DISTINCT)', async () => {
    const orgA = await storage.organizations.createOrg({
      name: 'Org A', slug: `org-a-${randomUUID()}`,
    });
    const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
    const teamA1 = await storage.teams.createTeam({
      name: 'Team A1', description: '', orgId: orgA.id,
    });
    const teamA2 = await storage.teams.createTeam({
      name: 'Team A2', description: '', orgId: orgA.id,
    });
    await storage.teams.addTeamMember(teamA1.id, userA.id);
    await storage.teams.addTeamMember(teamA2.id, userA.id);

    const alpha = await storage.oauthClients.register({
      clientName: 'Alpha',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: userA.id,
    });

    const rows = await storage.oauthClients.findByOrg(orgA.id);
    // Naive JOIN without DISTINCT would return the client twice (one row per
    // team membership). DISTINCT collapses that to a single row.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBe(alpha.clientId);
  });

  it('returns revoked rows — forward-compat for Plan 04 soft-revoke (Revoked badge rendering per D-24)', async () => {
    // Wave 1 note: repo.revoke() still performs DELETE here; Plan 04 (Wave 3)
    // will switch it to `UPDATE revoked_at`. This fixture simulates what a
    // Plan-04-soft-revoked row will look like, and asserts findByOrg's SELECT
    // does not filter on revoked_at — so that once Plan 04 lands, revoked
    // rows remain visible to the admin UI for the Revoked-badge rendering
    // (D-24). If you ever add `WHERE revoked_at IS NULL` to findByOrg, this
    // test will fail — that is by design.
    const orgA = await storage.organizations.createOrg({
      name: 'Org A', slug: `org-a-${randomUUID()}`,
    });
    const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
    const teamA = await storage.teams.createTeam({
      name: 'Team A', description: '', orgId: orgA.id,
    });
    await storage.teams.addTeamMember(teamA.id, userA.id);

    const db = storage.getRawDatabase();
    db.prepare(
      `INSERT INTO oauth_clients_v2 (
         id, client_id, client_name, client_secret_hash, scope, grant_types,
         redirect_uris, token_endpoint_auth_method, software_id, software_version,
         registered_by_user_id, created_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'row-revoked',
      'client-revoked-fixture',
      'Pre-revoked fixture',
      null,
      'read write',
      JSON.stringify(['authorization_code', 'refresh_token']),
      JSON.stringify(['http://localhost/cb']),
      'none',
      null,
      null,
      userA.id,
      new Date().toISOString(),
      '2024-01-01T00:00:00Z', // non-null revoked_at — the key of this test
    );

    const rows = await storage.oauthClients.findByOrg(orgA.id);
    expect(rows.map((r) => r.clientId)).toContain('client-revoked-fixture');
  });

  // Phase 31.2 Plan 04 Task 1 — Test 7: findByOrg rows carry registrantOrgName.
  //
  // The admin UI (/admin/clients Org column per D-24) displays the registrant's
  // org NAME, not a userId. findByOrg's SELECT must project the org name via
  // JOIN so the caller doesn't need to make N additional lookups.
  it('returns rows with registrantOrgName set to the seeded org name (Plan 04 D-24)', async () => {
    const orgA = await storage.organizations.createOrg({
      name: 'Acme Inc.', slug: `acme-${randomUUID()}`,
    });
    const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
    const teamA = await storage.teams.createTeam({
      name: 'Team A', description: '', orgId: orgA.id,
    });
    await storage.teams.addTeamMember(teamA.id, userA.id);

    const alpha = await storage.oauthClients.register({
      clientName: 'Alpha',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: userA.id,
    });

    const rows = await storage.oauthClients.findByOrg(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBe(alpha.clientId);
    // The NEW field from Plan 04: org NAME, not userId, not orgId.
    expect(rows[0]!.registrantOrgName).toBe('Acme Inc.');
  });
});

describe('SqliteOauthClientRepository — recordRegistrationUser (Phase 31.2 D-18)', () => {
  it('sets registered_by_user_id when NULL — first consent wins', async () => {
    const user = await storage.users.createUser(`u-${randomUUID()}`, 'pw', 'user');

    const reg = await storage.oauthClients.register({
      clientName: 'Orphan',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      // No registeredByUserId — simulates DCR pre-consent row.
    });
    expect((await storage.oauthClients.findByClientId(reg.clientId))!.registeredByUserId).toBeNull();

    await storage.oauthClients.recordRegistrationUser(reg.clientId, user.id);

    const after = await storage.oauthClients.findByClientId(reg.clientId);
    expect(after!.registeredByUserId).toBe(user.id);
  });

  it('does NOT overwrite a non-null registered_by_user_id — first-consent-wins IS NULL guard', async () => {
    const firstUser = await storage.users.createUser(`u-${randomUUID()}`, 'pw', 'user');
    const secondUser = await storage.users.createUser(`u-${randomUUID()}`, 'pw', 'user');

    const reg = await storage.oauthClients.register({
      clientName: 'Seeded',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: firstUser.id,
    });
    expect((await storage.oauthClients.findByClientId(reg.clientId))!.registeredByUserId).toBe(firstUser.id);

    await storage.oauthClients.recordRegistrationUser(reg.clientId, secondUser.id);

    const after = await storage.oauthClients.findByClientId(reg.clientId);
    // Later consents from OTHER users do not overwrite.
    expect(after!.registeredByUserId).toBe(firstUser.id);
  });

  it('is a no-op for a non-existent client_id', async () => {
    const user = await storage.users.createUser(`u-${randomUUID()}`, 'pw', 'user');

    // Should not throw, should not insert anything.
    await expect(
      storage.oauthClients.recordRegistrationUser('dcr_nonexistent_xxxx', user.id),
    ).resolves.toBeUndefined();

    const missing = await storage.oauthClients.findByClientId('dcr_nonexistent_xxxx');
    expect(missing).toBeNull();
  });
});

describe('SqliteOauthClientRepository — redirect_uris + grant_types JSON round-trip', () => {
  it('persists redirect_uris as a JSON array and grant_types as a JSON array; round-trip preserved', async () => {
    const redirects = [
      'http://127.0.0.1:33418/callback',
      'https://app.example.com/oauth/callback',
    ];
    const grants = ['authorization_code', 'refresh_token'];

    const reg = await storage.oauthClients.register({
      clientName: 'Multi-redirect',
      redirectUris: redirects,
      grantTypes: grants,
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
      softwareId: 'claude-desktop',
      softwareVersion: '1.0.0',
    });

    const found = await storage.oauthClients.findByClientId(reg.clientId);
    expect(found).not.toBeNull();
    expect(Array.isArray(found!.redirectUris)).toBe(true);
    expect([...found!.redirectUris]).toEqual(redirects);
    expect(Array.isArray(found!.grantTypes)).toBe(true);
    expect([...found!.grantTypes]).toEqual(grants);
    expect(found!.softwareId).toBe('claude-desktop');
    expect(found!.softwareVersion).toBe('1.0.0');
    expect(found!.scope).toBe('read write');
  });
});
