import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteRescoreProgressRepository } from '../../src/db/sqlite/repositories/rescore-progress-repository.js';
import type { RescoreProgress } from '../../src/services/rescore/rescore-types.js';

function makeTempStorage(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-rescore-progress-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

function makeProgress(orgId: string, overrides?: Partial<RescoreProgress>): RescoreProgress {
  return {
    id: randomUUID(),
    orgId,
    status: 'running',
    totalScans: 100,
    processedScans: 0,
    scoredCount: 0,
    skippedCount: 0,
    warningCount: 0,
    lastProcessedScanId: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SqliteRescoreProgressRepository', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;
  let repo: SqliteRescoreProgressRepository;

  beforeEach(() => {
    const temp = makeTempStorage();
    storage = temp.storage;
    dbPath = temp.path;
    repo = new SqliteRescoreProgressRepository(storage.getRawDatabase());
  });

  afterEach(async () => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('Test 1: Migration 046 creates rescore_progress table with correct columns', () => {
    const db = storage.getRawDatabase();
    const columns = db
      .prepare("PRAGMA table_info('rescore_progress')")
      .all() as Array<{ name: string; type: string; notnull: number }>;

    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('org_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('total_scans');
    expect(columnNames).toContain('processed_scans');
    expect(columnNames).toContain('scored_count');
    expect(columnNames).toContain('skipped_count');
    expect(columnNames).toContain('warning_count');
    expect(columnNames).toContain('last_processed_scan_id');
    expect(columnNames).toContain('error');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('Test 2: upsert creates a new row when none exists for orgId', async () => {
    const orgId = randomUUID();
    const progress = makeProgress(orgId);

    await repo.upsert(progress);

    const result = await repo.getByOrgId(orgId);
    expect(result).not.toBeNull();
    expect(result!.orgId).toBe(orgId);
    expect(result!.status).toBe('running');
    expect(result!.totalScans).toBe(100);
  });

  it('Test 3: upsert updates existing row when orgId matches', async () => {
    const orgId = randomUUID();
    const progress = makeProgress(orgId);

    await repo.upsert(progress);
    const updated = { ...progress, processedScans: 50, scoredCount: 45, updatedAt: new Date().toISOString() };
    await repo.upsert(updated);

    const result = await repo.getByOrgId(orgId);
    expect(result).not.toBeNull();
    expect(result!.processedScans).toBe(50);
    expect(result!.scoredCount).toBe(45);
  });

  it('Test 4: getByOrgId returns null when no row exists', async () => {
    const result = await repo.getByOrgId(randomUUID());
    expect(result).toBeNull();
  });

  it('Test 5: getByOrgId returns RescoreProgress when row exists', async () => {
    const orgId = randomUUID();
    const progress = makeProgress(orgId, {
      status: 'completed',
      totalScans: 200,
      processedScans: 200,
      scoredCount: 180,
      skippedCount: 15,
      warningCount: 5,
      lastProcessedScanId: 'scan-999',
    });

    await repo.upsert(progress);
    const result = await repo.getByOrgId(orgId);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(progress.id);
    expect(result!.orgId).toBe(orgId);
    expect(result!.status).toBe('completed');
    expect(result!.totalScans).toBe(200);
    expect(result!.processedScans).toBe(200);
    expect(result!.scoredCount).toBe(180);
    expect(result!.skippedCount).toBe(15);
    expect(result!.warningCount).toBe(5);
    expect(result!.lastProcessedScanId).toBe('scan-999');
    expect(result!.error).toBeNull();
    expect(result!.createdAt).toBe(progress.createdAt);
  });

  it('Test 6: deleteByOrgId removes the row', async () => {
    const orgId = randomUUID();
    await repo.upsert(makeProgress(orgId));

    await repo.deleteByOrgId(orgId);

    const result = await repo.getByOrgId(orgId);
    expect(result).toBeNull();
  });

  it('Test 7: UNIQUE constraint on org_id prevents duplicate progress rows per org', async () => {
    const orgId = randomUUID();
    const db = storage.getRawDatabase();

    // Insert directly via SQL to test constraint (not upsert which uses INSERT OR REPLACE)
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO rescore_progress (id, org_id, status, total_scans, processed_scans,
        scored_count, skipped_count, warning_count, created_at, updated_at)
       VALUES (?, ?, 'running', 0, 0, 0, 0, 0, ?, ?)`,
    ).run(randomUUID(), orgId, now, now);

    expect(() => {
      db.prepare(
        `INSERT INTO rescore_progress (id, org_id, status, total_scans, processed_scans,
          scored_count, skipped_count, warning_count, created_at, updated_at)
         VALUES (?, ?, 'running', 0, 0, 0, 0, 0, ?, ?)`,
      ).run(randomUUID(), orgId, now, now);
    }).toThrow(/UNIQUE constraint failed/);
  });
});
