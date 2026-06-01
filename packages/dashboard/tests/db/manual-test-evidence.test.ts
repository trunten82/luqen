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

async function createTestScan(s: SqliteStorageAdapter, orgId = 'org-1'): Promise<string> {
  const id = randomUUID();
  await s.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'test-user',
    createdAt: new Date().toISOString(),
    orgId,
  });
  return id;
}

describe('ManualTestEvidenceRepository', () => {
  it('adds an evidence row and reads it back', async () => {
    const scanId = await createTestScan(storage);

    const rec = await storage.manualTestEvidence.addEvidence({
      scanId,
      criterionId: '1.1.1',
      filePath: `/uploads/org-1/evidence/${scanId}-1.1.1-shot.png`,
      fileName: 'shot.png',
      mimeType: 'image/png',
      fileSize: 1234,
      uploadedBy: 'alice',
      orgId: 'org-1',
    });

    expect(rec.id).toMatch(/^mte-/);
    expect(rec.scanId).toBe(scanId);
    expect(rec.criterionId).toBe('1.1.1');
    expect(rec.fileName).toBe('shot.png');
    expect(rec.mimeType).toBe('image/png');
    expect(rec.fileSize).toBe(1234);
    expect(rec.uploadedBy).toBe('alice');
    expect(rec.orgId).toBe('org-1');
    expect(rec.uploadedAt).toBeTruthy();

    const fetched = await storage.manualTestEvidence.getEvidence(rec.id);
    expect(fetched?.id).toBe(rec.id);
  });

  it('allows MULTIPLE evidence files per (scan, criterion)', async () => {
    const scanId = await createTestScan(storage);
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/a.png', fileName: 'a.png', orgId: 'org-1',
    });
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/b.pdf', fileName: 'b.pdf', orgId: 'org-1',
    });

    const list = await storage.manualTestEvidence.listEvidence(scanId);
    expect(list.length).toBe(2);
    expect(list.every((e) => e.criterionId === '1.1.1')).toBe(true);
  });

  it('lists evidence ordered by criterion then upload time', async () => {
    const scanId = await createTestScan(storage);
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '2.4.7', filePath: '/uploads/z.png', fileName: 'z.png', orgId: 'org-1',
    });
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/a.png', fileName: 'a.png', orgId: 'org-1',
    });

    const list = await storage.manualTestEvidence.listEvidence(scanId);
    expect(list.map((e) => e.criterionId)).toEqual(['1.1.1', '2.4.7']);
  });

  it('counts evidence per criterion', async () => {
    const scanId = await createTestScan(storage);
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/a.png', fileName: 'a.png', orgId: 'org-1',
    });
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/b.png', fileName: 'b.png', orgId: 'org-1',
    });
    await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '2.4.7', filePath: '/uploads/c.png', fileName: 'c.png', orgId: 'org-1',
    });

    const counts = await storage.manualTestEvidence.countByCriterion(scanId);
    const map = new Map(counts.map((c) => [c.criterionId, c.count]));
    expect(map.get('1.1.1')).toBe(2);
    expect(map.get('2.4.7')).toBe(1);
  });

  it('deletes an evidence row by id', async () => {
    const scanId = await createTestScan(storage);
    const rec = await storage.manualTestEvidence.addEvidence({
      scanId, criterionId: '1.1.1', filePath: '/uploads/a.png', fileName: 'a.png', orgId: 'org-1',
    });

    expect(await storage.manualTestEvidence.deleteEvidence(rec.id)).toBe(true);
    expect(await storage.manualTestEvidence.getEvidence(rec.id)).toBeNull();
    expect(await storage.manualTestEvidence.deleteEvidence(rec.id)).toBe(false);
  });

  it('returns empty list / counts for a scan with no evidence', async () => {
    const scanId = await createTestScan(storage);
    expect(await storage.manualTestEvidence.listEvidence(scanId)).toEqual([]);
    expect(await storage.manualTestEvidence.countByCriterion(scanId)).toEqual([]);
  });
});
