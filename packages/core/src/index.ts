/**
 * @luqen/core — public API
 *
 * Exports the scanner factory for programmatic use by the dashboard and other consumers.
 */

export { scanUrls, type ScanOptions, type ScanResults } from './scanner/scanner.js';
export { WebserviceClient, WebservicePool } from './scanner/webservice-client.js';
export { DirectScanner } from './scanner/direct-scanner.js';
export { discoverUrls } from './discovery/discover.js';
export { buildAnnotatedPages } from './reporter/html-reporter.js';
export { computeContentHash, computeContentHashes } from './scanner/content-hash.js';
export type { DiscoveredUrl, PageResult, AccessibilityIssue, ScanProgress, ScanError, ProgressListener, ComplianceEnrichment } from './types.js';

import { discoverUrls } from './discovery/discover.js';
import { scanUrls, type ScanOptions } from './scanner/scanner.js';
import { WebserviceClient, WebservicePool } from './scanner/webservice-client.js';
import { DirectScanner } from './scanner/direct-scanner.js';
import type { DiscoveredUrl, PageResult, ProgressListener } from './types.js';

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
  readonly wait?: number;
  readonly onProgress?: ProgressListener;
  /** When true, scan only the given URL without discovery/crawling. Default: false. */
  readonly singlePage?: boolean;
  /** Maximum pages to discover and scan. Default: 50. Env override: LUQEN_MAX_PAGES. */
  readonly maxPages?: number;
  /** Pa11y test runner: 'htmlcs' (default) or 'axe'. Requires the runner installed alongside the webservice. */
  readonly runner?: 'htmlcs' | 'axe';
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
    wait: opts.wait ?? 0,
    onProgress: opts.onProgress,
    ...(opts.runner !== undefined ? { runner: opts.runner } : {}),
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
          }, true);
          urls = result.urls;
        } catch {
          urls = [{ url, discoveryMethod: 'crawl' as const }];
        }
      }

      // Scan all discovered URLs
      const results = await scanUrls(urls, clientOrPool, scanOptions);

      // Aggregate results
      let errorCount = 0;
      let warningCount = 0;
      let noticeCount = 0;

      for (const page of results.pages) {
        for (const issue of page.issues) {
          if (issue.type === 'error') errorCount++;
          else if (issue.type === 'warning') warningCount++;
          else noticeCount++;
        }
      }

      return {
        pages: results.pages,
        summary: {
          pagesScanned: results.pages.length,
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
