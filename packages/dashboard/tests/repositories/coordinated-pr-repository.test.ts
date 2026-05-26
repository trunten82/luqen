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
