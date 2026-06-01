/**
 * @luqen/core — public API
 *
 * Exports the scanner factory for programmatic use by the dashboard and other consumers.
 */

export { type FileReader, LocalFileReader } from './source-mapper/file-reader.js';
export { mapIssuesToSource } from './source-mapper/source-mapper.js';
export { proposeFixesFromReport, type ProposeFixesResult } from './fixer/fix-proposer.js';
export { scanUrls, type ScanOptions, type ScanResults } from './scanner/scanner.js';
export { WebserviceClient, WebservicePool } from './scanner/webservice-client.js';
export { DirectScanner } from './scanner/direct-scanner.js';
export { discoverUrls } from './discovery/discover.js';
export { buildAnnotatedPages } from './reporter/html-reporter.js';
export { computeContentHash, computeContentHashes } from './scanner/content-hash.js';
export { runBehavioralChecks } from './behavioral/index.js';
export type { BehavioralOptions, BehavioralResult } from './behavioral/types.js';
export { runLighthouseChecks } from './lighthouse/index.js';
export type { LighthouseOptions, LighthouseResult } from './lighthouse/types.js';
export { runIbmChecks } from './ibm/index.js';
export type { IbmOptions, IbmResult } from './ibm/types.js';
export { mapIbmResults, IBM_WCAG_MAP } from './ibm/index.js';
export type { IbmReport, IbmReportResult } from './ibm/index.js';
export { runReflowChecks } from './reflow/index.js';
export type { ReflowOptions, ReflowResult } from './reflow/types.js';
export { mapReflowObservations, KIND_MAP as REFLOW_KIND_MAP } from './reflow/index.js';
export type { ReflowObservation, ReflowObservationKind } from './reflow/index.js';
export type { DiscoveredUrl, PageResult, AccessibilityIssue, ScanProgress, ScanError, ProgressListener, ComplianceEnrichment } from './types.js';

import { discoverUrls } from './discovery/discover.js';
import { scanUrls, type ScanOptions } from './scanner/scanner.js';
import { WebserviceClient, WebservicePool } from './scanner/webservice-client.js';
import { DirectScanner } from './scanner/direct-scanner.js';
import { runBehavioralChecks } from './behavioral/index.js';
import { runLighthouseChecks } from './lighthouse/index.js';
import { runIbmChecks } from './ibm/index.js';
import { runReflowChecks } from './reflow/index.js';
import type { DiscoveredUrl, PageResult, AccessibilityIssue, ProgressListener } from './types.js';

