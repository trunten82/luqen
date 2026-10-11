/**
 * Orchestrator scan-end driver (Phase 88, Plan 16; reused by Plan 10).
 *
 * driveOrchestratorScan({ path, report, dismissals }) builds the REAL
 * ScanOrchestrator over a storage stub and a mocked '@luqen/core', runs one scan
 * through the real runScan loop and returns what that scan wrote and announced:
 *
 *   columns        the completion updateScan argument without jsonReport/completedAt
 *   storedSummary  JSON.parse(jsonReport).summary
 *   completeEvent  the 'complete' progress event's data
 *   webhook        the scan.completed webhook payload
 *   plugin         the scan.complete notification payload
 *
 * The storage stub's issueDismissals.listActiveForSite returns only the seeded
 * rows that match (orgId, siteKey). Before Plan 10 wires the orchestrator it is
 * never called; after wiring it must still return [] for the scanned site when
 * only foreign dismissals are seeded (another org on the same site, the same org
 * on another site).
 *
 * The test file must vi.mock '@luqen/core', '../../src/compliance-client.js',
 * 'node:fs/promises' and '../../src/notifications/dispatcher.js' with the
 * objects in orchestrator-mocks.ts.
 */
import { vi } from 'vitest';
import { ScanOrchestrator } from '../../../src/scanner/orchestrator.js';
import type { ScanConfig, ScanProgressEvent } from '../../../src/scanner/orchestrator.js';
import type { StorageAdapter } from '../../../src/db/index.js';
import type { IssueDismissal } from '../../../src/db/interfaces/issue-dismissal-repository.js';
import type { PluginManager } from '../../../src/plugins/manager.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';
import { countIssues } from '../../../src/services/count-issues.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_OTHER_SITE,
  FABRIKAM_SITE,
  FIXED_CREATED_AT,
  FIXED_SCAN_ID,
  REASON_TOKEN,
} from '../../helpers/dismissal-surface-fixture.js';
import {
  coreMocks,
  complianceMocks,
  recordedPluginDispatches,
  resetOrchestratorMocks,
} from './orchestrator-mocks.js';

export type OrchestratorPath = 'standard' | 'incremental';

export const GOLDEN_FABRIKAM_ORG_ID = 'org-fabrikam';
export const GOLDEN_NORTHWIND_ORG_ID = 'org-northwind';
const GOLDEN_REPORTS_DIR = '/golden-reports';
const COMPLIANCE_URL = 'https://compliance.fabrikam.example';
const COMPLIANCE_TOKEN = 'golden-compliance-token';
/** Incremental only: a discovered page whose stored hash is unchanged -> skipped. */
export const INCREMENTAL_SKIPPED_PAGE = `${FABRIKAM_SITE}archive`;

export interface OrchestratorScanOutput {
  readonly columns: Record<string, unknown>;
  readonly storedSummary: unknown;
  readonly completeEvent: unknown;
  readonly webhook: unknown;
  readonly plugin: unknown;
}

export interface DriveOrchestratorOptions {
  readonly path: OrchestratorPath;
  /** Dashboard-shape report (Plan 01 surfaceReport): its pages are what the scanner "finds". */
  readonly report: Record<string, unknown>;
  /** Rows the fake issueDismissals repository holds. */
  readonly dismissals: readonly IssueDismissal[];
}

/** Dismissals that must never apply to a Fabrikam scan of FABRIKAM_SITE. */
export function foreignDismissalRows(): readonly IssueDismissal[] {
  const rows: IssueDismissal[] = [];
  let n = 0;
  for (const match of [DISMISS_PARTIAL, DISMISS_WHOLE]) {
    for (const [orgId, siteUrl] of [
      [GOLDEN_NORTHWIND_ORG_ID, FABRIKAM_SITE],
      [GOLDEN_FABRIKAM_ORG_ID, FABRIKAM_OTHER_SITE],
    ] as const) {
      n += 1;
      rows.push({
        id: `dismissal-golden-${n}`,
        orgId,
        siteUrl,
        siteKey: toSiteKey(siteUrl),
        code: match.code,
        selector: match.selector,
        reason: REASON_TOKEN,
        status: 'active',
        createdBy: 'fabrikam-admin',
        createdById: null,
        createdAt: FIXED_CREATED_AT,
        revokedBy: null,
        revokedById: null,
        revokedAt: null,
        revokeComment: null,
      });
    }
  }
  return rows;
}

interface ReportPage {
  readonly url: string;
  readonly issueCount: number;
  readonly issues: ReadonlyArray<Record<string, unknown>>;
}

function reportPages(report: Record<string, unknown>): readonly ReportPage[] {
  return report['pages'] as readonly ReportPage[];
}

function buildStorage(dismissals: readonly IssueDismissal[], hashedUnchanged: Map<string, string>): {
  readonly storage: StorageAdapter;
  readonly updateScan: ReturnType<typeof vi.fn>;
} {
  const updateScan = vi.fn().mockResolvedValue({});
  const storage = {
    scans: { updateScan },
    pageHashes: {
      getPageHashes: vi.fn().mockResolvedValue(hashedUnchanged),
      upsertPageHash: vi.fn().mockResolvedValue(undefined),
      upsertPageHashes: vi.fn().mockResolvedValue(undefined),
    },
    issueDismissals: {
      listActiveForSite: vi.fn(async (orgId: string, siteKey: string) =>
        dismissals.filter((d) => d.status === 'active' && d.orgId === orgId && d.siteKey === siteKey),
      ),
    },
    branding: {},
    notificationTemplates: {},
  } as unknown as StorageAdapter;
  return { storage, updateScan };
}

