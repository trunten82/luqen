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

async function makeScan(orgId = 'org-1'): Promise<string> {
  const id = randomUUID();
  await storage.scans.createScan({
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

describe('ManualTestAuditRepository', () => {
  it('appends an audit row and reads it back', async () => {
    const scanId = await makeScan();
    const rec = await storage.manualTestAudit.appendAudit({
      scanId,
      criterionId: '1.1.1',
      fromStatus: 'untested',
      toStatus: 'pass',
      comment: 'All images have alt text',
      actor: 'alice',
      orgId: 'org-1',
    });
    expect(rec.id).toMatch(/^mta-/);
    expect(rec.fromStatus).toBe('untested');
    expect(rec.toStatus).toBe('pass');
    expect(rec.comment).toBe('All images have alt text');
    expect(rec.actor).toBe('alice');
    expect(rec.createdAt).toBeTruthy();
  });

  it('lists audit rows newest-first', async () => {
    const scanId = await makeScan();
    await storage.manualTestAudit.appendAudit({
      scanId, criterionId: '1.1.1', fromStatus: 'untested', toStatus: 'pass', createdAt: '2026-06-01T10:00:00.000Z', orgId: 'org-1',
    });
    await storage.manualTestAudit.appendAudit({
      scanId, criterionId: '1.1.1', fromStatus: 'pass', toStatus: 'fail', createdAt: '2026-06-01T11:00:00.000Z', orgId: 'org-1',
    });
    const list = await storage.manualTestAudit.listAudit(scanId);
    expect(list).toHaveLength(2);
    expect(list[0].toStatus).toBe('fail'); // newest first
    expect(list[1].toStatus).toBe('pass');
  });

  it('counts only reasoned (commented) changes', async () => {
    const scanId = await makeScan();
    await storage.manualTestAudit.appendAudit({ scanId, criterionId: '1.1.1', toStatus: 'pass', comment: 'reason A', orgId: 'org-1' });
    await storage.manualTestAudit.appendAudit({ scanId, criterionId: '1.3.1', toStatus: 'fail', comment: '   ', orgId: 'org-1' });
    await storage.manualTestAudit.appendAudit({ scanId, criterionId: '2.4.7', toStatus: 'na', orgId: 'org-1' });
    expect(await storage.manualTestAudit.countReasonedChanges(scanId)).toBe(1);
  });

  it('returns empty / zero for a scan with no audit rows', async () => {
    const scanId = await makeScan();
    expect(await storage.manualTestAudit.listAudit(scanId)).toEqual([]);
    expect(await storage.manualTestAudit.countReasonedChanges(scanId)).toBe(0);
  });
});
