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

describe('RepoRepository', () => {
  describe('createRepo', () => {
    it('creates a repo with all fields', async () => {
      const id = randomUUID();
      const repo = await storage.repos.createRepo({
        id,
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        repoPath: '/src',
        branch: 'develop',
        authToken: 'ghp_token123',
        createdBy: 'alice',
        orgId: 'org-1',
      });

      expect(repo.id).toBe(id);
      expect(repo.siteUrlPattern).toBe('https://example.com/%');
      expect(repo.repoUrl).toBe('https://github.com/org/repo');
      expect(repo.repoPath).toBe('/src');
      expect(repo.branch).toBe('develop');
      expect(repo.authToken).toBe('ghp_token123');
      expect(repo.createdBy).toBe('alice');
      expect(repo.orgId).toBe('org-1');
      expect(typeof repo.createdAt).toBe('string');
    });

    it('defaults branch to main and orgId to system when omitted', async () => {
      const id = randomUUID();
      const repo = await storage.repos.createRepo({
        id,
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        createdBy: 'bob',
      });

      expect(repo.branch).toBe('main');
      expect(repo.orgId).toBe('system');
      expect(repo.repoPath).toBeNull();
      expect(repo.authToken).toBeNull();
    });
  });

  describe('getRepo', () => {
    it('returns repo by ID', async () => {
      const id = randomUUID();
      await storage.repos.createRepo({
        id,
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        createdBy: 'alice',
        orgId: 'org-1',
      });

      const repo = await storage.repos.getRepo(id);
      expect(repo).not.toBeNull();
      expect(repo!.id).toBe(id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.repos.getRepo('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('listRepos', () => {
    it('returns all repos when no filter applied', async () => {
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://a.com/%',
        repoUrl: 'https://github.com/org/a',
        createdBy: 'alice',
        orgId: 'org-1',
      });
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://b.com/%',
        repoUrl: 'https://github.com/org/b',
        createdBy: 'bob',
        orgId: 'org-2',
      });

      const all = await storage.repos.listRepos();
      expect(all.length).toBe(2);
    });

    it('filters by orgId', async () => {
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://a.com/%',
        repoUrl: 'https://github.com/org/a',
        createdBy: 'alice',
        orgId: 'org-1',
      });
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://b.com/%',
        repoUrl: 'https://github.com/org/b',
        createdBy: 'bob',
        orgId: 'org-2',
      });

      const org1Repos = await storage.repos.listRepos('org-1');
      expect(org1Repos.length).toBe(1);
      expect(org1Repos[0].orgId).toBe('org-1');
    });
  });

  describe('findRepoForUrl', () => {
    it('matches using LIKE pattern', async () => {
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        createdBy: 'alice',
        orgId: 'org-1',
      });

      const found = await storage.repos.findRepoForUrl(
        'https://example.com/about',
        'org-1',
      );
      expect(found).not.toBeNull();
      expect(found!.repoUrl).toBe('https://github.com/org/repo');
    });

    it('returns null when no pattern matches', async () => {
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        createdBy: 'alice',
        orgId: 'org-1',
      });

      const result = await storage.repos.findRepoForUrl(
        'https://other.com/page',
        'org-1',
      );
      expect(result).toBeNull();
    });
  });

  describe('deleteRepo', () => {
    it('removes the repo from the database', async () => {
      const id = randomUUID();
      await storage.repos.createRepo({
        id,
        siteUrlPattern: 'https://example.com/%',
        repoUrl: 'https://github.com/org/repo',
        createdBy: 'alice',
        orgId: 'org-1',
      });

      await storage.repos.deleteRepo(id);

      const result = await storage.repos.getRepo(id);
      expect(result).toBeNull();
    });
  });
});
