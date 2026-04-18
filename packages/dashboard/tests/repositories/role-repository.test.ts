/**
 * Phase 30.1 — role-repository regression suite.
 *
 * Locks the post-fix contract for `SqliteRoleRepository.getUserPermissions`:
 *
 *   - Unknown sub (not a row in `dashboard_users`) → empty Set (NOT the
 *     legacy `user`-role fallback). This is the core fix that lets the
 *     scope filter in @luqen/core become authoritative for OAuth
 *     client-credentials callers.
 *   - Unknown role name on an existing user row → empty Set (defensive).
 *   - Known role → role's permissions (unchanged).
 *   - Admin role → ALL_PERMISSION_IDS (unchanged).
 *
 * Canonical harness pattern copied from tests/db/effective-permissions.test.ts:
 * in-memory-per-test SqliteStorageAdapter + applyMigrations via
 * `storage.migrate()` + seeded system roles.
 *
 * See .planning/phases/30.1-mcp-oauth-scope-gate/30.1-CONTEXT.md for the
 * locked decision (Option b — empty-set on unknown sub).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
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

describe('SqliteRoleRepository.getUserPermissions — Phase 30.1 contract', () => {
  it('returns empty Set for an unknown sub (no user-role fallback)', async () => {
    // An OAuth client-credentials token's `sub` is a clientId, NOT a
    // dashboard_users row. Post-fix: permissions resolve to empty Set so
    // @luqen/core's filterToolsByScope becomes authoritative (see
    // http-plugin.ts:137-141 ctx.permissions.size === 0 branch).
    const perms = await storage.roles.getUserPermissions('oauth-client-abc');

    expect(perms).toBeInstanceOf(Set);
    expect(perms.size).toBe(0);

    // Belt-and-braces: explicitly confirm we do NOT leak the legacy
    // `user`-role permissions by accident.
    const userRole = await storage.roles.getRoleByName('user');
    expect(userRole).not.toBeNull();
    expect(userRole!.permissions.length).toBeGreaterThan(0);
    for (const p of userRole!.permissions) {
      expect(perms.has(p)).toBe(false);
    }
  });

  it('returns empty Set for an existing user row whose role name is not registered', async () => {
    // Edge case: a user row exists but its `role` column refers to a role
    // that has been deleted from the roles table. Post-fix: empty Set
    // instead of silent `user`-role fallback.
    const ghost = await storage.users.createUser(
      'ghost-role-user',
      'pass123',
      'no-such-role',
    );

    const perms = await storage.roles.getUserPermissions(ghost.id);

    expect(perms).toBeInstanceOf(Set);
    expect(perms.size).toBe(0);
  });

  it('returns the role permissions for an existing user with a known role (regression)', async () => {
    // Sanity check — the happy path must not regress. `user` role has 10
    // perms (per tests/db/effective-permissions.test.ts comments).
    const normal = await storage.users.createUser(
      'normal-user',
      'pass123',
      'user',
    );

    const perms = await storage.roles.getUserPermissions(normal.id);

    const userRole = await storage.roles.getRoleByName('user');
    expect(userRole).not.toBeNull();
    expect(perms).toBeInstanceOf(Set);
    expect(perms.size).toBe(userRole!.permissions.length);
    for (const p of userRole!.permissions) {
      expect(perms.has(p)).toBe(true);
    }
  });

  it('returns ALL_PERMISSION_IDS for an admin user (regression)', async () => {
    // Admin shortcut at lines 187-189 is untouched by this fix.
    const admin = await storage.users.createUser(
      'admin-user',
      'pass123',
      'admin',
    );

    const perms = await storage.roles.getUserPermissions(admin.id);

    expect(perms).toBeInstanceOf(Set);
    expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
    for (const id of ALL_PERMISSION_IDS) {
      expect(perms.has(id)).toBe(true);
    }
  });
});

describe('SqliteRoleRepository.getEffectivePermissions — Phase 30.1 contract', () => {
  it('returns empty Set for an unknown sub even with an org context', async () => {
    // Downstream caller (resolveEffectivePermissions at permissions.ts:88-93)
    // delegates here for non-admin callers. The team-role join produces
    // zero rows for a non-user sub, so empty globalPerms stays empty.
    const perms = await storage.roles.getEffectivePermissions(
      'oauth-client-xyz',
      'some-org-id',
    );

    expect(perms).toBeInstanceOf(Set);
    expect(perms.size).toBe(0);
  });
});
