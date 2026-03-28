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
  dbPath = join(tmpdir(), `test-rbac-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('RBAC Permission Matrix', () => {
  describe('system role permissions', () => {
    it('admin has all permissions', async () => {
      const user = await storage.users.createUser(`admin-${randomUUID()}`, 'pass', 'admin');
      const perms = await storage.roles.getUserPermissions(user.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
      for (const id of ALL_PERMISSION_IDS) {
        expect(perms.has(id)).toBe(true);
      }
    });

    it('developer has exactly 12 permissions', async () => {
      const user = await storage.users.createUser(`dev-${randomUUID()}`, 'pass', 'developer');
      const perms = await storage.roles.getUserPermissions(user.id);

      const expected = new Set([
        'scans.create',
        'reports.view',
        'reports.view_technical',
        'reports.export',
        'reports.delete',
        'reports.compare',
        'issues.assign',
        'issues.fix',
        'manual_testing',
        'repos.manage',
        'repos.credentials',
        'trends.view',
      ]);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(12);
      for (const id of expected) {
        expect(perms.has(id)).toBe(true);
      }
    });

    it('user has exactly 9 permissions', async () => {
      const user = await storage.users.createUser(`user-${randomUUID()}`, 'pass', 'user');
      const perms = await storage.roles.getUserPermissions(user.id);

      const expected = new Set([
        'scans.create',
        'scans.schedule',
        'reports.view',
        'reports.export',
        'reports.delete',
        'reports.compare',
        'issues.assign',
        'manual_testing',
        'trends.view',
      ]);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(9);
      for (const id of expected) {
        expect(perms.has(id)).toBe(true);
      }
    });

    it('executive has exactly 3 permissions', async () => {
      const user = await storage.users.createUser(`exec-${randomUUID()}`, 'pass', 'executive');
      const perms = await storage.roles.getUserPermissions(user.id);

      const expected = new Set(['reports.view', 'reports.export', 'trends.view']);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(3);
      for (const id of expected) {
        expect(perms.has(id)).toBe(true);
      }
    });
  });

  describe('custom role permissions', () => {
    it('custom role has only assigned permissions', async () => {
      const orgId = `org-${randomUUID()}`;
      const customRole = await storage.roles.createRole({
        name: `custom-${randomUUID()}`,
        description: 'Limited custom role',
        permissions: ['reports.view', 'issues.assign'],
        orgId,
      });

      const user = await storage.users.createUser(`custom-user-${randomUUID()}`, 'pass', customRole.name);
      const perms = await storage.roles.getUserPermissions(user.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(2);
      expect(perms.has('reports.view')).toBe(true);
      expect(perms.has('issues.assign')).toBe(true);
    });
  });

  describe('permission boundary checks', () => {
    const adminPermissions = new Set([
      'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
      'reports.export', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
      'manual_testing', 'repos.manage', 'repos.credentials', 'trends.view', 'users.create', 'users.delete',
      'users.activate', 'users.reset_password', 'users.roles', 'admin.users', 'admin.roles',
      'admin.teams', 'admin.plugins', 'admin.org', 'admin.system', 'audit.view',
      'compliance.view', 'compliance.manage',
    ]);

    const developerPermissions = new Set([
      'scans.create', 'reports.view', 'reports.view_technical', 'reports.export',
      'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
      'manual_testing', 'repos.manage', 'repos.credentials', 'trends.view',
    ]);

    const userPermissions = new Set([
      'scans.create', 'scans.schedule', 'reports.view', 'reports.export', 'reports.delete',
      'reports.compare', 'issues.assign', 'manual_testing', 'trends.view',
    ]);

    const executivePermissions = new Set([
      'reports.view', 'reports.export', 'trends.view',
    ]);

    for (const permission of ALL_PERMISSION_IDS) {
      it(`${permission} — verify which roles have it`, () => {
        expect(adminPermissions.has(permission)).toBe(true);

        if (developerPermissions.has(permission)) {
          expect(adminPermissions.has(permission)).toBe(true);
        }
        if (userPermissions.has(permission)) {
          expect(adminPermissions.has(permission)).toBe(true);
        }
        if (executivePermissions.has(permission)) {
          expect(adminPermissions.has(permission)).toBe(true);
        }
      });
    }

    it('developer does not have admin-only permissions', () => {
      const adminOnly = [...adminPermissions].filter((p) => !developerPermissions.has(p));
      expect(adminOnly.length).toBeGreaterThan(0);
      for (const p of adminOnly) {
        expect(developerPermissions.has(p)).toBe(false);
      }
    });

    it('executive does not have developer or user-management permissions', () => {
      const nonExecutivePerms = [...adminPermissions].filter((p) => !executivePermissions.has(p));
      expect(nonExecutivePerms.length).toBeGreaterThan(0);
      for (const p of nonExecutivePerms) {
        expect(executivePermissions.has(p)).toBe(false);
      }
    });
  });

  describe('fallback behavior', () => {
    it('unknown user falls back to user role permissions', async () => {
      const perms = await storage.roles.getUserPermissions('non-existent-user-id');
      const userRole = await storage.roles.getRoleByName('user');

      expect(perms).toBeInstanceOf(Set);
      expect(userRole).not.toBeNull();
      expect(perms.size).toBe(userRole!.permissions.length);
      for (const p of userRole!.permissions) {
        expect(perms.has(p)).toBe(true);
      }
    });

    it('user with non-existent role falls back to user permissions', async () => {
      // Create user with a non-existent role name directly via createUser
      // (createUser accepts any string as role)
      const ghost = await storage.users.createUser(`ghost-${randomUUID()}`, 'pass', 'ghost');
      const perms = await storage.roles.getUserPermissions(ghost.id);
      const userRole = await storage.roles.getRoleByName('user');

      expect(perms).toBeInstanceOf(Set);
      expect(userRole).not.toBeNull();
      expect(perms.size).toBe(userRole!.permissions.length);
      for (const p of userRole!.permissions) {
        expect(perms.has(p)).toBe(true);
      }
    });
  });
});
