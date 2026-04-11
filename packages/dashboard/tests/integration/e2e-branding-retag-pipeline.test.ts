/**
 * Phase 12 Plan 01 — E2E branding retag pipeline (E2E-01).
 *
 * End-to-end validation of the branding retag pipeline on live SQLite data:
 *   create guideline → assign site → insert scan → retag → verify brand counts.
 *
 * Requirement: E2E-01
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
import { retagAllSitesForGuideline } from '../../src/services/branding-retag.js';
import { makeRetagDeps } from './helpers/branding-retag-deps.js';

// ---------------------------------------------------------------------------
// Inline report helper — no fixtures from disk
// ---------------------------------------------------------------------------

function makeReportWithColorIssue(colorHex: string): string {
  return JSON.stringify({
    pages: [
      {
        url: 'https://retag-test.example',
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18',
            type: 'error',
            message: 'Colour contrast',
            selector: '.hero',
            context: `<div style="background:${colorHex}">text</div>`,
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Harness — shared across all describe blocks
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let repo: SqliteBrandingRepository;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-e2e-retag-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  repo = new SqliteBrandingRepository(storage.getRawDatabase());
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Scenario 1 — E2E-01 full pipeline: create → assign → scan → retag → verify
// ---------------------------------------------------------------------------

describe('E2E-01 — full pipeline: create guideline → assign site → insert scan → retag → verify brand counts', () => {
  it('after retag, brandRelatedCount > 0 and jsonReport.branding.guidelineId matches guideline', async () => {
    const orgId = 'org-e2e-retag';
    const siteUrl = 'https://retag-test.example';

    // Step 1: Create guideline with Aperol Orange
    const guidelineId = randomUUID();
    await repo.createGuideline({
      id: guidelineId,
      orgId,
      name: 'E2E Test Guideline',
      description: 'Created for E2E-01 pipeline test',
    });
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Aperol Orange',
      hexValue: '#FF5F15',
      usage: 'brand',
    });
    await repo.addFont(guidelineId, {
      id: randomUUID(),
      family: 'Inter',
      weights: ['400', '700'],
      usage: 'body',
    });
    await repo.addSelector(guidelineId, {
      id: randomUUID(),
      pattern: '.hero',
      description: 'Hero element',
    });
    await repo.updateGuideline(guidelineId, { active: true });

    // Step 2: Assign site to the guideline
    await repo.assignToSite(guidelineId, siteUrl, orgId);

    // Step 3: Insert a completed scan whose jsonReport contains '#ff5f15' in issue context
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
    await storage.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: makeReportWithColorIssue('#ff5f15'),
    });

    // Step 4: Retag
    const { totalRetagged } = await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    expect(totalRetagged).toBeGreaterThanOrEqual(1);

    // Step 5: Verify scan record updated
    const updatedScan = await storage.scans.getScan(scanId);
    expect(updatedScan).not.toBeNull();
    expect(updatedScan!.brandRelatedCount).toBeGreaterThan(0);

    // Step 6: Verify JSON report enriched with branding summary
    const report = JSON.parse(updatedScan!.jsonReport!);
    expect(report.branding).toBeDefined();
    expect(report.branding.guidelineId).toBe(guidelineId);
    expect(report.branding.brandRelatedCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Guideline update retag: add color → retag again → count increases
// ---------------------------------------------------------------------------

describe('E2E-01 — guideline update retag: add color to guideline → second retag reflects updated coverage', () => {
  it('after adding a second brand color present in a new scan, brandRelatedCount >= count after first retag', async () => {
    const orgId = 'org-e2e-retag-update';
    const siteUrl = 'https://retag-test.example';

    // Create guideline with only Aperol Orange initially
    const guidelineId = randomUUID();
    await repo.createGuideline({
      id: guidelineId,
      orgId,
      name: 'E2E Update Guideline',
      description: 'Created for guideline update scenario',
    });
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Aperol Orange',
      hexValue: '#FF5F15',
      usage: 'brand',
    });
    await repo.addFont(guidelineId, {
      id: randomUUID(),
      family: 'Inter',
      weights: ['400'],
      usage: 'body',
    });
    await repo.addSelector(guidelineId, {
      id: randomUUID(),
      pattern: '.hero',
      description: 'Hero element',
    });
    await repo.updateGuideline(guidelineId, { active: true });
    await repo.assignToSite(guidelineId, siteUrl, orgId);

    // Insert first scan with Aperol Orange issue
    const scanId1 = randomUUID();
    await storage.scans.createScan({
      id: scanId1,
      siteUrl,
      standard: 'WCAG2AA',
      jurisdictions: ['en'],
      createdBy: 'test-user',
      createdAt: new Date().toISOString(),
      orgId,
    });
    await storage.scans.updateScan(scanId1, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: makeReportWithColorIssue('#ff5f15'),
    });

    // First retag — only Orange matches
    await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    const afterFirst = await storage.scans.getScan(scanId1);
    const countAfterFirst = afterFirst!.brandRelatedCount ?? 0;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Add Aperol Amber (#FF8C00) to the guideline
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Aperol Amber',
      hexValue: '#FF8C00',
      usage: 'accent',
    });

    // Insert second scan with Aperol Amber issue
    const scanId2 = randomUUID();
    await storage.scans.createScan({
      id: scanId2,
      siteUrl,
      standard: 'WCAG2AA',
      jurisdictions: ['en'],
      createdBy: 'test-user',
      createdAt: new Date().toISOString(),
      orgId,
    });
    await storage.scans.updateScan(scanId2, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: makeReportWithColorIssue('#ff8c00'),
    });

    // Second retag — both Orange and Amber now match across two scans
    const { totalRetagged } = await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    expect(totalRetagged).toBeGreaterThanOrEqual(1);

    // Scan 2 (Amber issue) should now be brand-related
    const updatedScan2 = await storage.scans.getScan(scanId2);
    expect(updatedScan2!.brandRelatedCount).toBeGreaterThanOrEqual(countAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Idempotency: retag twice → identical brandRelatedCount
// ---------------------------------------------------------------------------

describe('E2E-01 — idempotency: running retag twice produces the same brandRelatedCount', () => {
  it('second retag produces identical brandRelatedCount — no duplication', async () => {
    const orgId = 'org-e2e-retag-idem';
    const siteUrl = 'https://retag-test.example';

    // Create guideline with Aperol Orange
    const guidelineId = randomUUID();
    await repo.createGuideline({
      id: guidelineId,
      orgId,
      name: 'E2E Idempotency Guideline',
      description: 'Created for idempotency scenario',
    });
    await repo.addColor(guidelineId, {
      id: randomUUID(),
      name: 'Aperol Orange',
      hexValue: '#FF5F15',
      usage: 'brand',
    });
    await repo.addFont(guidelineId, {
      id: randomUUID(),
      family: 'Inter',
      weights: ['400'],
      usage: 'body',
    });
    await repo.addSelector(guidelineId, {
      id: randomUUID(),
      pattern: '.hero',
      description: 'Hero element',
    });
    await repo.updateGuideline(guidelineId, { active: true });
    await repo.assignToSite(guidelineId, siteUrl, orgId);

    // Insert a completed scan with Orange issue
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
    await storage.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      jsonReport: makeReportWithColorIssue('#ff5f15'),
    });

    // First retag
    await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    const afterFirst = await storage.scans.getScan(scanId);
    const countAfterFirst = afterFirst!.brandRelatedCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second retag — should produce identical count (idempotent)
    await retagAllSitesForGuideline(storage, guidelineId, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);
    const afterSecond = await storage.scans.getScan(scanId);
    const countAfterSecond = afterSecond!.brandRelatedCount;

    expect(countAfterSecond).toBe(countAfterFirst);

    // Verify JSON report branding summary is also identical
    const reportFirst = JSON.parse(afterFirst!.jsonReport!);
    const reportSecond = JSON.parse(afterSecond!.jsonReport!);
    expect(reportSecond.branding.brandRelatedCount).toBe(reportFirst.branding.brandRelatedCount);
    expect(reportSecond.branding.guidelineId).toBe(reportFirst.branding.guidelineId);
  });
});
