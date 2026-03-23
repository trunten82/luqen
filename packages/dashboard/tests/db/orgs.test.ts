import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

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
});
