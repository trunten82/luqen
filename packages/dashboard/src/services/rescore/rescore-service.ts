/**
 * RescoreService — batch historical rescore engine (Phase 27).
 *
 * Processes completed scans in batches of 50, recalculating brand scores
 * using the embedded calculator (calculateBrandScore). Never calls the
 * BrandingOrchestrator — always embedded mode (BRESCORE-05).
 *
 * Features:
 *   - Org-level lock: only one rescore per org at a time (D-09)
 *   - Idempotent: skips scans already having a brand_scores row (BRESCORE-02)
 *   - Resumable: tracks lastProcessedScanId for restart after crash (BRESCORE-03)
 *   - Guideline safety: deleted guidelines produce warning count, not errors (BRESCORE-04)
 *   - Progress in DB: survives server restarts
 */

import { randomUUID } from 'node:crypto';
import { BrandingMatcher } from '@luqen/branding';
import type { BrandGuideline, BrandedIssue, MatchableIssue, ColorUsage, FontUsage } from '@luqen/branding';
import { calculateBrandScore } from '../scoring/brand-score-calculator.js';
import type { RescoreProgress } from './rescore-types.js';
import type { RescoreProgressRepository } from '../../db/interfaces/rescore-progress-repository.js';
import type { BrandScoreRepository, BrandScoreScanContext } from '../../db/interfaces/brand-score-repository.js';
import type { ScanRepository } from '../../db/interfaces/scan-repository.js';
import type { BrandingRepository } from '../../db/interfaces/branding-repository.js';
import type { ScanRecord } from '../../db/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Constructor dependencies
// ---------------------------------------------------------------------------

export interface RescoreServiceDeps {
  readonly scanRepository: ScanRepository;
  readonly brandScoreRepository: BrandScoreRepository;
  readonly progressRepository: RescoreProgressRepository;
  readonly brandingRepository: Pick<BrandingRepository, 'getGuidelineForSite'>;
}

// ---------------------------------------------------------------------------
// RescoreService
// ---------------------------------------------------------------------------

export class RescoreService {
  private readonly scanRepo: ScanRepository;
  private readonly brandScoreRepo: BrandScoreRepository;
  private readonly progressRepo: RescoreProgressRepository;
  private readonly brandingRepo: Pick<BrandingRepository, 'getGuidelineForSite'>;
  private readonly matcher: BrandingMatcher;

  constructor(deps: RescoreServiceDeps) {
    this.scanRepo = deps.scanRepository;
    this.brandScoreRepo = deps.brandScoreRepository;
    this.progressRepo = deps.progressRepository;
    this.brandingRepo = deps.brandingRepository;
    this.matcher = new BrandingMatcher();
  }