export interface CreateScannerOptions {
  /** When set, uses the pa11y webservice HTTP API (legacy mode). When omitted, uses direct pa11y npm library. */
  readonly webserviceUrl?: string;
  /** Additional webservice URLs for horizontal scaling (round-robin distribution). Only used when webserviceUrl is set. */
  readonly webserviceUrls?: readonly string[];
  readonly standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  readonly concurrency?: number;
  readonly timeout?: number;
  readonly pollTimeout?: number;
  readonly ignore?: readonly string[];
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Pa11y actions to run before testing (e.g. login form interactions). Only used in direct mode. */
  readonly actions?: readonly string[];
  readonly wait?: number;
  readonly onProgress?: ProgressListener;
  /** When true, scan only the given URL without discovery/crawling. Default: false. */
  readonly singlePage?: boolean;
  /** Maximum pages to discover and scan. Default: 50. Env override: LUQEN_MAX_PAGES. */
  readonly maxPages?: number;
  /** Pa11y test runner: 'htmlcs' (default) or 'axe'. Requires the runner installed alongside the webservice. */
  readonly runner?: 'htmlcs' | 'axe';
  /** Deep scan: run multiple runners (e.g. ['htmlcs','axe']) and merge findings. Direct mode only. */
  readonly runners?: readonly string[];
  /** Include warnings in results (default: true). */
  readonly includeWarnings?: boolean;
  /** Include notices in results (default: true). */
  readonly includeNotices?: boolean;
  /**
   * When true, run the behavioral testing layer (real-browser keyboard /
   * focus / dynamic-state checks) on each scanned page IN ADDITION to the
   * static Pa11y scan. Default: false. OPT-IN — a "deep behavioral scan".
   * Slower + heavier (launches a headless browser per page); bounded by
   * `behavioralMaxPages`.
   */
  readonly behavioral?: boolean;
  /**
   * Cap on how many of the scanned pages the behavioral layer runs against
   * (behavioral checks are far more expensive than a static scan). Default: 10.
   */
  readonly behavioralMaxPages?: number;
  /**
   * When true, run the Lighthouse accessibility engine (Google Lighthouse's
   * accessibility category — a curated axe-core audit set) on each scanned page
   * IN ADDITION to the static Pa11y scan. Default: false. OPT-IN — part of the
   * "deep scan". Heavy (launches a headless Chrome and runs Lighthouse per
   * page); bounded by `lighthouseMaxPages`. Findings carry runner='lighthouse'.
   */
  readonly lighthouse?: boolean;
  /**
   * Cap on how many of the scanned pages the Lighthouse layer runs against.
   * Lighthouse is heavier than the behavioral layer, so the default is small.
   * Default: 5.
   */
  readonly lighthouseMaxPages?: number;
  /**
   * When true, run the IBM Equal Access engine (IBM's accessibility-checker —
   * a SECOND independent ruleset, distinct from axe-core) on each scanned page
   * IN ADDITION to the static Pa11y scan. Default: false. OPT-IN — part of the
   * "deep scan". Heavy (drives its own headless Chrome per page); bounded by
   * `ibmMaxPages`. Findings carry runner='ibm'.
   */
  readonly ibm?: boolean;
  /**
   * Cap on how many of the scanned pages the IBM layer runs against. IBM is
   * heavy (own headless Chrome), so the default is small. Default: 5.
   */
  readonly ibmMaxPages?: number;
  /**
   * When true, run the reflow / zoom-400% engine (narrows the viewport to 320
   * CSS px and checks for content that breaks — horizontal scrolling, element
   * overflow, zoom-locked viewport meta) on each scanned page IN ADDITION to
   * the static Pa11y scan. Default: false. OPT-IN — part of the "deep scan".
   * Heavy (launches a headless Chrome per page); bounded by `reflowMaxPages`.
   * Findings carry runner='reflow' (WCAG 1.4.10 / 1.4.4).
   */
  readonly reflow?: boolean;
  /**
   * Cap on how many of the scanned pages the reflow layer runs against. Reflow
   * launches its own headless Chrome per page, so the default is small.
   * Default: 5.
   */
  readonly reflowMaxPages?: number;
}

export interface Scanner {
  scan(url: string): Promise<{
    pages: PageResult[];
    summary: {
      pagesScanned: number;
      byLevel: { error: number; warning: number; notice: number };
    };
  }>;
}

/**
 * Factory function to create a scanner instance.
 * Used by the dashboard's ScanOrchestrator for programmatic scanning.
 */
