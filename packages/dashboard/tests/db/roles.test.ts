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

describe('RoleRepository', () => {
  describe('listRoles', () => {
    it('returns 4 system roles after migration', async () => {
      const roles = await storage.roles.listRoles();
      expect(roles).toHaveLength(4);
      const names = roles.map((r) => r.name);
      expect(names).toContain('admin');
      expect(names).toContain('developer');
      expect(names).toContain('user');
      expect(names).toContain('executive');
    });

    it('includes org-specific custom roles when orgId provided', async () => {
      const orgId = 'org-test';
      await storage.roles.createRole({
        name: 'custom-role',
        description: 'A custom role',
        permissions: ['reports.view'],
        orgId,
      });

      const roles = await storage.roles.listRoles(orgId);
      const names = roles.map((r) => r.name);
      expect(names).toContain('custom-role');
      // System roles still present
      expect(names).toContain('admin');
    });

    it('is ordered by is_system DESC then name ASC', async () => {
      const orgId = 'org-ordering';
      await storage.roles.createRole({
        name: 'z-custom',
        description: 'Z custom',
        permissions: [],
        orgId,
      });
      await storage.roles.createRole({
        name: 'a-custom',
        description: 'A custom',
        permissions: [],
        orgId,
      });

      const roles = await storage.roles.listRoles(orgId);
      // System roles come first (is_system DESC)
      const systemRoles = roles.filter((r) => r.isSystem);
      const customRoles = roles.filter((r) => !r.isSystem);
      const systemIdx = roles.indexOf(systemRoles[0]!);
      const customIdx = roles.indexOf(customRoles[0]!);
      expect(systemIdx).toBeLessThan(customIdx);

      // Within custom roles, ordered by name ASC
      const customNames = customRoles.map((r) => r.name);
      expect(customNames).toEqual([...customNames].sort());
    });
  });

  describe('getRole', () => {
    it('returns role with permissions array', async () => {
      const roles = await storage.roles.listRoles();
      const adminRole = roles.find((r) => r.name === 'admin');
      expect(adminRole).toBeDefined();

      const fetched = await storage.roles.getRole(adminRole!.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('admin');
      expect(Array.isArray(fetched!.permissions)).toBe(true);
      expect(fetched!.permissions.length).toBeGreaterThan(0);
    });

    it('returns null for non-existent role', async () => {
      const result = await storage.roles.getRole('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('getRoleByName', () => {
    it('finds role by name', async () => {
      const role = await storage.roles.getRoleByName('developer');
      expect(role).not.toBeNull();
      expect(role!.name).toBe('developer');
    });

    it('returns null for unknown name', async () => {
      const role = await storage.roles.getRoleByName('no-such-role');
      expect(role).toBeNull();
    });
  });

  describe('getRolePermissions', () => {
    it('returns sorted permission list for a role', async () => {
      const devRole = await storage.roles.getRoleByName('developer');
      expect(devRole).not.toBeNull();

      const perms = await storage.roles.getRolePermissions(devRole!.id);
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBe(11);
      // Verify sorted
      expect(perms).toEqual([...perms].sort());
    });

    it('returns empty array for role with no permissions', async () => {
      const created = await storage.roles.createRole({
        name: 'empty-role',
        description: 'No perms',
        permissions: [],
        orgId: 'org-x',
      });
      const perms = await storage.roles.getRolePermissions(created.id);
      expect(perms).toEqual([]);
    });
  });

  describe('createRole', () => {
    it('creates custom role with permissions, is_system=false, scoped to orgId', async () => {
      const orgId = 'org-create';
      const role = await storage.roles.createRole({
        name: 'tester',
        description: 'QA tester role',
        permissions: ['reports.view', 'scans.create'],
        orgId,
      });

      expect(role.name).toBe('tester');
      expect(role.description).toBe('QA tester role');
      expect(role.isSystem).toBe(false);
      expect(role.orgId).toBe(orgId);
      expect(role.permissions).toContain('reports.view');
      expect(role.permissions).toContain('scans.create');
      expect(role.id).toBeDefined();
      expect(role.createdAt).toBeDefined();
    });
  });

  describe('updateRole', () => {
    it('updates description', async () => {
      const role = await storage.roles.createRole({
        name: 'updatable',
        description: 'Original',
        permissions: ['reports.view'],
        orgId: 'org-u',
      });

      await storage.roles.updateRole(role.id, { description: 'Updated desc' });

      const updated = await storage.roles.getRole(role.id);
      expect(updated!.description).toBe('Updated desc');
    });

    it('updates name for custom roles', async () => {
      const role = await storage.roles.createRole({
        name: 'old-name',
        description: 'desc',
        permissions: [],
        orgId: 'org-u',
      });

      await storage.roles.updateRole(role.id, { name: 'new-name' });

      const updated = await storage.roles.getRole(role.id);
      expect(updated!.name).toBe('new-name');
    });

    it('blocks name change for system roles', async () => {
      const adminRole = await storage.roles.getRoleByName('admin');
      expect(adminRole).not.toBeNull();

      await storage.roles.updateRole(adminRole!.id, { name: 'hacked-admin' });

      // Name should remain unchanged
      const after = await storage.roles.getRole(adminRole!.id);
      expect(after!.name).toBe('admin');
    });

    it('replaces permissions atomically', async () => {
      const role = await storage.roles.createRole({
        name: 'perm-swap',
        description: 'test',
        permissions: ['reports.view', 'scans.create'],
        orgId: 'org-u',
      });

      await storage.roles.updateRole(role.id, {
        permissions: ['trends.view', 'audit.view'],
      });

      const updated = await storage.roles.getRole(role.id);
      expect(updated!.permissions).toContain('trends.view');
      expect(updated!.permissions).toContain('audit.view');
      expect(updated!.permissions).not.toContain('reports.view');
      expect(updated!.permissions).not.toContain('scans.create');
      expect(updated!.permissions).toHaveLength(2);
    });
  });

  describe('deleteRole', () => {
    it('deletes a custom role', async () => {
      const role = await storage.roles.createRole({
        name: 'deletable',
        description: 'Will be deleted',
        permissions: [],
        orgId: 'org-d',
      });

      await storage.roles.deleteRole(role.id);

      const deleted = await storage.roles.getRole(role.id);
      expect(deleted).toBeNull();
    });

    it('throws when deleting a system role', async () => {
      const adminRole = await storage.roles.getRoleByName('admin');
      expect(adminRole).not.toBeNull();

      await expect(storage.roles.deleteRole(adminRole!.id)).rejects.toThrow();
    });

    it('throws for non-existent role', async () => {
      await expect(storage.roles.deleteRole('does-not-exist')).rejects.toThrow();
    });
  });

  describe('getUserPermissions', () => {
    it('admin gets ALL permissions (21)', async () => {
      const adminUser = await storage.users.createUser('admin-user', 'pass123', 'admin');
      const perms = await storage.roles.getUserPermissions(adminUser.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(ALL_PERMISSION_IDS.length);
      for (const permId of ALL_PERMISSION_IDS) {
        expect(perms.has(permId)).toBe(true);
      }
    });

    it('developer gets 11 permissions', async () => {
      const devUser = await storage.users.createUser('dev-user', 'pass123', 'developer');
      const perms = await storage.roles.getUserPermissions(devUser.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(11);
    });

    it('user gets 9 permissions', async () => {
      const normalUser = await storage.users.createUser('normal-user', 'pass123', 'user');
      const perms = await storage.roles.getUserPermissions(normalUser.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(9);
    });

    it('executive gets 3 permissions', async () => {
      const execUser = await storage.users.createUser('exec-user', 'pass123', 'executive');
      const perms = await storage.roles.getUserPermissions(execUser.id);

      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(3);
    });

    it('unknown user falls back to user permissions', async () => {
      const perms = await storage.roles.getUserPermissions('unknown-user-id');

      // Should fall back to 'user' role (9 permissions)
      const userRole = await storage.roles.getRoleByName('user');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(userRole!.permissions.length);
    });

    it('user with non-existent role falls back to user permissions', async () => {
      // Create a user with a role name that doesn't exist in the roles table
      const ghostRoleUser = await storage.users.createUser('ghost-role-user', 'pass123', 'ghost-role');
      const perms = await storage.roles.getUserPermissions(ghostRoleUser.id);

      const userRole = await storage.roles.getRoleByName('user');
      expect(perms).toBeInstanceOf(Set);
      expect(perms.size).toBe(userRole!.permissions.length);
    });
  });
});
