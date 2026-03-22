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

async function createTestScan(
  s: SqliteStorageAdapter,
  overrides: Partial<{ orgId: string }> = {},
): Promise<string> {
  const id = randomUUID();
  await s.scans.createScan({
    id,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'test-user',
    createdAt: new Date().toISOString(),
    orgId: overrides.orgId ?? 'org-1',
  });
  return id;
}

describe('ManualTestRepository', () => {
  describe('upsertManualTest', () => {
    it('creates a new manual test result', async () => {
      const scanId = await createTestScan(storage);

      const result = await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '1.1.1',
        status: 'pass',
        notes: 'All images have alt text',
        testedBy: 'alice',
        orgId: 'org-1',
      });

      expect(result.scanId).toBe(scanId);
      expect(result.criterionId).toBe('1.1.1');
      expect(result.status).toBe('pass');
      expect(result.notes).toBe('All images have alt text');
      expect(result.testedBy).toBe('alice');
      expect(result.orgId).toBe('org-1');
      expect(result.id).toBe(`mt-${scanId}-1.1.1`);
    });

    it('updates on conflict (same scan + criterion)', async () => {
      const scanId = await createTestScan(storage);

      await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '1.1.1',
        status: 'fail',
        notes: 'Missing alt text',
        testedBy: 'alice',
        orgId: 'org-1',
      });

      const updated = await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '1.1.1',
        status: 'pass',
        notes: 'Fixed: alt text added',
        testedBy: 'bob',
        orgId: 'org-1',
      });

      expect(updated.status).toBe('pass');
      expect(updated.notes).toBe('Fixed: alt text added');
      expect(updated.testedBy).toBe('bob');

      const all = await storage.manualTests.getManualTests(scanId);
      expect(all.length).toBe(1);
    });
  });

  describe('getManualTests', () => {
    it('returns all manual test results for a scanId ordered by criterion', async () => {
      const scanId = await createTestScan(storage);

      await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '2.1.1',
        status: 'pass',
        orgId: 'org-1',
      });
      await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '1.1.1',
        status: 'fail',
        orgId: 'org-1',
      });
      await storage.manualTests.upsertManualTest({
        scanId,
        criterionId: '1.4.3',
        status: 'not-applicable',
        orgId: 'org-1',
      });

      const results = await storage.manualTests.getManualTests(scanId);
      expect(results.length).toBe(3);
      // Should be ordered by criterion_id ascending
      expect(results[0].criterionId).toBe('1.1.1');
      expect(results[1].criterionId).toBe('1.4.3');
      expect(results[2].criterionId).toBe('2.1.1');
    });

    it('returns empty array for non-existent scan', async () => {
      const results = await storage.manualTests.getManualTests('non-existent-scan-id');
      expect(results).toEqual([]);
    });
  });
});
