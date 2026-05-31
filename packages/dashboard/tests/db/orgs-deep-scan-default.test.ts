import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

function makeTempStorage(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-orgs-deep-scan-default-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('OrgRepository deep-scan default (migration 077)', () => {
  let storage: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempStorage();
    storage = result.storage;
    dbPath = result.path;
  });

  afterEach(() => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  // -------------------------------------------------------------------------
  // Default fallback — a freshly created org reports false without any
  // explicit setDeepScanDefault call. Proves migration 077 DEFAULT applied.
  // -------------------------------------------------------------------------

  it('returns false for a freshly created org (migration 077 DEFAULT)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const enabled = await storage.organizations.getDeepScanDefault(org.id);
    expect(enabled).toBe(false);
  });

  it('surfaces deepScanDefault on the Organization returned by getOrg', async () => {
    const org = await storage.organizations.createOrg({ name: 'Beta', slug: 'beta' });
    const read = await storage.organizations.getOrg(org.id);
    expect(read).not.toBeNull();
    expect(read?.deepScanDefault).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Round-trip
  // -------------------------------------------------------------------------

  it('round-trips setDeepScanDefault(true) + getDeepScanDefault', async () => {
    const org = await storage.organizations.createOrg({ name: 'Gamma', slug: 'gamma' });
    await storage.organizations.setDeepScanDefault(org.id, true);
    const enabled = await storage.organizations.getDeepScanDefault(org.id);
    expect(enabled).toBe(true);
  });

  it('reflects the new value on the Organization returned by getOrg after setDeepScanDefault', async () => {
    const org = await storage.organizations.createOrg({ name: 'Delta', slug: 'delta' });
    await storage.organizations.setDeepScanDefault(org.id, true);
    const read = await storage.organizations.getOrg(org.id);
    expect(read?.deepScanDefault).toBe(true);
  });

  it('supports reverting from true back to false (in-place mutation, not append-only)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Epsilon', slug: 'epsilon' });
    await storage.organizations.setDeepScanDefault(org.id, true);
    await storage.organizations.setDeepScanDefault(org.id, false);
    const enabled = await storage.organizations.getDeepScanDefault(org.id);
    expect(enabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Defensive errors for unknown org id (mirrors brandingMode throw behavior)
  // -------------------------------------------------------------------------

  it('throws when setDeepScanDefault is called with an unknown org id', async () => {
    await expect(
      storage.organizations.setDeepScanDefault('does-not-exist', true),
    ).rejects.toThrow(/does-not-exist/);
  });

  it('throws when getDeepScanDefault is called with an unknown org id', async () => {
    await expect(
      storage.organizations.getDeepScanDefault('does-not-exist'),
    ).rejects.toThrow(/does-not-exist/);
  });

  // -------------------------------------------------------------------------
  // listOrgs survives the OrgRow extension
  // -------------------------------------------------------------------------

  it('listOrgs returns orgs with their deepScanDefault populated', async () => {
    const a = await storage.organizations.createOrg({ name: 'ListA', slug: 'list-a' });
    const b = await storage.organizations.createOrg({ name: 'ListB', slug: 'list-b' });
    await storage.organizations.setDeepScanDefault(b.id, true);

    const all = await storage.organizations.listOrgs();
    const byId = new Map(all.map((org) => [org.id, org]));
    expect(byId.get(a.id)?.deepScanDefault).toBe(false);
    expect(byId.get(b.id)?.deepScanDefault).toBe(true);
  });
});
