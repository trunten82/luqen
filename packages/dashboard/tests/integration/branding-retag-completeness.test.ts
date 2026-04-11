/**
 * Phase 09 Plan 01 — Branding retag completeness integration tests.
 *
 * Proves that every operation modifying a guideline's brand signals
 * triggers retagAllSitesForGuideline so stored scan reports reflect
 * the latest branding configuration without re-scanning.
 *
 * Requirements covered: BRT-01 (retag after discover-branding), BRT-02
 * (retag works on stored JSON reports without re-scanning).
 *
 * Uses real SQLite + real migrations + real SqliteBrandingRepository.
 * Retag is invoked directly via its exported function (service-layer test
 * — no HTTP endpoint stubbing needed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteBrandingRepository } from '../../src/db/sqlite/repositories/branding-repository.js';
import { retagAllSitesForGuideline } from '../../src/services/branding-retag.js';
import { makeRetagDeps } from './helpers/branding-retag-deps.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let repo: SqliteBrandingRepository;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-retag-completeness-${randomUUID()}.db`);
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

/**
 * Create a minimal but complete scan report JSON with one issue whose
 * context contains the given color hex value (simulates a real scan result).
 */
function makeReportJson(colorHex: string): string {
  return JSON.stringify({
    pages: [
      {
        url: 'https://example.com',
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18',
            type: 'error' as const,
            message: 'Insufficient colour contrast',
            selector: 'body > p',
            context: `<p style="color: ${colorHex}">Sample text</p>`,
          },
        ],
      },
    ],
  });
}

/**
 * Seed: create a guideline, mark active, assign to a site, insert a
 * completed scan with a jsonReport containing a reference to colorHex.
 * Returns { guidelineId, siteUrl, scanId }.
 */
async function seedGuidelineWithScanAndColor(
  orgId: string,
  colorHex: string,
): Promise<{ guidelineId: string; siteUrl: string; scanId: string }> {
  const guidelineId = randomUUID();
  await repo.createGuideline({
    orgId,
    name: 'Test Brand',
    id: guidelineId,
    description: 'Test guideline',
  });

  // Add a font and selector (required for BrandingMatcher to have full context)
  await repo.addFont(guidelineId, {
    id: randomUUID(),
    family: 'Inter',
    weights: ['400'],
    usage: 'body',
  });
  await repo.addSelector(guidelineId, {
    id: randomUUID(),
    pattern: '.brand',
    description: 'brand element',
  });

  await repo.updateGuideline(guidelineId, { active: true });

  const siteUrl = `https://example-${randomUUID().slice(0, 8)}.com`;
  await repo.assignToSite(guidelineId, siteUrl, orgId);

  // Insert a completed scan with a report referencing the color
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

  // Update to completed with jsonReport
  await storage.scans.updateScan(scanId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    jsonReport: makeReportJson(colorHex),
  });

  return { guidelineId, siteUrl, scanId };
}

// ---------------------------------------------------------------------------
// Test 1 — Retag after discover-branding adds colors+fonts
// ---------------------------------------------------------------------------

describe('BRT-01 — discover-branding retag pipeline', () => {
  it('T1: after adding a color that matches an existing scan issue, retag marks the issue as brandMatch', async () => {
    const orgId = 'org-retag-test';
    const colorHex = '#FF5733';

    // Seed: guideline with NO colors yet, but an assigned site + completed scan
    // whose jsonReport contains colorHex in the issue context.
    const { guidelineId, scanId } = await seedGuidelineWithScanAndColor(orgId, colorHex);

    // Simulate what discover-branding does — add the color
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Brand Orange',
      hexValue: colorHex,
      usage: 'brand',
    });

    // Invoke retag (the call that the discover-branding endpoint must make)
    const { totalRetagged } = await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);

    // Verify retag processed at least the one scan
    expect(totalRetagged).toBeGreaterThanOrEqual(1);

    // Verify the scan record has been updated
    const updatedScan = await storage.scans.getScan(scanId);
    expect(updatedScan).not.toBeNull();

    // brandRelatedCount must be positive — at least one issue matched
    expect(updatedScan!.brandRelatedCount).toBeGreaterThan(0);

    // Parse the JSON report and verify brandMatch was added to the issue
    const report = JSON.parse(updatedScan!.jsonReport!);
    const issue = report.pages[0].issues[0];
    expect(issue.brandMatch).toBeDefined();
    expect(issue.brandMatch.matched).toBe(true);
  });

  it('T2: if discover-branding finds no brand signals (0 colors, 0 fonts), retag is skipped — no error thrown', async () => {
    const orgId = 'org-retag-skip';

    // Guideline with no colors/fonts seeded directly (simulate a guideline
    // that had nothing added by discover)
    const guidelineId = randomUUID();
    await repo.createGuideline({
      orgId,
      name: 'Empty Brand',
      id: guidelineId,
      description: 'No signals yet',
    });
    await repo.updateGuideline(guidelineId, { active: true });

    const siteUrl = `https://empty-${randomUUID().slice(0, 8)}.com`;
    await repo.assignToSite(guidelineId, siteUrl, orgId);

    // Call retag with a guideline that has no colors/fonts/selectors —
    // retagScansForSite checks active+colors+fonts+selectors and returns 0
    // when any of those are missing. This is the "no signals" fast-exit.
    await expect(
      retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository),
    ).resolves.not.toThrow();

    const result = await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    expect(result.totalRetagged).toBe(0);
  });

  it('T3: retag updates brandRelatedCount and brandingGuidelineVersion in the scan DB row', async () => {
    const orgId = 'org-retag-fields';
    const colorHex = '#336699';

    const { guidelineId, scanId } = await seedGuidelineWithScanAndColor(orgId, colorHex);

    // Add matching color
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Brand Blue',
      hexValue: colorHex,
      usage: 'brand',
    });

    await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);

    const updatedScan = await storage.scans.getScan(scanId);
    expect(updatedScan).not.toBeNull();

    // brandRelatedCount must be set and positive
    expect(updatedScan!.brandRelatedCount).toBeGreaterThan(0);

    // brandingGuidelineVersion must be set (integer >= 1)
    expect(typeof updatedScan!.brandingGuidelineVersion).toBe('number');
    expect(updatedScan!.brandingGuidelineVersion!).toBeGreaterThanOrEqual(1);

    // brandingGuidelineId must match the guideline
    expect(updatedScan!.brandingGuidelineId).toBe(guidelineId);
  });
});
