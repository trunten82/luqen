/**
 * @pally-agent/core — public API
 *
 * Exports the scanner factory for programmatic use by the dashboard and other consumers.
 */

export { scanUrls, type ScanOptions, type ScanResults } from './scanner/scanner.js';
export { WebserviceClient } from './scanner/webservice-client.js';
export { discoverUrls } from './discovery/discover.js';
export { buildAnnotatedPages } from './reporter/html-reporter.js';
export type { DiscoveredUrl, PageResult, AccessibilityIssue, ScanProgress, ScanError, ProgressListener, ComplianceEnrichment } from './types.js';

import { discoverUrls } from './discovery/discover.js';
import { scanUrls, type ScanOptions } from './scanner/scanner.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import type { DiscoveredUrl, PageResult, ProgressListener } from './types.js';

export interface CreateScannerOptions {
  readonly webserviceUrl: string;
  readonly standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  readonly concurrency?: number;
  readonly timeout?: number;
  readonly pollTimeout?: number;
  readonly ignore?: readonly string[];
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly wait?: number;
  readonly onProgress?: ProgressListener;
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
  const client = new WebserviceClient(opts.webserviceUrl, opts.headers ?? {});
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
  };

  return {
    async scan(url: string) {
      // Discover pages first
      let urls: DiscoveredUrl[];
      try {
        const result = await discoverUrls(url, {
          maxPages: 50,
          crawlDepth: 2,
          alsoCrawl: true,
        }, true);
        urls = result.urls;
      } catch {
        urls = [{ url, discoveryMethod: 'crawl' as const }];
      }

      // Scan all discovered URLs
      const results = await scanUrls(urls, client, scanOptions);

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
