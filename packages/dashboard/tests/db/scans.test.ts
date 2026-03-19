import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScanDb } from '../../src/db/scans.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

function makeTempDb(): { db: ScanDb; path: string } {
  const path = join(tmpdir(), `test-scans-${randomUUID()}.db`);
  const db = new ScanDb(path);
  db.initialize();
  return { db, path };
}

describe('ScanDb', () => {
  let db: ScanDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    db = result.db;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createScan', () => {
    it('creates a new scan record with status queued', () => {
      const id = randomUUID();
      const record = db.createScan({
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

    it('stores jurisdictions as JSON array', () => {
      const id = randomUUID();
      db.createScan({
        id,
        siteUrl: 'https://test.com',
        standard: 'WCAG2A',
        jurisdictions: ['EU', 'US', 'UK'],
        createdBy: 'bob',
        createdAt: new Date().toISOString(),
      });

      const record = db.getScan(id);
      expect(record?.jurisdictions).toEqual(['EU', 'US', 'UK']);
    });

    it('throws when creating duplicate id', () => {
      const id = randomUUID();
      const data = {
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      };
      db.createScan(data);
      expect(() => db.createScan(data)).toThrow();
    });
  });

  describe('getScan', () => {
    it('returns null for unknown id', () => {
      expect(db.getScan('non-existent')).toBeNull();
    });

    it('returns the scan record by id', () => {
      const id = randomUUID();
      db.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
      });

      const record = db.getScan(id);
      expect(record).not.toBeNull();
      expect(record?.id).toBe(id);
    });
  });

  describe('listScans', () => {
    it('returns empty array when no scans', () => {
      expect(db.listScans()).toEqual([]);
    });

    it('returns all scans ordered by created_at descending', () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const base = Date.now();
      for (let i = 0; i < ids.length; i++) {
        db.createScan({
          id: ids[i],
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'alice',
          createdAt: new Date(base + i * 1000).toISOString(),
        });
      }

      const result = db.listScans();
      expect(result).toHaveLength(3);
      // Newest first
      expect(result[0].id).toBe(ids[2]);
      expect(result[2].id).toBe(ids[0]);
    });

    it('filters by status', () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      db.createScan({ id: id1, siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      db.createScan({ id: id2, siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      db.updateScan(id1, { status: 'completed' });

      const completed = db.listScans({ status: 'completed' });
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(id1);
    });

    it('filters by siteUrl (partial match)', () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      db.createScan({ id: id1, siteUrl: 'https://alpha.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      db.createScan({ id: id2, siteUrl: 'https://beta.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });

      const result = db.listScans({ siteUrl: 'alpha' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id1);
    });

    it('respects limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        db.createScan({
          id: randomUUID(),
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'alice',
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const page1 = db.listScans({ limit: 2, offset: 0 });
      const page2 = db.listScans({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('updateScan', () => {
    it('updates status to running', () => {
      const id = randomUUID();
      db.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      const updated = db.updateScan(id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('updates scan metrics on completion', () => {
      const id = randomUUID();
      db.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      const completedAt = new Date().toISOString();
      const updated = db.updateScan(id, {
        status: 'completed',
        completedAt,
        pagesScanned: 10,
        totalIssues: 5,
        errors: 2,
        warnings: 2,
        notices: 1,
        confirmedViolations: 1,
        jsonReportPath: '/tmp/report.json',
        htmlReportPath: '/tmp/report.html',
      });

      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBe(completedAt);
      expect(updated.pagesScanned).toBe(10);
      expect(updated.errors).toBe(2);
      expect(updated.confirmedViolations).toBe(1);
    });

    it('throws when scan not found', () => {
      expect(() => db.updateScan('non-existent', { status: 'running' })).toThrow();
    });
  });

  describe('deleteScan', () => {
    it('deletes a scan record', () => {
      const id = randomUUID();
      db.createScan({ id, siteUrl: 'https://example.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'alice', createdAt: new Date().toISOString() });
      db.deleteScan(id);
      expect(db.getScan(id)).toBeNull();
    });

    it('does not throw when id does not exist', () => {
      expect(() => db.deleteScan('non-existent')).not.toThrow();
    });
  });
});