export function createScanner(opts: CreateScannerOptions): Scanner {
  // Determine scan backend: webservice (legacy) or direct pa11y library (default)
  let clientOrPool: WebserviceClient | WebservicePool | DirectScanner;

  if (opts.webserviceUrl !== undefined) {
    // Legacy: use pa11y-webservice HTTP API
    const allUrls: string[] = [];
    if (opts.webserviceUrls !== undefined && opts.webserviceUrls.length > 0) {
      const urlSet = new Set(opts.webserviceUrls);
      urlSet.add(opts.webserviceUrl);
      allUrls.push(...urlSet);
    } else {
      allUrls.push(opts.webserviceUrl);
    }

    const headers = opts.headers ?? {};
    clientOrPool = allUrls.length > 1
      ? new WebservicePool(allUrls, headers)
      : new WebserviceClient(allUrls[0], headers);
  } else {
    // Default: direct pa11y npm library
    clientOrPool = new DirectScanner();
  }

  const scanOptions: ScanOptions = {
    standard: opts.standard ?? 'WCAG2AA',
    concurrency: opts.concurrency ?? 5,
    timeout: opts.timeout ?? 30_000,
    pollTimeout: opts.pollTimeout ?? 60_000,
    ignore: opts.ignore ? [...opts.ignore] : [],
    hideElements: opts.hideElements ?? '',
    headers: opts.headers ?? {},
    actions: opts.actions,
    wait: opts.wait ?? 0,
    onProgress: opts.onProgress,
    ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
    ...(opts.runners !== undefined ? { runners: opts.runners } : {}),
    includeWarnings: opts.includeWarnings !== false,
    includeNotices: opts.includeNotices !== false,
  };

  return {
    async scan(url: string) {
      // Discover pages (or use single page in single-page mode)
      let urls: DiscoveredUrl[];
      if (opts.singlePage) {
        urls = [{ url, discoveryMethod: 'crawl' as const }];
      } else {
        const envMaxPages = process.env['LUQEN_MAX_PAGES'] !== undefined
          ? parseInt(process.env['LUQEN_MAX_PAGES'], 10) : NaN;
        const effectiveMaxPages = opts.maxPages
          ?? (Number.isFinite(envMaxPages) && envMaxPages > 0 ? envMaxPages : 50);
        try {
          const result = await discoverUrls(url, {
            maxPages: effectiveMaxPages,
            crawlDepth: 2,
            alsoCrawl: true,
            headers: opts.headers,
          }, true);
          urls = result.urls;
        } catch {
          urls = [{ url, discoveryMethod: 'crawl' as const }];
        }
      }

      // Scan all discovered URLs
      const results = await scanUrls(urls, clientOrPool, scanOptions);

      // Optional behavioral pass (opt-in). Runs a real-browser interaction
      // suite on up to `behavioralMaxPages` of the scanned pages and merges
      // its findings into each page's issue list (runner='behavioral'). Each
      // page is best-effort: a behavioral failure never breaks the static scan.
      const behavioralPages: PageResult[] = opts.behavioral === true
        ? await runBehavioralPass(results.pages, opts)
        : results.pages;

      // Optional Lighthouse pass (opt-in, part of deep scan). Runs Google
      // Lighthouse's accessibility category on up to `lighthouseMaxPages` of the
      // scanned pages and merges its findings (runner='lighthouse') into each
      // page. Best-effort: a Lighthouse failure never breaks the static scan.
      const lighthousePages: PageResult[] = opts.lighthouse === true
        ? await runLighthousePass(behavioralPages, opts)
        : behavioralPages;

      // Optional IBM Equal Access pass (opt-in, part of deep scan). Runs IBM's
      // accessibility-checker (a second independent ruleset) on up to
      // `ibmMaxPages` of the scanned pages and merges its findings
      // (runner='ibm') into each page. Best-effort: an IBM failure never breaks
      // the static scan.
      const ibmPages: PageResult[] = opts.ibm === true
        ? await runIbmPass(lighthousePages, opts)
        : lighthousePages;

      // Optional reflow / zoom-400% pass (opt-in, part of deep scan). Narrows
      // each scanned page to 320 CSS px and merges its findings (runner='reflow')
      // for WCAG 1.4.10 / 1.4.4. Best-effort: a reflow failure never breaks the
      // static scan.
      const pages: PageResult[] = opts.reflow === true
        ? await runReflowPass(ibmPages, opts)
        : ibmPages;

      // Aggregate results
      let errorCount = 0;
      let warningCount = 0;
      let noticeCount = 0;

      for (const page of pages) {
        for (const issue of page.issues) {
          if (issue.type === 'error') errorCount++;
          else if (issue.type === 'warning') warningCount++;
          else noticeCount++;
        }
      }

      return {
        pages,
        summary: {
          pagesScanned: pages.length,
          byLevel: {
            error: errorCount,
            warning: warningCount,
            notice: noticeCount,
          },
        },
      };
    },
  };
}

/**
 * Run the behavioral testing layer over (up to behavioralMaxPages of) the
 * statically-scanned pages and merge its findings into each page's issues.
 *
 * Bounded + best-effort: pages beyond the cap are returned unchanged, and a
 * behavioral failure on one page leaves that page's static results intact.
 * Behavioral issues are mapped to the AccessibilityIssue shape so they render
 * and flow into compliance / VPAT exactly like static findings.
 */
async function runBehavioralPass(
  staticPages: PageResult[],
  opts: CreateScannerOptions,
): Promise<PageResult[]> {
  const cap = opts.behavioralMaxPages ?? 10;
  const out: PageResult[] = [];

  for (let i = 0; i < staticPages.length; i++) {
    const page = staticPages[i];
    if (i >= cap) {
      out.push(page);
      continue;
    }
    try {
      const behavioral = await runBehavioralChecks(page.url, {
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        ...(opts.headers !== undefined ? { headers: { ...opts.headers } } : {}),
      });
      if (behavioral.issues.length === 0) {
        out.push(page);
        continue;
      }
      const mapped: AccessibilityIssue[] = behavioral.issues.map((issue) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner ?? 'behavioral',
        fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
      }));
      const mergedIssues = [...page.issues, ...mapped];
      out.push({ ...page, issues: mergedIssues, issueCount: mergedIssues.length });
    } catch {
      // Behavioral layer is additive — never let it drop a page's static results.
      out.push(page);
    }
  }

  return out;
}

