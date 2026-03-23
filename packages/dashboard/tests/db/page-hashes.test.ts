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

describe('PageHashRepository', () => {
  describe('upsertPageHash', () => {
    it('creates a new page hash entry', async () => {
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/about',
        'abc123',
        'org-1',
      );

      const hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(hashes.size).toBe(1);
      expect(hashes.get('https://example.com/about')).toBe('abc123');
    });

    it('updates on conflict (same site + page + org)', async () => {
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/about',
        'hash-v1',
        'org-1',
      );
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/about',
        'hash-v2',
        'org-1',
      );

      const hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(hashes.size).toBe(1);
      expect(hashes.get('https://example.com/about')).toBe('hash-v2');
    });
  });

  describe('getPageHashes', () => {
    it('returns a Map of pageUrl to hash', async () => {
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/page1',
        'hash1',
        'org-1',
      );
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/page2',
        'hash2',
        'org-1',
      );

      const hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.size).toBe(2);
      expect(hashes.get('https://example.com/page1')).toBe('hash1');
      expect(hashes.get('https://example.com/page2')).toBe('hash2');
    });

    it('is scoped by orgId and does not return other org hashes', async () => {
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/page',
        'org1-hash',
        'org-1',
      );
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/page',
        'org2-hash',
        'org-2',
      );

      const org1Hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(org1Hashes.size).toBe(1);
      expect(org1Hashes.get('https://example.com/page')).toBe('org1-hash');

      const org2Hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-2');
      expect(org2Hashes.size).toBe(1);
      expect(org2Hashes.get('https://example.com/page')).toBe('org2-hash');
    });
  });

  describe('upsertPageHashes', () => {
    it('batch inserts multiple entries in a transaction', async () => {
      const entries = [
        { siteUrl: 'https://example.com', pageUrl: 'https://example.com/a', hash: 'hashA', orgId: 'org-1' },
        { siteUrl: 'https://example.com', pageUrl: 'https://example.com/b', hash: 'hashB', orgId: 'org-1' },
        { siteUrl: 'https://example.com', pageUrl: 'https://example.com/c', hash: 'hashC', orgId: 'org-1' },
      ];

      await storage.pageHashes.upsertPageHashes(entries);

      const hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(hashes.size).toBe(3);
      expect(hashes.get('https://example.com/a')).toBe('hashA');
      expect(hashes.get('https://example.com/b')).toBe('hashB');
      expect(hashes.get('https://example.com/c')).toBe('hashC');
    });

    it('updates existing entries on conflict during batch', async () => {
      await storage.pageHashes.upsertPageHash(
        'https://example.com',
        'https://example.com/a',
        'old-hash',
        'org-1',
      );

      await storage.pageHashes.upsertPageHashes([
        { siteUrl: 'https://example.com', pageUrl: 'https://example.com/a', hash: 'new-hash', orgId: 'org-1' },
      ]);

      const hashes = await storage.pageHashes.getPageHashes('https://example.com', 'org-1');
      expect(hashes.get('https://example.com/a')).toBe('new-hash');
    });
  });
});
