/**
 * Phase 62.2 — Coordinated PR repository recomputeStatus() behavior.
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

async function seedOrg(slug: string): Promise<string> {
  const o = await storage.organizations.createOrg({ name: slug, slug });
  return o.id;
}

function setOrgFailureMode(id: string, mode: 'best_effort' | 'all_or_nothing'): void {
  const db = (storage as unknown as { getRawDatabase: () => import('better-sqlite3').Database }).getRawDatabase();
  db.prepare('UPDATE organizations SET coordinated_pr_failure_mode = ? WHERE id = ?').run(mode, id);
}

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-cpr-repo-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  orgId = await seedOrg('org_a');
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteCoordinatedPrRepository.recomputeStatus', () => {
  it('flips status to complete when every leg is opened', async () => {
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }, { siteId: 's2' }],
    });
    for (const leg of created.legs) {
      await storage.coordinatedPrs.updateLeg(leg.id, { legStatus: 'opened' });
    }
    const next = await storage.coordinatedPrs.recomputeStatus(created.pr.id);
    expect(next).toBe('complete');
    const after = await storage.coordinatedPrs.getCoordinatedPr(created.pr.id);
    expect(after?.pr.status).toBe('complete');
  });

  it('flips status to partial when best_effort mix has a failure and the rest opened', async () => {
    setOrgFailureMode(orgId, 'best_effort');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }, { siteId: 's2' }],
    });
    await storage.coordinatedPrs.updateLeg(created.legs[0].id, { legStatus: 'opened' });
    await storage.coordinatedPrs.updateLeg(created.legs[1].id, { legStatus: 'failed' });
    const next = await storage.coordinatedPrs.recomputeStatus(created.pr.id);
    expect(next).toBe('partial');
  });

  it('rolls back when all_or_nothing sees any failure', async () => {
    setOrgFailureMode(orgId, 'all_or_nothing');
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }, { siteId: 's2' }],
    });
    await storage.coordinatedPrs.updateLeg(created.legs[0].id, { legStatus: 'opened' });
    await storage.coordinatedPrs.updateLeg(created.legs[1].id, { legStatus: 'failed' });
    const next = await storage.coordinatedPrs.recomputeStatus(created.pr.id);
    expect(next).toBe('rolled_back');
    const after = await storage.coordinatedPrs.getCoordinatedPr(created.pr.id);
    expect(after?.pr.status).toBe('rolled_back');
    // The opened leg should be flipped to rolled_back; failed leg stays failed.
    const opened = after?.legs.find((l) => l.id === created.legs[0].id);
    const failed = after?.legs.find((l) => l.id === created.legs[1].id);
    expect(opened?.legStatus).toBe('rolled_back');
    expect(failed?.legStatus).toBe('failed');
  });

  it('stays opening while at least one leg is still queued', async () => {
    const created = await storage.coordinatedPrs.createCoordinatedPr({
      orgId,
      createdBy: 'seed',
      legs: [{ siteId: 's1' }, { siteId: 's2' }],
    });
    await storage.coordinatedPrs.updateLeg(created.legs[0].id, { legStatus: 'opened' });
    const next = await storage.coordinatedPrs.recomputeStatus(created.pr.id);
    expect(next).toBe('opening');
  });
});

// Phase 63.4 — cursor pagination over listForOrg.
describe('SqliteCoordinatedPrRepository.listForOrg cursor pagination', () => {
  async function seedNPrs(n: number): Promise<void> {
    const db = (storage as unknown as {
      getRawDatabase: () => import('better-sqlite3').Database;
    }).getRawDatabase();
    const stmt = db.prepare(
      `INSERT INTO coordinated_prs (id, org_id, team_id, created_by, status, summary, created_at)
       VALUES (?, ?, NULL, 'seed', 'opening', NULL, ?)`,
    );
    // Distinct created_at timestamps so DESC order is deterministic. Spaced
    // 1s apart and starting from 2020 so they never collide with other tests.
    for (let i = 0; i < n; i++) {
      const ts = new Date(Date.UTC(2020, 0, 1, 0, 0, i)).toISOString();
      stmt.run(`cpr_seed_${i.toString().padStart(3, '0')}`, orgId, ts);
    }
  }

  it('returns first page + nextCursor when more rows are available', async () => {
    await seedNPrs(7);
    const page = await storage.coordinatedPrs.listForOrg(orgId, { limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
    // DESC order — newest first.
    expect(page.items[0].createdAt > page.items[1].createdAt).toBe(true);
    expect(page.nextCursor).toBe(page.items[2].createdAt);
  });

  it('uses cursor to fetch the next page and nulls nextCursor on the last', async () => {
    await seedNPrs(5);
    const first = await storage.coordinatedPrs.listForOrg(orgId, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await storage.coordinatedPrs.listForOrg(orgId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(2);
    // No overlap between pages.
    const firstIds = new Set(first.items.map((p) => p.id));
    for (const p of second.items) {
      expect(firstIds.has(p.id)).toBe(false);
    }
    const third = await storage.coordinatedPrs.listForOrg(orgId, {
      limit: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });
});
