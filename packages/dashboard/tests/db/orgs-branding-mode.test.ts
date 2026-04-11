import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

function makeTempStorage(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-orgs-branding-mode-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('OrgRepository branding mode (16-P03)', () => {
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
  // Default fallback — a freshly created org reports 'embedded' without any
  // explicit setBrandingMode call. Proves migration 043 DEFAULT applied.
  // -------------------------------------------------------------------------

  it('returns embedded for a freshly created org (migration 043 DEFAULT)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const mode = await storage.organizations.getBrandingMode(org.id);
    expect(mode).toBe('embedded');
  });

  it('surfaces brandingMode on the Organization returned by getOrg', async () => {
    const org = await storage.organizations.createOrg({ name: 'Beta', slug: 'beta' });
    const read = await storage.organizations.getOrg(org.id);
    expect(read).not.toBeNull();
    expect(read?.brandingMode).toBe('embedded');
  });

  // -------------------------------------------------------------------------
  // Round-trip for both literal values
  // -------------------------------------------------------------------------

  it('round-trips setBrandingMode(remote) + getBrandingMode', async () => {
    const org = await storage.organizations.createOrg({ name: 'Gamma', slug: 'gamma' });
    await storage.organizations.setBrandingMode(org.id, 'remote');
    const mode = await storage.organizations.getBrandingMode(org.id);
    expect(mode).toBe('remote');
  });

  it('reflects the new mode on the Organization returned by getOrg after setBrandingMode', async () => {
    const org = await storage.organizations.createOrg({ name: 'Delta', slug: 'delta' });
    await storage.organizations.setBrandingMode(org.id, 'remote');
    const read = await storage.organizations.getOrg(org.id);
    expect(read?.brandingMode).toBe('remote');
  });

  it('supports reverting from remote back to embedded (in-place mutation, not append-only)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Epsilon', slug: 'epsilon' });
    await storage.organizations.setBrandingMode(org.id, 'remote');
    await storage.organizations.setBrandingMode(org.id, 'embedded');
    const mode = await storage.organizations.getBrandingMode(org.id);
    expect(mode).toBe('embedded');
  });

  // -------------------------------------------------------------------------
  // Defensive errors for unknown org id
  // -------------------------------------------------------------------------

  it('throws when setBrandingMode is called with an unknown org id', async () => {
    await expect(
      storage.organizations.setBrandingMode('does-not-exist', 'remote'),
    ).rejects.toThrow(/does-not-exist/);
  });

  it('throws when getBrandingMode is called with an unknown org id', async () => {
    await expect(
      storage.organizations.getBrandingMode('does-not-exist'),
    ).rejects.toThrow(/does-not-exist/);
  });

  // -------------------------------------------------------------------------
  // Defense in depth: narrowBrandingMode rejects schema drift
  // -------------------------------------------------------------------------

  it('throws on read when branding_mode holds an unexpected value (defense in depth)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Zeta', slug: 'zeta' });
    const db = storage.getRawDatabase();
    // Bypass the typed setter to simulate a schema drift where a different
    // writer inserts a bogus value
    db.prepare("UPDATE organizations SET branding_mode = 'legacy' WHERE id = ?").run(org.id);

    await expect(
      storage.organizations.getBrandingMode(org.id),
    ).rejects.toThrow(/unexpected value: legacy/);
  });

  // -------------------------------------------------------------------------
  // Fail-fast on corrupt row in list reads (LOCKED decision, see Task 2 Edit 2)
  // -------------------------------------------------------------------------

  it('listOrgs fails fast when any row has a corrupt branding_mode', async () => {
    const goodOrg = await storage.organizations.createOrg({ name: 'Good Org', slug: 'good-org' });
    const badOrg = await storage.organizations.createOrg({ name: 'Bad Org', slug: 'bad-org' });
    // Corrupt one row out-of-band (bypassing the typed setBrandingMode)
    const db = storage.getRawDatabase();
    db.prepare("UPDATE organizations SET branding_mode = 'invalid' WHERE id = ?").run(badOrg.id);

    await expect(storage.organizations.listOrgs()).rejects.toThrow(/branding_mode/i);
    // goodOrg is referenced to prevent linters flagging it as unused; the test
    // intentionally asserts the entire list call dies rather than returning goodOrg.
    expect(goodOrg.id).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // listOrgs survives the OrgRow extension
  // -------------------------------------------------------------------------

  it('listOrgs returns orgs with their brandingMode populated', async () => {
    const a = await storage.organizations.createOrg({ name: 'ListA', slug: 'list-a' });
    const b = await storage.organizations.createOrg({ name: 'ListB', slug: 'list-b' });
    await storage.organizations.setBrandingMode(b.id, 'remote');

    const all = await storage.organizations.listOrgs();
    const byId = new Map(all.map((org) => [org.id, org]));
    expect(byId.get(a.id)?.brandingMode).toBe('embedded');
    expect(byId.get(b.id)?.brandingMode).toBe('remote');
  });
});
