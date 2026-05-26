/**
 * Phase 63.4 — Bulk-fix repository cursor pagination.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let orgId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-bfx-repo-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const o = await storage.organizations.createOrg({ name: 'bfx_org', slug: 'bfx_org' });
  orgId = o.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

async function seedNBulkFixes(n: number): Promise<void> {
  const db = (storage as unknown as {
    getRawDatabase: () => import('better-sqlite3').Database;
  }).getRawDatabase();
  const stmt = db.prepare(
    `INSERT INTO bulk_fixes (id, org_id, team_id, created_by, criterion, summary, status, coordinated_pr_id, created_at)
     VALUES (?, ?, NULL, 'seed', '1.1.1', NULL, 'draft', NULL, ?)`,
  );
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2021, 0, 1, 0, 0, i)).toISOString();
    stmt.run(`bfx_seed_${i.toString().padStart(3, '0')}`, orgId, ts);
  }
}

describe('SqliteBulkFixRepository.listForOrg cursor pagination', () => {
  it('returns first page + nextCursor when more rows exist', async () => {
    await seedNBulkFixes(6);
    const page = await storage.bulkFixes.listForOrg(orgId, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items[0].createdAt > page.items[1].createdAt).toBe(true);
    expect(page.nextCursor).toBe(page.items[1].createdAt);
  });

  it('cursor advances across pages and nulls on the last page', async () => {
    await seedNBulkFixes(5);
    const p1 = await storage.bulkFixes.listForOrg(orgId, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    const p2 = await storage.bulkFixes.listForOrg(orgId, {
      limit: 2,
      cursor: p1.nextCursor ?? undefined,
    });
    expect(p2.items).toHaveLength(2);
    // No overlap.
    const seen = new Set(p1.items.map((b) => b.id));
    for (const b of p2.items) expect(seen.has(b.id)).toBe(false);
    const p3 = await storage.bulkFixes.listForOrg(orgId, {
      limit: 2,
      cursor: p2.nextCursor ?? undefined,
    });
    expect(p3.items).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();
  });
});