/**
 * Run the Lighthouse accessibility engine over (up to lighthouseMaxPages of)
 * the scanned pages and merge its findings into each page's issues.
 *
 * Bounded + best-effort, mirroring {@link runBehavioralPass}: pages beyond the
 * cap are returned unchanged, and a Lighthouse failure on one page leaves that
 * page's existing results intact. Lighthouse issues are mapped to the
 * AccessibilityIssue shape (runner='lighthouse') so they render and flow into
 * compliance / VPAT exactly like static and behavioral findings.
 */
async function runLighthousePass(
  inputPages: PageResult[],
  opts: CreateScannerOptions,
): Promise<PageResult[]> {
  const cap = opts.lighthouseMaxPages ?? 5;
  const out: PageResult[] = [];

  for (let i = 0; i < inputPages.length; i++) {
    const page = inputPages[i];
    if (i >= cap) {
      out.push(page);
      continue;
    }
    try {
      const lighthouse = await runLighthouseChecks(page.url, {
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        ...(opts.headers !== undefined ? { headers: { ...opts.headers } } : {}),
      });
      if (lighthouse.issues.length === 0) {
        out.push(page);
        continue;
      }
      const mapped: AccessibilityIssue[] = lighthouse.issues.map((issue) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner ?? 'lighthouse',
        fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
      }));
      const mergedIssues = [...page.issues, ...mapped];
      out.push({ ...page, issues: mergedIssues, issueCount: mergedIssues.length });
    } catch {
      // Lighthouse layer is additive — never let it drop a page's results.
      out.push(page);
    }
  }

  return out;
}

/**
 * Run the IBM Equal Access engine over (up to ibmMaxPages of) the scanned pages
 * and merge its findings into each page's issues.
 *
 * Bounded + best-effort, mirroring {@link runLighthousePass}: pages beyond the
 * cap are returned unchanged, and an IBM failure on one page leaves that page's
 * existing results intact. IBM issues are mapped to the AccessibilityIssue shape
 * (runner='ibm') so they render and flow into compliance / VPAT exactly like
 * static, behavioral and Lighthouse findings.
 */
async function runIbmPass(
  inputPages: PageResult[],
  opts: CreateScannerOptions,
): Promise<PageResult[]> {
  const cap = opts.ibmMaxPages ?? 5;
  const out: PageResult[] = [];

  for (let i = 0; i < inputPages.length; i++) {
    const page = inputPages[i];
    if (i >= cap) {
      out.push(page);
      continue;
    }
    try {
      const ibm = await runIbmChecks(page.url, {
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        ...(opts.headers !== undefined ? { headers: { ...opts.headers } } : {}),
      });
      if (ibm.issues.length === 0) {
        out.push(page);
        continue;
      }
      const mapped: AccessibilityIssue[] = ibm.issues.map((issue) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner ?? 'ibm',
        fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
      }));
      const mergedIssues = [...page.issues, ...mapped];
      out.push({ ...page, issues: mergedIssues, issueCount: mergedIssues.length });
    } catch {
      // IBM layer is additive — never let it drop a page's results.
      out.push(page);
    }
  }

  return out;
}

/**
 * Run the reflow / zoom-400% engine over (up to reflowMaxPages of) the scanned
 * pages and merge its findings into each page's issues.
 *
 * Bounded + best-effort, mirroring {@link runIbmPass}: pages beyond the cap are
 * returned unchanged, and a reflow failure on one page leaves that page's
 * existing results intact. Reflow issues are mapped to the AccessibilityIssue
 * shape (runner='reflow') so they render and flow into compliance / VPAT
 * exactly like static, behavioral, Lighthouse and IBM findings.
 */
async function runReflowPass(
  inputPages: PageResult[],
  opts: CreateScannerOptions,
): Promise<PageResult[]> {
  const cap = opts.reflowMaxPages ?? 5;
  const out: PageResult[] = [];

  for (let i = 0; i < inputPages.length; i++) {
    const page = inputPages[i];
    if (i >= cap) {
      out.push(page);
      continue;
    }
    try {
      const reflow = await runReflowChecks(page.url, {
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        ...(opts.headers !== undefined ? { headers: { ...opts.headers } } : {}),
      });
      if (reflow.issues.length === 0) {
        out.push(page);
        continue;
      }
      const mapped: AccessibilityIssue[] = reflow.issues.map((issue) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner ?? 'reflow',
        fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
      }));
      const mergedIssues = [...page.issues, ...mapped];
      out.push({ ...page, issues: mergedIssues, issueCount: mergedIssues.length });
    } catch {
      // Reflow layer is additive — never let it drop a page's results.
      out.push(page);
    }
  }

  return out;
}
