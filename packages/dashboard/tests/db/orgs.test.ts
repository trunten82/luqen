import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { DEFAULT_ORG_ROLES } from '../../src/permissions.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-orgs-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('OrgDb', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    storage = result.storage;
    dbPath = result.path;
  });

  afterEach(() => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createOrg', () => {
    it('creates an organization', async () => {
      const org = await storage.organizations.createOrg({ name: 'Acme Corp', slug: 'acme' });
      expect(org.name).toBe('Acme Corp');
      expect(org.slug).toBe('acme');
      expect(org.id).toBeDefined();
      expect(org.createdAt).toBeDefined();
    });

    it('rejects duplicate slugs', async () => {
      await storage.organizations.createOrg({ name: 'Acme Corp', slug: 'acme' });
      await expect(storage.organizations.createOrg({ name: 'Acme 2', slug: 'acme' })).rejects.toThrow();
    });

    it('auto-creates 4 default org roles', async () => {
      const org = await storage.organizations.createOrg({ name: 'RoleOrg', slug: 'role-org' });
      const roles = await storage.roles.listRoles(org.id);
      const orgRoles = roles.filter((r) => r.orgId === org.id);
      expect(orgRoles).toHaveLength(4);
      const names = orgRoles.map((r) => r.name).sort();
      expect(names).toEqual(['Admin', 'Member', 'Owner', 'Viewer']);
    });

    it('default org roles have correct permissions', async () => {
      const org = await storage.organizations.createOrg({ name: 'PermOrg', slug: 'perm-org' });
      const roles = await storage.roles.listRoles(org.id);
      const orgRoles = roles.filter((r) => r.orgId === org.id);

      for (const orgRole of orgRoles) {
        const expectedDef = DEFAULT_ORG_ROLES.find((d) => d.name === orgRole.name);
        expect(expectedDef).toBeDefined();
        expect(orgRole.permissions.sort()).toEqual([...expectedDef!.permissions].sort());
      }
    });

    it('default org roles are not system roles', async () => {
      const org = await storage.organizations.createOrg({ name: 'SysOrg', slug: 'sys-org' });
      const roles = await storage.roles.listRoles(org.id);
      const orgRoles = roles.filter((r) => r.orgId === org.id);
      for (const role of orgRoles) {
        expect(role.isSystem).toBe(false);
      }
    });

    it('different orgs can have roles with the same name', async () => {
      const org1 = await storage.organizations.createOrg({ name: 'Org1', slug: 'org1' });
      const org2 = await storage.organizations.createOrg({ name: 'Org2', slug: 'org2' });
      const roles1 = (await storage.roles.listRoles(org1.id)).filter((r) => r.orgId === org1.id);
      const roles2 = (await storage.roles.listRoles(org2.id)).filter((r) => r.orgId === org2.id);
      // Both orgs should have 'Owner', 'Admin', etc.
      const names1 = roles1.map((r) => r.name).sort();
      const names2 = roles2.map((r) => r.name).sort();
      expect(names1).toEqual(names2);
    });
  });

  describe('getOrg / getOrgBySlug', () => {
    it('retrieves by id', async () => {
      const created = await storage.organizations.createOrg({ name: 'Test Org', slug: 'test' });
      const found = await storage.organizations.getOrg(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Org');
    });

    it('retrieves by slug', async () => {
      await storage.organizations.createOrg({ name: 'Test Org', slug: 'test' });
      const found = await storage.organizations.getOrgBySlug('test');
      expect(found).not.toBeNull();
      expect(found!.slug).toBe('test');
    });

    it('returns null for missing org', async () => {
      expect(await storage.organizations.getOrg('nonexistent')).toBeNull();
      expect(await storage.organizations.getOrgBySlug('nope')).toBeNull();
    });
  });

  describe('listOrgs', () => {
    it('returns all orgs', async () => {
      await storage.organizations.createOrg({ name: 'Org A', slug: 'a' });
      await storage.organizations.createOrg({ name: 'Org B', slug: 'b' });
      expect(await storage.organizations.listOrgs()).toHaveLength(2);
    });
  });

  describe('deleteOrg', () => {
    it('removes org and its members', async () => {
      const org = await storage.organizations.createOrg({ name: 'Doomed', slug: 'doomed' });
      await storage.organizations.addMember(org.id, 'user-1', 'admin');
      await storage.organizations.deleteOrg(org.id);
      expect(await storage.organizations.getOrg(org.id)).toBeNull();
      expect(await storage.organizations.listMembers(org.id)).toHaveLength(0);
    });
  });

  describe('members', () => {
    it('adds and lists members', async () => {
      const org = await storage.organizations.createOrg({ name: 'Team', slug: 'team' });
      await storage.organizations.addMember(org.id, 'user-1', 'admin');
      await storage.organizations.addMember(org.id, 'user-2', 'member');
      const members = await storage.organizations.listMembers(org.id);
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe('admin');
    });

    it('removes a member', async () => {
      const org = await storage.organizations.createOrg({ name: 'Team', slug: 'team' });
      await storage.organizations.addMember(org.id, 'user-1', 'admin');
      await storage.organizations.removeMember(org.id, 'user-1');
      expect(await storage.organizations.listMembers(org.id)).toHaveLength(0);
    });

    it('lists orgs for a user', async () => {
      const org1 = await storage.organizations.createOrg({ name: 'Org 1', slug: 'o1' });
      const org2 = await storage.organizations.createOrg({ name: 'Org 2', slug: 'o2' });
      await storage.organizations.addMember(org1.id, 'user-1', 'admin');
      await storage.organizations.addMember(org2.id, 'user-1', 'member');
      const orgs = await storage.organizations.getUserOrgs('user-1');
      expect(orgs).toHaveLength(2);
    });

    it('rejects duplicate membership', async () => {
      const org = await storage.organizations.createOrg({ name: 'Team', slug: 'team' });
      await storage.organizations.addMember(org.id, 'user-1', 'admin');
      await expect(storage.organizations.addMember(org.id, 'user-1', 'member')).rejects.toThrow();
    });
  });

  describe('brand score target', () => {
    it('getBrandScoreTarget returns null by default', async () => {
      const org = await storage.organizations.createOrg({ name: 'TargetOrg', slug: 'target-org' });
      const target = await storage.organizations.getBrandScoreTarget(org.id);
      expect(target).toBeNull();
    });

    it('setBrandScoreTarget sets and getBrandScoreTarget retrieves the value', async () => {
      const org = await storage.organizations.createOrg({ name: 'TargetOrg', slug: 'target-org' });
      await storage.organizations.setBrandScoreTarget(org.id, 85);
      const target = await storage.organizations.getBrandScoreTarget(org.id);
      expect(target).toBe(85);
    });

    it('setBrandScoreTarget with null clears the target', async () => {
      const org = await storage.organizations.createOrg({ name: 'TargetOrg', slug: 'target-org' });
      await storage.organizations.setBrandScoreTarget(org.id, 85);
      await storage.organizations.setBrandScoreTarget(org.id, null);
      const target = await storage.organizations.getBrandScoreTarget(org.id);
      expect(target).toBeNull();
    });

    it('setBrandScoreTarget throws for value > 100', async () => {
      const org = await storage.organizations.createOrg({ name: 'TargetOrg', slug: 'target-org' });
      await expect(storage.organizations.setBrandScoreTarget(org.id, 101)).rejects.toThrow();
    });

    it('setBrandScoreTarget throws for value < 0', async () => {
      const org = await storage.organizations.createOrg({ name: 'TargetOrg', slug: 'target-org' });
      await expect(storage.organizations.setBrandScoreTarget(org.id, -1)).rejects.toThrow();
    });

    it('getBrandScoreTarget throws for nonexistent org', async () => {
      await expect(storage.organizations.getBrandScoreTarget('nonexistent-org')).rejects.toThrow();
    });
  });

  describe('compliance credentials', () => {
    it('getOrgComplianceCredentials returns credentials when both fields are set', async () => {
      const org = await storage.organizations.createOrg({ name: 'CompOrg', slug: 'comp-org' });
      await storage.organizations.updateOrgComplianceClient(org.id, 'client-123', 'secret-456');
      const creds = await storage.organizations.getOrgComplianceCredentials(org.id);
      expect(creds).not.toBeNull();
      expect(creds!.clientId).toBe('client-123');
      expect(creds!.clientSecret).toBe('secret-456');
    });

    it('getOrgComplianceCredentials returns null when columns are null', async () => {
      const org = await storage.organizations.createOrg({ name: 'NullOrg', slug: 'null-org' });
      const creds = await storage.organizations.getOrgComplianceCredentials(org.id);
      expect(creds).toBeNull();
    });

    it('updateOrgComplianceClient stores and retrieves credentials correctly', async () => {
      const org = await storage.organizations.createOrg({ name: 'UpdOrg', slug: 'upd-org' });

      // Initially null
      expect(await storage.organizations.getOrgComplianceCredentials(org.id)).toBeNull();

      // Store credentials
      await storage.organizations.updateOrgComplianceClient(org.id, 'id-aaa', 'sec-bbb');
      const creds1 = await storage.organizations.getOrgComplianceCredentials(org.id);
      expect(creds1).toEqual({ clientId: 'id-aaa', clientSecret: 'sec-bbb' });

      // Overwrite credentials
      await storage.organizations.updateOrgComplianceClient(org.id, 'id-ccc', 'sec-ddd');
      const creds2 = await storage.organizations.getOrgComplianceCredentials(org.id);
      expect(creds2).toEqual({ clientId: 'id-ccc', clientSecret: 'sec-ddd' });
    });
  });
});
