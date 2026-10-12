/**
 * The ONE shared Phase 88 fixture (D-06): a Fabrikam site report, the stored
 * compliance blob that goes with it, dismissal matches, seed helpers, expected
 * counts and string-level absence assertions.
 *
 * Factories only — no shared mutable state. Every call returns fresh objects.
 * Public repo: Fabrikam / Northwind placeholders and `.example` hosts only, no
 * customer names, real site URLs, scan ids or org ids (P10).
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { IssueDismissal } from '../../src/db/interfaces/issue-dismissal-repository.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';
import { countIssues } from '../../src/services/count-issues.js';

// ── Sites ────────────────────────────────────────────────────────────────────
export const FABRIKAM_SITE = 'https://fabrikam.example/shop/';
/** Same toSiteKey as FABRIKAM_SITE (host case + trailing slash). */
export const FABRIKAM_SITE_VARIANT = 'https://FABRIKAM.example/shop';
export const FABRIKAM_OTHER_SITE = 'https://fabrikam.example/blog/';

// ── WCAG codes ───────────────────────────────────────────────────────────────
export const CODE_CONTRAST = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail'; // 1.4.3
export const CODE_ALT = 'WCAG2A.Principle1.Guideline1_1.1_1_1.H37'; // 1.1.1
export const CODE_LINK = 'WCAG2A.Principle2.Guideline2_4.2_4_4.H77'; // 2.4.4
export const CODE_FALLBACK = 'lighthouse.fallback';

// ── Selectors (no HTML-special characters: greppable in JSON, HTML, CSV, xlsx) ─
export const SEL_DISMISSED = '#fabrikam-promo-note';
export const SEL_SIBLING = '#fabrikam-footer-note';
export const SEL_ALT = '#fabrikam-hero-img';
export const SEL_LINK = '#fabrikam-more-link';
/** The reason every seeded dismissal carries; absent from non-reason surfaces. */
export const REASON_TOKEN = 'Fabrikam-reason-7c1e';

// ── Fixed clock (golden determinism) ─────────────────────────────────────────
export const FIXED_NOW = '2026-10-01T12:00:00.000Z';
export const FIXED_CREATED_AT = '2026-10-01T10:00:00.000Z';
export const FIXED_COMPLETED_AT = '2026-10-01T10:05:00.000Z';
export const FIXED_SCAN_ID = 'scan-fabrikam-golden-0001';

/** Fake ONLY Date (Fastify/sqlite timers keep working) at FIXED_NOW. */
export function useFixedClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(FIXED_NOW) });
}
export function restoreClock(): void {
  vi.useRealTimers();
}

// ── Dismissal matches ────────────────────────────────────────────────────────
/** 3 occurrences; 1.4.3 keeps failing through the sibling (SEL_SIBLING). */
export const DISMISS_PARTIAL = { code: CODE_CONTRAST, selector: SEL_DISMISSED } as const;
/** 1 occurrence; 1.1.1 loses its only finding. */
export const DISMISS_WHOLE = { code: CODE_ALT, selector: SEL_ALT } as const;

export interface ExpectedCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
  readonly total: number;
}
export const RAW_COUNTS: ExpectedCounts = { errors: 5, warnings: 2, notices: 1, total: 8 };
export const AFTER_PARTIAL: ExpectedCounts = { errors: 2, warnings: 2, notices: 1, total: 5 };
export const AFTER_BOTH: ExpectedCounts = { errors: 1, warnings: 2, notices: 1, total: 4 };

// ── Report ───────────────────────────────────────────────────────────────────
interface FixtureIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly brandMatch?: { matched: boolean; strategy: string; matchDetail: string };
}

const F1_CONTEXT = '<p id="fabrikam-promo-note">Promo text</p>';

function f1(): FixtureIssue {
  return {
    type: 'error',
    code: CODE_CONTRAST,
    message: 'Insufficient contrast ratio on the promo note',
    selector: SEL_DISMISSED,
    context: F1_CONTEXT, // identical on every page -> lifted into templateIssues
    brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand blue pair' },
  };
}
function f2(): FixtureIssue {
  return {
    type: 'error',
    code: CODE_CONTRAST,
    message: 'Insufficient contrast ratio on the footer note',
    selector: SEL_SIBLING,
    context: '<p id="fabrikam-footer-note">Footer text</p>',
    brandMatch: { matched: true, strategy: 'color-pair', matchDetail: 'Brand grey pair' },
  };
}
function f3(): FixtureIssue {
  return {
    type: 'error',
    code: CODE_ALT,
    message: 'Image is missing a text alternative',
    selector: SEL_ALT,
    context: '<img id="fabrikam-hero-img" src="hero.png">',
    brandMatch: { matched: true, strategy: 'selector', matchDetail: 'Hero image token' },
  };
}
function f4(): FixtureIssue {
  return {
    type: 'warning',
    code: CODE_LINK,
    message: 'Link purpose is unclear from the link text alone',
    selector: SEL_LINK,
    context: '<a id="fabrikam-more-link" href="/more">More</a>',
  };
}
function f5(): FixtureIssue {
  return {
    type: 'notice',
    code: CODE_FALLBACK,
    message: 'Engine fallback finding for the whole page',
    selector: 'html',
    context: '',
  };
}

