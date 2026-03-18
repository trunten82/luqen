import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-scans-org-${randomUUID()}.db`);
  const scanDb = new ScanDb(path);
  scanDb.initialize();
  return { scanDb, path };
}

describe('ScanDb org scoping', () => {
  let db: ScanDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    db = result.scanDb;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('defaults org_id to system', () => {
    const scan = db.createScan({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    });
    expect(scan.orgId).toBe('system');
  });

  it('creates scan with explicit orgId', () => {
    const scan = db.createScan({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
      orgId: 'org-1',
    });
    expect(scan.orgId).toBe('org-1');
  });

  it('listScans filters by orgId', () => {
    db.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-2' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    const org1Scans = db.listScans({ orgId: 'org-1' });
    expect(org1Scans).toHaveLength(1);
    expect(org1Scans[0].siteUrl).toBe('https://a.com');

    const systemScans = db.listScans({ orgId: 'system' });
    expect(systemScans).toHaveLength(1);
  });

  it('deleteOrgScans removes all scans for an org', () => {
    db.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    db.deleteOrgScans('org-1');
    expect(db.listScans({ orgId: 'org-1' })).toHaveLength(0);
    expect(db.listScans({ orgId: 'system' })).toHaveLength(1);
  });
});
