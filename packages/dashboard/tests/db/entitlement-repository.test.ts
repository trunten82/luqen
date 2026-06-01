import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-entitle-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  for (const p of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) if (existsSync(p)) rmSync(p);
});

async function newOrg(slug: string): Promise<string> {
  const org = await storage.organizations.createOrg({ name: slug, slug });
  return org.id;
}

describe('EntitlementRepository (Phase 80)', () => {
  it('defaults an unconfigured org to the free plan', async () => {
    const rec = await storage.entitlements.get('org-unset');
    expect(rec.plan).toBe('free');
    expect(rec.orgId).toBe('org-unset');
  });

  it('persists a plan and reads it back', async () => {
    const id = await newOrg('org-x');
    await storage.entitlements.setPlan(id, 'pro', 'admin');
    expect((await storage.entitlements.get(id)).plan).toBe('pro');
    await storage.entitlements.setPlan(id, 'agency', 'admin');
    expect((await storage.entitlements.get(id)).plan).toBe('agency');
  });

  it('normalises an unknown plan to free', async () => {
    const id = await newOrg('org-y');
    // @ts-expect-error — deliberately pass an invalid plan to assert defensive normalisation.
    await storage.entitlements.setPlan(id, 'platinum', 'admin');
    expect((await storage.entitlements.get(id)).plan).toBe('free');
  });

  it('records who updated it', async () => {
    const id = await newOrg('org-z');
    const rec = await storage.entitlements.setPlan(id, 'pro', 'user-7');
    expect(rec.updatedBy).toBe('user-7');
    expect(rec.updatedAt).not.toBe('1970-01-01T00:00:00.000Z');
  });

  it('defaults the agency partner seat (max client sites) to null', async () => {
    const rec = await storage.entitlements.get('org-none');
    expect(rec.maxClientSites ?? null).toBeNull();
  });

  it('persists and clears the agency partner seat (AGENCY-04)', async () => {
    const id = await newOrg('org-agency');
    await storage.entitlements.setPlan(id, 'agency', 'admin');
    let rec = await storage.entitlements.setMaxClientSites(id, 25, 'admin');
    expect(rec.maxClientSites).toBe(25);
    expect(rec.plan).toBe('agency'); // plan preserved when seat changes
    rec = await storage.entitlements.setMaxClientSites(id, null, 'admin');
    expect(rec.maxClientSites ?? null).toBeNull();
  });
});