function complianceBlob(): Record<string, unknown> {
  const violations = [
    { wcagCriterion: '1.1.1', obligation: 'mandatory', issueCount: 1 },
    { wcagCriterion: '1.4.3', obligation: 'mandatory', issueCount: 1 },
    { wcagCriterion: '2.4.4', obligation: 'recommended', issueCount: 1 },
  ];
  const regulationRef = (obligation: string) => ({
    regulationId: 'TEST-REG',
    regulationName: 'Test Accessibility Act',
    shortName: 'TAA',
    jurisdictionId: 'EU',
    obligation,
    enforcementDate: '2025-06-28',
  });
  const annotated = (code: string, wcagCriterion: string, level: string, obligation: string, original: FixtureIssue) => ({
    code,
    wcagCriterion,
    wcagLevel: level,
    originalIssue: { ...original },
    regulations: [regulationRef(obligation)],
  });
  return {
    matrix: {
      EU: {
        jurisdictionId: 'EU',
        jurisdictionName: 'Test Union',
        status: 'fail',
        mandatoryViolations: 2,
        recommendedViolations: 1,
        optionalViolations: 0,
        regulations: [
          {
            regulationId: 'TEST-REG',
            regulationName: 'Test Accessibility Act',
            shortName: 'TAA',
            status: 'fail',
            enforcementDate: '2025-06-28',
            scope: 'public',
            violations,
          },
        ],
      },
    },
    regulationMatrix: {
      'TEST-REG': {
        regulationId: 'TEST-REG',
        regulationName: 'Test Accessibility Act',
        shortName: 'TAA',
        jurisdictionId: 'EU',
        status: 'fail',
        mandatoryViolations: 2,
        recommendedViolations: 1,
        optionalViolations: 0,
        violatedRequirements: violations,
      },
    },
    // One entry per unique code in page order; CODE_CONTRAST's original is F1,
    // the realistic first occurrence.
    annotatedIssues: [
      annotated(CODE_CONTRAST, '1.4.3', 'AA', 'mandatory', f1()),
      annotated(CODE_ALT, '1.1.1', 'A', 'mandatory', f3()),
      annotated(CODE_LINK, '2.4.4', 'A', 'recommended', f4()),
    ],
    summary: {
      totalJurisdictions: 1,
      passing: 0,
      failing: 1,
      totalMandatoryViolations: 2,
      totalOptionalViolations: 0,
    },
  };
}

/**
 * Dashboard-shape report over three pages. F1 is on all three pages with an
 * identical context (normalizeReportData lifts it into templateIssues), listed
 * FIRST on page 1.
 */
export function surfaceReport(
  siteUrl: string = FABRIKAM_SITE,
  opts: { readonly withSibling?: boolean } = {},
): Record<string, unknown> {
  const withSibling = opts.withSibling ?? true;
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  const pages = [
    { url: siteUrl, issues: [f1(), ...(withSibling ? [f2()] : []), f4()] },
    { url: `${base}about`, issues: [f1(), f3(), f4()] },
    { url: `${base}contact`, issues: [f1(), f5()] },
  ].map((p) => ({ ...p, issueCount: p.issues.length }));
  const counts = countIssues({ pages });
  const compliance = complianceBlob();
  return {
    scanId: FIXED_SCAN_ID,
    siteUrl,
    standard: 'WCAG2AA',
    completedAt: FIXED_COMPLETED_AT,
    summary: {
      pagesScanned: 3,
      totalIssues: counts.total,
      byLevel: { error: counts.errors, warning: counts.warnings, notice: counts.notices },
      pagesFailed: 0,
    },
    pages,
    errors: [],
    compliance,
    complianceMatrix: Object.values(compliance.matrix as Record<string, unknown>),
    regulationMatrix: Object.values(compliance.regulationMatrix as Record<string, unknown>),
  };
}

// ── Store + seed helpers ─────────────────────────────────────────────────────
export interface SurfaceStore {
  readonly storage: SqliteStorageAdapter;
  readonly reportsDir: string;
  cleanup(): Promise<void>;
}

