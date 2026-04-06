import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteBrandingRepository } from '../../src/db/sqlite/repositories/branding-repository.js';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Phase 08 Plan P01 — System brand guideline data foundation tests
// Covers: migration 040, listSystemGuidelines, cloneSystemGuideline,
// and the scope-aware behaviour confirmation for getGuidelineForSite.
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;
let rawDb: Database.Database;
let repo: SqliteBrandingRepository;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-branding-system-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  rawDb = storage.getRawDatabase();
  repo = new SqliteBrandingRepository(rawDb);
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

async function seedGuidelineWithChildren(
  r: SqliteBrandingRepository,
  orgId: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await r.createGuideline({ orgId, name, id, description: `${name} desc` });

  await r.addColor(id, {
    id: randomUUID(),
    name: 'primary',
    hexValue: '#ff0000',
    usage: 'brand',
  });
  await r.addColor(id, {
    id: randomUUID(),
    name: 'secondary',
    hexValue: '#00ff00',
    usage: 'accent',
  });

  await r.addFont(id, {
    id: randomUUID(),
    family: 'Inter',
    weights: ['400', '700'],
    usage: 'body',
  });

  await r.addSelector(id, {
    id: randomUUID(),
    pattern: '.hero',
    description: 'hero banner',
  });

  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqliteBrandingRepository — system brand guideline data foundation', () => {
  describe('migration 040', () => {
    it('adds cloned_from_system_guideline_id TEXT nullable column to branding_guidelines', () => {
      const rows = rawDb
        .prepare("PRAGMA table_info('branding_guidelines')")
        .all() as Array<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
        }>;

      const col = rows.find((r) => r.name === 'cloned_from_system_guideline_id');
      expect(col).toBeDefined();
      expect(col?.type.toUpperCase()).toBe('TEXT');
      expect(col?.notnull).toBe(0);
      expect(col?.dflt_value).toBeNull();
    });
  });

  describe('listSystemGuidelines', () => {
    it('returns exactly the rows with org_id = "system", ordered by name', async () => {
      await seedGuidelineWithChildren(repo, 'system', 'Beta System Brand');
      await seedGuidelineWithChildren(repo, 'system', 'Alpha System Brand');
      await seedGuidelineWithChildren(repo, 'org-a', 'Org A Brand');

      const result = await repo.listSystemGuidelines();
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('Alpha System Brand');
      expect(result[1]!.name).toBe('Beta System Brand');
      for (const g of result) {
        expect(g.orgId).toBe('system');
      }
    });

    it('returns an empty array when no system guidelines exist', async () => {
      await seedGuidelineWithChildren(repo, 'org-a', 'Org A Brand');

      const result = await repo.listSystemGuidelines();
      expect(result).toEqual([]);
    });
  });

  describe('cloneSystemGuideline', () => {
    it('clones a system guideline into a target org with fresh ids for children', async () => {
      const sourceId = await seedGuidelineWithChildren(repo, 'system', 'Default System');

      const clone = await repo.cloneSystemGuideline(sourceId, 'org-a');

      expect(clone.id).toBeTypeOf('string');
      expect(clone.id).not.toBe(sourceId);
      expect(clone.orgId).toBe('org-a');
      expect(clone.name).toBe('Default System (cloned)');
      expect(clone.clonedFromSystemGuidelineId).toBe(sourceId);
      expect(clone.colors).toHaveLength(2);
      expect(clone.fonts).toHaveLength(1);
      expect(clone.selectors).toHaveLength(1);

      // Child rows are fresh — new ids, pointing at the new guideline
      const sourceColors = await repo.listColors(sourceId);
      const cloneColorIds = new Set(clone.colors!.map((c) => c.id));
      for (const sc of sourceColors) {
        expect(cloneColorIds.has(sc.id)).toBe(false);
      }
      for (const c of clone.colors!) {
        expect(c.guidelineId).toBe(clone.id);
      }
      for (const f of clone.fonts!) {
        expect(f.guidelineId).toBe(clone.id);
      }
      for (const s of clone.selectors!) {
        expect(s.guidelineId).toBe(clone.id);
      }
    });

    it('uses the provided name override verbatim when supplied', async () => {
      const sourceId = await seedGuidelineWithChildren(repo, 'system', 'Default System');

      const clone = await repo.cloneSystemGuideline(sourceId, 'org-a', {
        name: 'Custom Clone Name',
      });

      expect(clone.name).toBe('Custom Clone Name');
      expect(clone.clonedFromSystemGuidelineId).toBe(sourceId);
    });

    it('preserves image_path from the source guideline', async () => {
      const sourceId = await seedGuidelineWithChildren(repo, 'system', 'Branded System');
      await repo.updateGuideline(sourceId, { imagePath: '/uploads/logo.png' });

      const clone = await repo.cloneSystemGuideline(sourceId, 'org-a');
      expect(clone.imagePath).toBe('/uploads/logo.png');

      // Verify round-trip via getGuideline
      const reloaded = await repo.getGuideline(clone.id);
      expect(reloaded!.imagePath).toBe('/uploads/logo.png');
    });

    it('throws a descriptive error when the source guideline is not org_id = "system"', async () => {
      const orgSourceId = await seedGuidelineWithChildren(repo, 'org-a', 'Org A Brand');

      await expect(
        repo.cloneSystemGuideline(orgSourceId, 'org-b'),
      ).rejects.toThrow(/Cannot clone non-system guideline/);
    });
  });

  describe('getGuidelineForSite with system-owned row (D-06 single code path)', () => {
    it('returns a system guideline when site_branding.guideline_id points to a system row', async () => {
      const systemId = await seedGuidelineWithChildren(repo, 'system', 'System Brand');
      await repo.assignToSite(systemId, 'https://example.com', 'org-a');

      const resolved = await repo.getGuidelineForSite('https://example.com', 'org-a');
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(systemId);
      expect(resolved!.orgId).toBe('system');
      expect(resolved!.colors).toHaveLength(2);
      expect(resolved!.fonts).toHaveLength(1);
      expect(resolved!.selectors).toHaveLength(1);
    });

    it('continues to return org-owned guidelines byte-identically (D-18)', async () => {
      const orgId = await seedGuidelineWithChildren(repo, 'org-a', 'Org A Brand');
      await repo.assignToSite(orgId, 'https://orgsite.com', 'org-a');

      const resolved = await repo.getGuidelineForSite('https://orgsite.com', 'org-a');
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(orgId);
      expect(resolved!.orgId).toBe('org-a');
    });
  });

  describe('cloned_from_system_guideline_id round-trip', () => {
    it('is populated when a cloned guideline is read back via getGuideline', async () => {
      const sourceId = await seedGuidelineWithChildren(repo, 'system', 'Default System');
      const clone = await repo.cloneSystemGuideline(sourceId, 'org-a');

      const reloaded = await repo.getGuideline(clone.id);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.clonedFromSystemGuidelineId).toBe(sourceId);
    });
  });
});
