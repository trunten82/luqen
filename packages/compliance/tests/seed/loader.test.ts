import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import { seedBaseline, getSeedStatus } from '../../src/seed/loader.js';

describe('seed loader', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('getSeedStatus', () => {
    it('returns zero counts before seeding', async () => {
      const status = await getSeedStatus(db);
      expect(status.seeded).toBe(false);
      expect(status.jurisdictions).toBe(0);
      expect(status.regulations).toBe(0);
      expect(status.requirements).toBe(0);
      expect(status.sources).toBe(0);
    });
  });

  describe('seedBaseline', () => {
    it('creates all jurisdictions, regulations, requirements', async () => {
      await seedBaseline(db);

      const status = await getSeedStatus(db);
      expect(status.seeded).toBe(true);
      expect(status.jurisdictions).toBeGreaterThanOrEqual(8);
      expect(status.regulations).toBeGreaterThanOrEqual(8);
      expect(status.requirements).toBeGreaterThanOrEqual(8);
    });

    it('creates expected jurisdictions including EU, US, UK', async () => {
      await seedBaseline(db);

      const eu = await db.getJurisdiction('EU');
      const us = await db.getJurisdiction('US');
      const uk = await db.getJurisdiction('UK');

      expect(eu).not.toBeNull();
      expect(eu!.type).toBe('supranational');
      expect(us).not.toBeNull();
      expect(us!.type).toBe('country');
      expect(uk).not.toBeNull();
    });

    it('creates DE and FR as children of EU', async () => {
      await seedBaseline(db);

      const de = await db.getJurisdiction('DE');
      const fr = await db.getJurisdiction('FR');

      expect(de!.parentId).toBe('EU');
      expect(fr!.parentId).toBe('EU');
    });

    it('creates EU EAA and WAD regulations', async () => {
      await seedBaseline(db);

      const regs = await db.listRegulations({ jurisdictionId: 'EU' });
      const shortNames = regs.map((r) => r.shortName);
      expect(shortNames).toContain('EAA');
      expect(shortNames).toContain('WAD');
    });

    it('seeds monitored sources from regulation URLs', async () => {
      await seedBaseline(db);

      const sources = await db.listSources();
      // Should have at least the EU EAA and WAD sources
      expect(sources.length).toBeGreaterThanOrEqual(2);

      const urls = sources.map((s) => s.url);
      expect(urls).toContain('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0882');
      expect(urls).toContain('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016L2102');

      // All sources should be html type with weekly schedule
      for (const source of sources) {
        expect(source.type).toBe('html');
        expect(source.schedule).toBe('weekly');
      }
    });

    it('is idempotent — running twice does not create duplicates', async () => {
      await seedBaseline(db);
      await seedBaseline(db);

      const status = await getSeedStatus(db);
      // Count should be the same as after one run
      const statusAfterFirst = await getSeedStatus(db);
      expect(status.jurisdictions).toBe(statusAfterFirst.jurisdictions);
      expect(status.regulations).toBe(statusAfterFirst.regulations);
      expect(status.requirements).toBe(statusAfterFirst.requirements);
      expect(status.sources).toBe(statusAfterFirst.sources);
    });

    it('creates requirements with correct WCAG versions', async () => {
      await seedBaseline(db);

      // Section 508 should require WCAG 2.0
      const regs508 = await db.listRegulations({ jurisdictionId: 'US' });
      const section508 = regs508.find((r) => r.shortName === 'Section 508');
      expect(section508).toBeDefined();

      const reqs = await db.listRequirements({ regulationId: section508!.id });
      expect(reqs.length).toBeGreaterThan(0);
      expect(reqs[0].wcagVersion).toBe('2.0');
    });
  });
});
