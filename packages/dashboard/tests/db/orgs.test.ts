import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { OrgDb } from '../../src/db/orgs.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-orgs-${randomUUID()}.db`);
  const scanDb = new ScanDb(path);
  scanDb.initialize();
  const orgDb = new OrgDb(scanDb.getDatabase());
  return { scanDb, orgDb, path };
}

describe('OrgDb', () => {
  let scanDb: ScanDb;
  let orgDb: OrgDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    scanDb = result.scanDb;
    orgDb = result.orgDb;
    dbPath = result.path;
  });

  afterEach(() => {
    scanDb.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createOrg', () => {
    it('creates an organization', () => {
      const org = orgDb.createOrg({ name: 'Acme Corp', slug: 'acme' });
      expect(org.name).toBe('Acme Corp');
      expect(org.slug).toBe('acme');
      expect(org.id).toBeDefined();
      expect(org.createdAt).toBeDefined();
    });

    it('rejects duplicate slugs', () => {
      orgDb.createOrg({ name: 'Acme Corp', slug: 'acme' });
      expect(() => orgDb.createOrg({ name: 'Acme 2', slug: 'acme' })).toThrow();
    });
  });

  describe('getOrg / getOrgBySlug', () => {
    it('retrieves by id', () => {
      const created = orgDb.createOrg({ name: 'Test Org', slug: 'test' });
      const found = orgDb.getOrg(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Org');
    });

    it('retrieves by slug', () => {
      orgDb.createOrg({ name: 'Test Org', slug: 'test' });
      const found = orgDb.getOrgBySlug('test');
      expect(found).not.toBeNull();
      expect(found!.slug).toBe('test');
    });

    it('returns null for missing org', () => {
      expect(orgDb.getOrg('nonexistent')).toBeNull();
      expect(orgDb.getOrgBySlug('nope')).toBeNull();
    });
  });

  describe('listOrgs', () => {
    it('returns all orgs', () => {
      orgDb.createOrg({ name: 'Org A', slug: 'a' });
      orgDb.createOrg({ name: 'Org B', slug: 'b' });
      expect(orgDb.listOrgs()).toHaveLength(2);
    });
  });

  describe('deleteOrg', () => {
    it('removes org and its members', () => {
      const org = orgDb.createOrg({ name: 'Doomed', slug: 'doomed' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.deleteOrg(org.id);
      expect(orgDb.getOrg(org.id)).toBeNull();
      expect(orgDb.listMembers(org.id)).toHaveLength(0);
    });
  });

  describe('members', () => {
    it('adds and lists members', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.addMember(org.id, 'user-2', 'member');
      const members = orgDb.listMembers(org.id);
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe('admin');
    });

    it('removes a member', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.removeMember(org.id, 'user-1');
      expect(orgDb.listMembers(org.id)).toHaveLength(0);
    });

    it('lists orgs for a user', () => {
      const org1 = orgDb.createOrg({ name: 'Org 1', slug: 'o1' });
      const org2 = orgDb.createOrg({ name: 'Org 2', slug: 'o2' });
      orgDb.addMember(org1.id, 'user-1', 'admin');
      orgDb.addMember(org2.id, 'user-1', 'member');
      const orgs = orgDb.getUserOrgs('user-1');
      expect(orgs).toHaveLength(2);
    });

    it('rejects duplicate membership', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      expect(() => orgDb.addMember(org.id, 'user-1', 'member')).toThrow();
    });
  });
});