/** The compliance checker's answer: the fixture blob plus a confirmed-violation count. */
function complianceAnswer(report: Record<string, unknown>): Record<string, unknown> {
  const compliance = report['compliance'] as Record<string, unknown>;
  const summary = compliance['summary'] as Record<string, unknown>;
  return { ...compliance, summary: { ...summary, totalConfirmedViolations: 2 } };
}

function configureStandard(report: Record<string, unknown>): void {
  const pages = reportPages(report);
  const counts = countIssues({ pages });
  coreMocks.createScanner.mockReturnValue({
    scan: async () => ({
      pages,
      summary: {
        pagesScanned: pages.length,
        byLevel: { error: counts.errors, warning: counts.warnings, notice: counts.notices },
      },
    }),
  });
}

/**
 * The real incremental branch: discover -> hash -> compare -> scanUrls. The three
 * report pages are new (no stored hash), so they are "changed" and scanned; one
 * extra discovered page (INCREMENTAL_SKIPPED_PAGE) has an unchanged stored hash,
 * so the branch's own pagesSkipped / pagesScanned rule is part of the baseline.
 */
function configureIncremental(report: Record<string, unknown>): void {
  const pages = reportPages(report);
  const discovered = [
    ...pages.map((p) => ({ url: p.url, discoveryMethod: 'crawl' })),
    { url: INCREMENTAL_SKIPPED_PAGE, discoveryMethod: 'crawl' },
  ];
  coreMocks.discoverUrls.mockResolvedValue({ urls: discovered });
  coreMocks.computeContentHashes.mockResolvedValue(
    new Map(discovered.map((d) => [d.url, d.url === INCREMENTAL_SKIPPED_PAGE ? 'hash-archive' : `hash-${d.url}`])),
  );
  coreMocks.scanUrls.mockResolvedValue({
    pages: pages.map((p) => ({ url: p.url, discoveryMethod: 'crawl', issueCount: p.issueCount, issues: p.issues })),
    errors: [],
  });
}

function collectUntilTerminal(orchestrator: ScanOrchestrator, scanId: string): Promise<ScanProgressEvent[]> {
  return new Promise((resolve, reject) => {
    const events: ScanProgressEvent[] = [];
    const timer = setTimeout(() => reject(new Error('orchestrator scan timed out')), 20_000);
    const listener = (event: ScanProgressEvent): void => {
      events.push(event);
      if (event.type === 'complete' || event.type === 'failed') {
        clearTimeout(timer);
        orchestrator.off(scanId, listener);
        resolve(events);
      }
    };
    orchestrator.on(scanId, listener);
  });
}

function onlyCall(calls: readonly unknown[][], event: string): unknown[] {
  const matching = calls.filter((c) => c[2] === event);
  if (matching.length !== 1) throw new Error(`expected exactly one ${event} webhook, saw ${matching.length}`);
  return matching[0];
}

export async function driveOrchestratorScan(opts: DriveOrchestratorOptions): Promise<OrchestratorScanOutput> {
  resetOrchestratorMocks();
  complianceMocks.checkCompliance.mockResolvedValue(complianceAnswer(opts.report));

  const unchanged = new Map<string, string>();
  if (opts.path === 'incremental') {
    unchanged.set(INCREMENTAL_SKIPPED_PAGE, 'hash-archive');
    configureIncremental(opts.report);
  } else {
    configureStandard(opts.report);
  }

  const { storage, updateScan } = buildStorage(opts.dismissals, unchanged);
  const orchestrator = new ScanOrchestrator(storage, GOLDEN_REPORTS_DIR, {
    maxConcurrent: 1,
    pluginManager: {} as unknown as PluginManager,
  });

  const config: ScanConfig = {
    siteUrl: FABRIKAM_SITE,
    standard: 'WCAG2AA',
    concurrency: 2,
    jurisdictions: ['EU'],
    regulations: [],
    scanMode: 'site',
    complianceUrl: COMPLIANCE_URL,
    complianceToken: COMPLIANCE_TOKEN,
    orgId: GOLDEN_FABRIKAM_ORG_ID,
    ...(opts.path === 'incremental' ? { incremental: true } : {}),
  };

  const done = collectUntilTerminal(orchestrator, FIXED_SCAN_ID);
  orchestrator.startScan(FIXED_SCAN_ID, config);
  const events = await done;
  // The webhook and plugin notification are fired right after the complete event.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const failed = events.find((e) => e.type === 'failed');
  if (failed !== undefined) throw new Error(`orchestrator scan failed: ${String(failed.data.error)}`);
  const completeEvent = events.find((e) => e.type === 'complete');
  if (completeEvent === undefined) throw new Error('orchestrator scan emitted no complete event');

  const completion = updateScan.mock.calls
    .map((c) => c[1] as Record<string, unknown>)
    .filter((u) => u['status'] === 'completed');
  if (completion.length !== 1) throw new Error(`expected one completion updateScan, saw ${completion.length}`);
  const { jsonReport, completedAt: _completedAt, ...columns } = completion[0];
  void _completedAt;

  const webhookCall = onlyCall(complianceMocks.dispatchWebhookEvent.mock.calls, 'scan.completed');
  const plugin = recordedPluginDispatches().filter((d) => d.type === 'scan.complete');
  if (plugin.length !== 1) throw new Error(`expected one scan.complete plugin dispatch, saw ${plugin.length}`);

  return {
    columns,
    storedSummary: (JSON.parse(String(jsonReport)) as { summary: unknown }).summary,
    completeEvent: completeEvent.data,
    webhook: { event: webhookCall[2], payload: webhookCall[3] },
    plugin: plugin[0],
  };
}
