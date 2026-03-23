import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-scans-org-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('ScanDb org scoping', () => {
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

  it('defaults org_id to system', async () => {
    const scan = await storage.scans.createScan({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    });
    expect(scan.orgId).toBe('system');
  });

  it('creates scan with explicit orgId', async () => {
    const scan = await storage.scans.createScan({
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

  it('listScans filters by orgId', async () => {
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-2' });
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    const org1Scans = await storage.scans.listScans({ orgId: 'org-1' });
    expect(org1Scans).toHaveLength(1);
    expect(org1Scans[0].siteUrl).toBe('https://a.com');

    const systemScans = await storage.scans.listScans({ orgId: 'system' });
    expect(systemScans).toHaveLength(1);
  });

  it('deleteOrgScans removes all scans for an org', async () => {
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    await storage.scans.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    await storage.scans.deleteOrgScans('org-1');
    expect(await storage.scans.listScans({ orgId: 'org-1' })).toHaveLength(0);
    expect(await storage.scans.listScans({ orgId: 'system' })).toHaveLength(1);
  });
});
