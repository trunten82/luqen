/**
 * Phase 12 Plan 03 — E2E system brand guideline org flow (E2E-03).
 *
 * End-to-end validation of the system brand guideline flow from an org's perspective:
 *   link system guideline → scan resolves it → retag works → clone → verify independence.
 *
 * Requirement: E2E-03
 * Uses: real SQLite + real migrations + real SqliteBrandingRepository.
 * No mocks, no fixtures from disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteBrandingRepository } from '../../src/db/sqlite/repositories/branding-repository.js';
import { retagScansForSite } from '../../src/services/branding-retag.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let repo: SqliteBrandingRepository;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-e2e-sys-brand-org-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  repo = new SqliteBrandingRepository(storage.getRawDatabase());
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedSystemGuideline(
  name: string,
  colorHexes: readonly string[],
): Promise<string> {
  const id = randomUUID();
  await repo.createGuideline({ orgId: 'system', name, id, description: `${name} desc` });
  for (let i = 0; i < colorHexes.length; i++) {
    await repo.addColor(id, {
      id: randomUUID(),
      name: `color-${i}`,
      hexValue: colorHexes[i]!,
      usage: i === 0 ? 'brand' : 'accent',
    });
  }
  await repo.addFont(id, {
    id: randomUUID(),
    family: 'Inter',
    weights: ['400', '700'],
    usage: 'body',
  });
  await repo.addSelector(id, {
    id: randomUUID(),
    pattern: '.hero',
    description: 'hero',
  });
  await repo.updateGuideline(id, { active: true });
  return id;
}

// ---------------------------------------------------------------------------
// Scenario 1 — Org links system guideline and getGuidelineForSite resolves live system record
// ---------------------------------------------------------------------------

describe('Scenario 1 — org links system guideline and getGuidelineForSite resolves live system record', () => {
  it('S1: getGuidelineForSite returns the system-scoped record for a linked site', async () => {
    const sysId = await seedSystemGuideline('Aperol System E2E', ['#cc0000', '#ff9900']);
    const siteUrl = 'https://sys-e2e.example';
    const orgId = 'org-e2e-sys';

    await repo.assignToSite(sysId, siteUrl, orgId);

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.orgId).toBe('system');
    expect(resolved!.id).toBe(sysId);
    expect(resolved!.colors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Scan retag works on system-linked site (no throw)
// ---------------------------------------------------------------------------

describe('Scenario 2 — scan retag works on system-linked site (no throw)', () => {
  it('S2: retagScansForSite on a system-linked site with no scans returns { retagged: 0 }', async () => {
    const sysId = await seedSystemGuideline('Aperol System E2E', ['#cc0000', '#ff9900']);
    const siteUrl = 'https://sys-e2e.example';
    const orgId = 'org-e2e-sys';

    await repo.assignToSite(sysId, siteUrl, orgId);

    const result = await retagScansForSite(storage, siteUrl, orgId);

    expect(result).toBeDefined();
    expect(result.retagged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Scan retag with real scan produces brand enrichment
// ---------------------------------------------------------------------------

describe('Scenario 3 — scan retag with real scan produces brand enrichment', () => {
  it('S3: retagScansForSite enriches a completed scan referencing a system guideline color', async () => {
    const sysId = await seedSystemGuideline('Aperol Retag E2E', ['#abcdef']);
    const siteUrl = 'https://sys-retag-e2e.example';
    const orgId = 'org-e2e-sys2';

    await repo.assignToSite(sysId, siteUrl, orgId);

    // Insert completed scan with a jsonReport containing an issue referencing #abcdef
    const scanId = randomUUID();
    await storage.scans.createScan({
      id: scanId,
      siteUrl,
      standard: 'WCAG2AA',
      jurisdictions: ['en'],
      createdBy: 'test-user',
      createdAt: new Date().toISOString(),
      orgId,
    });

    const reportJson = JSON.stringify({
      pages: [
        {
          url: siteUrl,
          issues: [
            {
              code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18',
              type: 'error',
              message: 'Colour contrast',
              selector: '.brand',
              context: '<div style="color:#abcdef">text</div>',
            },
          ],
        },
      ],
    });

    await storage.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: reportJson,
    });

    const result = await retagScansForSite(storage, siteUrl, orgId);

    expect(result.retagged).toBeGreaterThanOrEqual(1);

    const updatedScan = await storage.scans.getScan(scanId);
    expect(updatedScan).not.toBeNull();
    expect(updatedScan!.brandRelatedCount).toBeGreaterThan(0);

    const report = JSON.parse(updatedScan!.jsonReport!);
    expect(report.branding.guidelineId).toBe(sysId);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Clone produces independent org-owned copy
// ---------------------------------------------------------------------------

describe('Scenario 4 — clone produces independent org-owned copy', () => {
  it('S4: cloneSystemGuideline creates an org-scoped independent copy with clonedFromSystemGuidelineId set', async () => {
    const sysId = await seedSystemGuideline('Campari System', ['#aa0000', '#330000']);

    const clone = await repo.cloneSystemGuideline(sysId, 'org-e2e-clone');

    expect(clone.orgId).toBe('org-e2e-clone');
    expect(clone.clonedFromSystemGuidelineId).toBe(sysId);
    expect(clone.id).not.toBe(sysId);
    expect(clone.colors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Clone is independent: editing system source after clone does NOT affect clone
// ---------------------------------------------------------------------------

describe('Scenario 5 — clone is independent from system source after mutation', () => {
  it('S5: editing the system source after cloning does NOT affect the clone (independence)', async () => {
    const sysId = await seedSystemGuideline('Campari System', ['#aa0000']);
    const clone = await repo.cloneSystemGuideline(sysId, 'org-e2e-independence');

    const cloneName = clone.name;
    const cloneColorCount = clone.colors!.length;

    // Mutate the system source after cloning
    await repo.updateGuideline(sysId, { name: 'Campari System MUTATED' });
    await repo.addColor(sysId, {
      id: randomUUID(),
      name: 'extra',
      hexValue: '#ffffff',
      usage: 'accent',
    });

    // Assign the clone to a site
    const siteUrl = 'https://clone-independence-e2e.example';
    const orgId = 'org-e2e-independence';
    await repo.assignToSite(clone.id, siteUrl, orgId);

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(clone.id);
    expect(resolved!.name).toBe(cloneName);
    expect(resolved!.name).not.toBe('Campari System MUTATED');
    expect(resolved!.colors).toHaveLength(cloneColorCount);
  });
});
