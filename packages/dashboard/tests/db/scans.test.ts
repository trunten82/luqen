import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

async function makeTempDb(): Promise<{ storage: SqliteStorageAdapter; path: string }> {
  const path = join(tmpdir(), `test-scans-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  await storage.migrate();
  return { storage, path };
}

describe('ScanDb', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const result = await makeTempDb();
    storage = result.storage;
    dbPath = result.path;
  });

  afterEach(async () => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createScan', () => {
    it('creates a new scan record with status queued', async () => {
      const id = randomUUID();
      const record = await storage.scans.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: ['EU'],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      });

      expect(record.id).toBe(id);
      expect(record.siteUrl).toBe('https://example.com');
      expect(record.status).toBe('queued');
      expect(record.standard).toBe('WCAG2AA');
      expect(record.jurisdictions).toEqual(['EU']);
      expect(record.createdBy).toBe('alice');
    });

    it('stores jurisdictions as JSON array', async () => {
      const id = randomUUID();
      await storage.scans.createScan({
        id,
        siteUrl: 'https://test.com',
        standard: 'WCAG2A',
        jurisdictions: ['EU', 'US', 'UK'],
        createdBy: 'bob',
        createdAt: new Date().toISOString(),
      });

      const record = await storage.scans.getScan(id);
      expect(record?.jurisdictions).toEqual(['EU', 'US', 'UK']);
    });

    it('throws when creating duplicate id', async () => {
      const id = randomUUID();
      const data = {
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      };
      await storage.scans.createScan(data);
      await expect(storage.scans.createScan(data)).rejects.toThrow();
    });
  });

  describe('getScan', () => {
    it('returns null for unknown id', async () => {
      expect(await storage.scans.getScan('non-existent')).toBeNull();
    });

    it('returns the scan record by id', async () => {
      const id = randomUUID();
      await storage.scans.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      });

      const record = await storage.scans.getScan(id);
      expect(record).not.toBeNull();
      expect(record?.id).toBe(id);
    });
  });

  describe('listScans', () => {
    it('returns empty array when no scans', async () => {
      expect(await storage.scans.listScans()).toEqual([]);
    });

    it('returns all scans ordered by created_at descending', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const base = Date.now();
      for (let i = 0; i < ids.length; i++) {
        await storage.scans.createScan({
          id: ids[i],
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'alice',
          createdAt: new Date(base + i * 1000).toISOString(),
        });
      }

      const result = await storage.scans.listScans();
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(ids[2]);
      expect(result[2].id).toBe(ids[0]);
    });

    it('filters by status', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await storage.scans.createScan({ id: id1, siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      await storage.scans.createScan({ id: id2, siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      await storage.scans.updateScan(id1, { status: 'completed' });

      const completed = await storage.scans.listScans({ status: 'completed' });
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(id1);
    });

    it('filters by siteUrl (partial match)', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await storage.scans.createScan({ id: id1, siteUrl: 'https://alpha.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      await storage.scans.createScan({ id: id2, siteUrl: 'https://beta.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });

      const result = await storage.scans.listScans({ siteUrl: 'alpha' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id1);
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.scans.createScan({
          id: randomUUID(),
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'alice',
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const page1 = await storage.scans.listScans({ limit: 2, offset: 0 });
      const page2 = await storage.scans.listScans({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('updateScan', () => {
    it('updates status to running', async () => {
      const id = randomUUID();
      await storage.scans.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      const updated = await storage.scans.updateScan(id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('updates scan metrics on completion', async () => {
      const id = randomUUID();
      await storage.scans.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      const completedAt = new Date().toISOString();
      const updated = await storage.scans.updateScan(id, {
        status: 'completed',
        completedAt,
        pagesScanned: 10,
        totalIssues: 5,
        errors: 2,
        warnings: 2,
        notices: 1,
        confirmedViolations: 1,
        jsonReportPath: '/tmp/report.json',
      });

      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBe(completedAt);
      expect(updated.pagesScanned).toBe(10);
      expect(updated.errors).toBe(2);
      expect(updated.confirmedViolations).toBe(1);
    });

    it('throws when scan not found', async () => {
      await expect(storage.scans.updateScan('non-existent', { status: 'running' })).rejects.toThrow();
    });
  });

  describe('deleteScan', () => {
    it('deletes a scan record', async () => {
      const id = randomUUID();
      await storage.scans.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      await storage.scans.deleteScan(id);
      expect(await storage.scans.getScan(id)).toBeNull();
    });

    it('does not throw when id does not exist', async () => {
      await expect(storage.scans.deleteScan('non-existent')).resolves.not.toThrow();
    });
  });

  // ── Regulation filter (07-P02) ─────────────────────────────────────────────
  describe('regulations column (07-P02)', () => {
    it('migration 039 adds scan_records.regulations as TEXT NOT NULL DEFAULT [] ', () => {
      const db = storage.getRawDatabase();
      const rows = db
        .prepare("PRAGMA table_info('scan_records')")
        .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;

      const reg = rows.find((r) => r.name === 'regulations');
      expect(reg).toBeDefined();
      expect(reg!.type.toUpperCase()).toBe('TEXT');
      expect(reg!.notnull).toBe(1);
      // SQLite stores the default as the quoted literal
      expect(reg!.dflt_value).toBe("'[]'");
    });

    it('createScan persists regulations as JSON and round-trips back as string[]', async () => {
      const id = randomUUID();
      await storage.scans.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: ['eu'],
        regulations: ['en301549', 'eu-eaa'],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      });

      const record = await storage.scans.getScan(id);
      expect(record?.regulations).toEqual(['en301549', 'eu-eaa']);
    });

    it('defaults regulations to [] when omitted from createScan', async () => {
      const id = randomUUID();
      await storage.scans.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: ['eu'],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      });

      const record = await storage.scans.getScan(id);
      expect(record?.regulations).toEqual([]);
    });
  });
});