  /**
   * Start a rescore for all completed scans in the org that lack a brand score.
   * Returns 'already-running' if a rescore is in progress (D-09 lock).
   * Returns 'no-candidates' if all scans already have scores.
   */
  async startRescore(
    orgId: string,
  ): Promise<{ status: 'started' | 'already-running' | 'no-candidates'; candidateCount: number }> {
    // D-09: org-level lock — check for running rescore
    const existing = await this.progressRepo.getByOrgId(orgId);
    if (existing?.status === 'running') {
      return { status: 'already-running', candidateCount: 0 };
    }

    // Clean up any stale completed/failed progress row
    if (existing) {
      await this.progressRepo.deleteByOrgId(orgId);
    }

    // Query all completed scans for this org
    const completedScans = await this.scanRepo.listScans({ orgId, status: 'completed' });

    // Count candidates: scans without an existing brand_scores row
    let candidateCount = 0;
    for (const scan of completedScans) {
      const existingScore = await this.brandScoreRepo.getLatestForScan(scan.id);
      if (existingScore === null) {
        candidateCount++;
      }
    }

    if (candidateCount === 0) {
      return { status: 'no-candidates', candidateCount: 0 };
    }

    // Create progress row
    const now = new Date().toISOString();
    const progress: RescoreProgress = {
      id: randomUUID(),
      orgId,
      status: 'running',
      totalScans: candidateCount,
      processedScans: 0,
      scoredCount: 0,
      skippedCount: 0,
      warningCount: 0,
      lastProcessedScanId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.progressRepo.upsert(progress);

    return { status: 'started', candidateCount };
  }

  /**
   * Process the next batch of up to 50 scans for the org.
   * Returns null if no rescore is running. Returns updated progress after batch.
   */
  async processNextBatch(orgId: string): Promise<RescoreProgress | null> {
    const progress = await this.progressRepo.getByOrgId(orgId);
    if (!progress || progress.status !== 'running') {
      return null;
    }

    let processedScans = progress.processedScans;
    let scoredCount = progress.scoredCount;
    let skippedCount = progress.skippedCount;
    let warningCount = progress.warningCount;
    let lastProcessedScanId = progress.lastProcessedScanId;
    let status: RescoreProgress['status'] = 'running';
    let error: string | null = null;

    try {
      // Get all completed scans for the org, ordered by creation
      const completedScans = await this.scanRepo.listScans({ orgId, status: 'completed' });

      // Skip past already-processed scans (resume point)
      const startIndex = lastProcessedScanId
        ? completedScans.findIndex((s) => s.id === lastProcessedScanId) + 1
        : 0;

      const batch = completedScans.slice(startIndex, startIndex + BATCH_SIZE);

      for (const scan of batch) {
        // BRESCORE-02: idempotent skip — scan already has a brand_scores row
        const existingScore = await this.brandScoreRepo.getLatestForScan(scan.id);
        if (existingScore !== null) {
          skippedCount++;
          processedScans++;
          lastProcessedScanId = scan.id;
          continue;
        }

        // Resolve guideline for this scan's site
        const guideline = await this.brandingRepo.getGuidelineForSite(scan.siteUrl, orgId);

        // BRESCORE-04: guideline deleted or no longer exists — warning skip
        if (!guideline || !guideline.active || !guideline.colors || !guideline.fonts || !guideline.selectors) {
          warningCount++;
          processedScans++;
          lastProcessedScanId = scan.id;
          continue;
        }

        // Project dashboard guideline to @luqen/branding BrandGuideline shape
        // (same projection as branding-retag.ts lines 37-62)
        const projectedGuideline: BrandGuideline = {
          id: guideline.id,
          orgId: guideline.orgId,
          name: guideline.name,
          version: guideline.version,
          active: guideline.active,
          colors: guideline.colors.map((c) => ({
            id: c.id,
            name: c.name,
            hexValue: c.hexValue,
            ...(c.usage ? { usage: c.usage as ColorUsage } : {}),
          })),
          fonts: guideline.fonts.map((f) => ({
            id: f.id,
            family: f.family,
            ...(f.weights ? { weights: f.weights } : {}),
            ...(f.usage ? { usage: f.usage as FontUsage } : {}),
          })),
          selectors: guideline.selectors.map((s) => ({
            id: s.id,
            pattern: s.pattern,
            ...(s.description ? { description: s.description } : {}),
          })),
        };

        // Extract issues from jsonReport and match against guideline
        const brandedIssues = this.extractAndMatchIssues(scan, projectedGuideline);

        // BRESCORE-05: embedded-only scoring via calculateBrandScore (never orchestrator)
        const scoreResult = calculateBrandScore(brandedIssues, projectedGuideline);

        // Persist the score
        const context: BrandScoreScanContext = {
          scanId: scan.id,
          orgId,
          siteUrl: scan.siteUrl,
          guidelineId: guideline.id,
          guidelineVersion: guideline.version,
          mode: 'embedded',
          brandRelatedCount: brandedIssues.filter((b) => b.brandMatch.matched).length,
          totalIssues: brandedIssues.length,
        };
        await this.brandScoreRepo.insert(scoreResult, context);

        scoredCount++;
        processedScans++;
        lastProcessedScanId = scan.id;
      }

      // Check if we've processed everything
      if (processedScans >= progress.totalScans) {
        status = 'completed';
      }
    } catch (err) {
      // T-27-04: generic error message, not stack traces
      status = 'failed';
      error = 'Batch processing failed';
    }

    // Update progress row
    const updated: RescoreProgress = {
      ...progress,
      status,
      processedScans,
      scoredCount,
      skippedCount,
      warningCount,
      lastProcessedScanId,
      error,
      updatedAt: new Date().toISOString(),
    };
    await this.progressRepo.upsert(updated);

    return updated;
  }

  /**
   * Get current rescore progress for the org.
   */
  async getProgress(orgId: string): Promise<RescoreProgress | null> {
    return this.progressRepo.getByOrgId(orgId);
  }

  /**
   * Count completed scans that lack a brand_scores row for the org.
   */
  async getCandidateCount(orgId: string): Promise<number> {
    const completedScans = await this.scanRepo.listScans({ orgId, status: 'completed' });
    let count = 0;
    for (const scan of completedScans) {
      const existingScore = await this.brandScoreRepo.getLatestForScan(scan.id);
      if (existingScore === null) {
        count++;
      }
    }
    return count;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Extract issues from a scan's jsonReport and match them against the guideline
   * using the embedded BrandingMatcher. For scans that already have brandMatch
   * data on issues, those are used directly. For pre-branding scans, the matcher
   * is run fresh.
   *
   * T-27-02: JSON.parse wrapped in try/catch — malformed reports return empty array.
   */
  private extractAndMatchIssues(scan: ScanRecord, guideline: BrandGuideline): readonly BrandedIssue[] {
    if (!scan.jsonReport) {
      return [];
    }

    try {
      const reportData = JSON.parse(scan.jsonReport);
      if (!reportData.pages) {
        return [];
      }

      // Collect all issues across pages
      const allIssues: MatchableIssue[] = [];
      for (const page of reportData.pages as Array<{ issues?: Array<Record<string, unknown>> }>) {
        for (const issue of page.issues ?? []) {
          allIssues.push(issue as unknown as MatchableIssue);
        }
      }

      if (allIssues.length === 0) {
        return [];
      }

      // Run the branding matcher to get BrandedIssue[] with brandMatch data
      return this.matcher.match(allIssues, guideline);
    } catch {
      // T-27-02: malformed JSON — skip with empty result
      return [];
    }
  }
}
