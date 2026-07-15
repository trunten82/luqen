/**
 * Regression (live 2026-07-15): getBrandingMode('system') threw
 * "organization not found: system", breaking branding enrichment for every
 * system-context scan. 'system' has no organizations row by design, and scans
 * can outlive their org — missing rows fall back to the platform default.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

describe('getBrandingMode fallback', () => {
  let tmpDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'luqen-bmode-'));
    storage = new SqliteStorageAdapter(join(tmpDir, 't.sqlite'));
    await storage.migrate();
  });
  afterEach(async () => {
    await storage.disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the default 'embedded' for the system pseudo-org", async () => {
    await expect(storage.organizations.getBrandingMode('system')).resolves.toBe('embedded');
  });

  it("returns the default 'embedded' for a deleted/unknown org", async () => {
    await expect(storage.organizations.getBrandingMode('gone-org')).resolves.toBe('embedded');
  });

  it('still returns the stored mode for a real org', async () => {
    const org = await storage.organizations.createOrg({ name: 'BMode', slug: 'bmode-x' });
    await storage.organizations.setBrandingMode(org.id, 'remote');
    await expect(storage.organizations.getBrandingMode(org.id)).resolves.toBe('remote');
  });
});