export async function openSurfaceStore(): Promise<SurfaceStore> {
  const dbPath = join(tmpdir(), `test-surface-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-surface-reports-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  return {
    storage,
    reportsDir,
    async cleanup() {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    },
  };
}

export interface SurfaceOrgs {
  readonly fabrikamOrgId: string;
  readonly northwindOrgId: string;
}

export async function seedSurfaceOrgs(storage: StorageAdapter): Promise<SurfaceOrgs> {
  const fabrikam = await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' });
  const northwind = await storage.organizations.createOrg({ name: 'Northwind', slug: 'northwind' });
  return { fabrikamOrgId: fabrikam.id, northwindOrgId: northwind.id };
}

export interface SeedSurfaceScanOptions {
  readonly orgId: string;
  readonly siteUrl?: string;
  readonly report?: Record<string, unknown>;
  /** Where the stored report lives: the DB column, a file on disk, or both. */
  readonly location: 'db' | 'fs' | 'both';
  readonly reportsDir?: string;
  readonly id?: string;
  readonly createdAt?: string;
  readonly completedAt?: string;
}

export async function seedSurfaceScan(
  storage: StorageAdapter,
  opts: SeedSurfaceScanOptions,
): Promise<string> {
  const siteUrl = opts.siteUrl ?? FABRIKAM_SITE;
  const report = opts.report ?? surfaceReport(siteUrl);
  const id = opts.id ?? `scan_${randomUUID().replace(/-/g, '')}`;
  await storage.scans.createScan({
    id,
    siteUrl,
    standard: 'WCAG2AA',
    jurisdictions: ['EU'],
    regulations: [],
    createdBy: 'fabrikam-seed',
    createdAt: opts.createdAt ?? FIXED_CREATED_AT,
    orgId: opts.orgId,
  });
  const counts = countIssues(report);
  const update: Record<string, unknown> = {
    status: 'completed',
    completedAt: opts.completedAt ?? FIXED_COMPLETED_AT,
    pagesScanned: 3,
    errors: counts.errors,
    warnings: counts.warnings,
    notices: counts.notices,
    totalIssues: counts.total,
    confirmedViolations: 0,
  };
  if (opts.location === 'db' || opts.location === 'both') {
    update['jsonReport'] = JSON.stringify(report);
  }
  if (opts.location === 'fs' || opts.location === 'both') {
    if (opts.reportsDir === undefined) throw new Error('seedSurfaceScan: reportsDir is required for fs/both');
    const path = join(opts.reportsDir, `report-${id}.json`);
    writeFileSync(path, JSON.stringify(report), 'utf-8');
    update['jsonReportPath'] = path;
  }
  await storage.scans.updateScan(id, update);
  return id;
}

export async function seedSurfaceDismissal(
  storage: StorageAdapter,
  opts: { readonly orgId: string; readonly siteUrl?: string; readonly match: { readonly code: string; readonly selector: string } },
): Promise<IssueDismissal> {
  const siteUrl = opts.siteUrl ?? FABRIKAM_SITE;
  const result = await storage.issueDismissals!.mark({
    orgId: opts.orgId,
    siteUrl,
    siteKey: toSiteKey(siteUrl),
    code: opts.match.code,
    selector: opts.match.selector,
    reason: REASON_TOKEN,
    actor: 'fabrikam-admin',
  });
  if (result.kind !== 'created') throw new Error('seedSurfaceDismissal: key already active');
  return result.dismissal;
}

/**
 * Dismissals that must NEVER affect a Fabrikam scan of FABRIKAM_SITE:
 * Northwind (another org) dismisses both matches on the SAME site URL, and
 * Fabrikam dismisses both on ANOTHER site.
 */
export async function seedForeignDismissals(storage: StorageAdapter, orgs: SurfaceOrgs): Promise<void> {
  for (const match of [DISMISS_PARTIAL, DISMISS_WHOLE]) {
    await seedSurfaceDismissal(storage, { orgId: orgs.northwindOrgId, siteUrl: FABRIKAM_SITE, match });
    await seedSurfaceDismissal(storage, { orgId: orgs.fabrikamOrgId, siteUrl: FABRIKAM_OTHER_SITE, match });
  }
}

// ── String-level assertions on any serialised output ─────────────────────────
function bare(selector: string): string {
  return selector.replace(/^#/, '');
}

/** Dismissed findings must be absent; the reason text must be absent unless allowed. */
export function assertDismissedAbsent(
  text: string,
  which: 'partial' | 'both',
  opts: { readonly allowReasons?: boolean } = {},
): void {
  expect(text, 'dismissed selector still present').not.toContain(bare(SEL_DISMISSED));
  if (which === 'both') expect(text, 'dismissed selector still present').not.toContain(bare(SEL_ALT));
  if (opts.allowReasons !== true) expect(text, 'dismissal reason leaked').not.toContain(REASON_TOKEN);
}

/** The surviving findings must still be present. */
export function assertSiblingPresent(text: string): void {
  expect(text, 'sibling finding missing').toContain(bare(SEL_SIBLING));
  expect(text, 'unrelated finding missing').toContain(bare(SEL_LINK));
}
