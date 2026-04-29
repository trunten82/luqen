import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import { seedBaseline } from '../../src/seed/loader.js';

// Reseed-safety regression suite — see .planning/audits/v3.3.0-reseed-safety.md
// Each test creates a system row, mutates an admin-mutable column via the
// adapter setter, runs `seedBaseline({ force: true })`, and asserts the
// admin-mutated value survives the reseed cycle.
describe('seedBaseline force-reseed preservation', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
    // Seed once to populate system rows.
    await seedBaseline(db, { force: true });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('monitored_sources', () => {
    it('preserves management_mode across force-reseed (regression of 69a1d7d)', async () => {
      const sources = await db.listSources();
      expect(sources.length).toBeGreaterThan(0);
      const target = sources[0];
      await db.updateSourceManagementMode(target.id, 'llm');

      await seedBaseline(db, { force: true });

      const after = (await db.listSources()).find((s) => s.url === target.url);
      expect(after).toBeDefined();
      expect(after?.managementMode).toBe('llm');
    });

    it('preserves status across force-reseed', async () => {
      const sources = await db.listSources();
      const target = sources[0];
      await db.updateSourceStatus(target.id, 'degraded');

      await seedBaseline(db, { force: true });

      const after = (await db.listSources()).find((s) => s.url === target.url);
      expect(after?.status).toBe('degraded');
    });
  });

  describe('regulations', () => {
    it('preserves admin-mutated name across force-reseed', async () => {
      await db.updateRegulation('EU-WAD', { name: 'EU Web Accessibility Directive (admin-renamed)' });

      await seedBaseline(db, { force: true });

      const after = await db.getRegulation('EU-WAD');
      expect(after?.name).toBe('EU Web Accessibility Directive (admin-renamed)');
    });

    it('preserves admin-mutated shortName, status, and scope across force-reseed', async () => {
      await db.updateRegulation('EU-WAD', {
        shortName: 'EU-WAD-CUSTOM',
        status: 'active',
        scope: 'public',
      });

      await seedBaseline(db, { force: true });

      const after = await db.getRegulation('EU-WAD');
      expect(after?.shortName).toBe('EU-WAD-CUSTOM');
      expect(after?.status).toBe('active');
      expect(after?.scope).toBe('public');
    });

    it('preserves admin-mutated enforcementDate across force-reseed', async () => {
      await db.updateRegulation('EU-WAD', { enforcementDate: '2030-01-01' });

      await seedBaseline(db, { force: true });

      const after = await db.getRegulation('EU-WAD');
      expect(after?.enforcementDate).toBe('2030-01-01');
    });

    it('does not corrupt regulation when no admin edits occurred', async () => {
      const before = await db.getRegulation('EU-WAD');

      await seedBaseline(db, { force: true });

      const after = await db.getRegulation('EU-WAD');
      expect(after?.name).toBe(before?.name);
      expect(after?.shortName).toBe(before?.shortName);
    });
  });

  describe('jurisdictions', () => {
    it('preserves admin-mutated name across force-reseed', async () => {
      const jurisdictions = await db.listJurisdictions();
      const target = jurisdictions.find((j) => j.id === 'EU') ?? jurisdictions[0];
      await db.updateJurisdiction(target.id, { name: 'European Union (admin-renamed)' });

      await seedBaseline(db, { force: true });

      const after = await db.getJurisdiction(target.id);
      expect(after?.name).toBe('European Union (admin-renamed)');
    });

    it('preserves admin-mutated type across force-reseed', async () => {
      const jurisdictions = await db.listJurisdictions();
      const target = jurisdictions.find((j) => j.id === 'EU') ?? jurisdictions[0];
      await db.updateJurisdiction(target.id, { type: 'supranational' });

      await seedBaseline(db, { force: true });

      const after = await db.getJurisdiction(target.id);
      expect(after?.type).toBe('supranational');
    });
  });
});
