import { EventEmitter } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ScanDb } from '../db/scans.js';
import type { PageHashEntry } from '../db/scans.js';
import { checkCompliance } from '../compliance-client.js';
import type { SsePublisher, RedisScanQueue } from '../cache/redis.js';

export interface ScanProgressEvent {
  readonly type: 'discovery' | 'scan_start' | 'scan_complete' | 'scan_error' | 'compliance' | 'complete' | 'failed';
  readonly timestamp: string;
  readonly data: {
    readonly pagesDiscovered?: number;
    readonly pagesScanned?: number;
    readonly totalPages?: number;
    readonly currentUrl?: string;
    readonly skipped?: boolean;
    readonly pagesSkipped?: number;
    readonly issues?: { errors: number; warnings: number; notices: number };
    readonly confirmedViolations?: number;
    readonly reportUrl?: string;
    readonly error?: string;
  };
}

export interface ScanConfig {
  readonly siteUrl: string;
  readonly standard: string;
  readonly concurrency: number;
  readonly jurisdictions: string[];
  readonly scanMode?: 'single' | 'site';
  readonly webserviceUrl: string;
  readonly webserviceUrls?: readonly string[];
  readonly complianceUrl?: string;
  readonly complianceToken?: string;
  readonly maxPages?: number;
  readonly incremental?: boolean;
  readonly orgId?: string;
  /** Pa11y test runner: 'htmlcs' (default) or 'axe'. */
  readonly runner?: 'htmlcs' | 'axe';
}

class ScanQueue {
  private readonly maxConcurrent: number;
  private running = 0;
  private readonly queue: Array<() => Promise<void>> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(scanFn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const wrapped = async (): Promise<void> => {
        try {
          await scanFn();
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          this.running--;
          this.processNext();
        }
      };

      this.queue.push(wrapped);
      this.processNext();
    });
  }

  isAtCapacity(): boolean {
    return this.running >= this.maxConcurrent;
  }

  private processNext(): void {
    if (this.running >= this.maxConcurrent) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.running++;
    void next();
  }

  get activeCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}

export interface OrchestratorOptions {
  readonly maxConcurrent?: number;
  /** Optional Redis publisher for cross-instance SSE delivery. */
  readonly ssePublisher?: SsePublisher;
  /** Optional Redis queue for cross-instance scan distribution. */
  readonly redisQueue?: RedisScanQueue;
}

export class ScanOrchestrator {
  private readonly emitter = new EventEmitter();
  private readonly queue: ScanQueue;
  private readonly db: ScanDb;
  private readonly reportsDir: string;
  private readonly ssePublisher?: SsePublisher;
  /** Buffer recent events per scan so late-connecting SSE clients catch up. */
  private readonly eventBuffers = new Map<string, ScanProgressEvent[]>();

  constructor(db: ScanDb, reportsDir: string, maxConcurrentOrOpts: number | OrchestratorOptions = 2) {
    this.db = db;
    this.reportsDir = reportsDir;

    const opts: OrchestratorOptions = typeof maxConcurrentOrOpts === 'number'
      ? { maxConcurrent: maxConcurrentOrOpts }
      : maxConcurrentOrOpts;

    this.queue = new ScanQueue(opts.maxConcurrent ?? 2);
    this.emitter.setMaxListeners(100);
    this.ssePublisher = opts.ssePublisher;
  }

  emit(scanId: string, event: ScanProgressEvent): void {
    // Buffer the event for late-connecting clients
    let buffer = this.eventBuffers.get(scanId);
    if (buffer === undefined) {
      buffer = [];
      this.eventBuffers.set(scanId, buffer);
    }
    // Keep only the last event per type (except scan_complete which accumulates)
    if (event.type !== 'scan_complete') {
      const idx = buffer.findIndex((e) => e.type === event.type);
      if (idx !== -1) buffer.splice(idx, 1);
    }
    buffer.push(event);
    // Clean up buffer on terminal events
    if (event.type === 'complete' || event.type === 'failed') {
      setTimeout(() => { this.eventBuffers.delete(scanId); }, 30_000);
    }

    // Always emit locally for same-instance listeners
    this.emitter.emit(`scan:${scanId}`, event);
    // Also publish to Redis when available for cross-instance delivery
    if (this.ssePublisher !== undefined) {
      void this.ssePublisher.publish(scanId, event);
    }
  }

  /**
   * Subscribe to scan events. Immediately replays any buffered events
   * so late-connecting SSE clients catch up on progress already emitted.
   */
  on(scanId: string, listener: (event: ScanProgressEvent) => void): void {
    // Replay buffered events first
    const buffer = this.eventBuffers.get(scanId);
    if (buffer !== undefined) {
      for (const event of buffer) {
        listener(event);
      }
    }
    this.emitter.on(`scan:${scanId}`, listener);
  }

  off(scanId: string, listener: (event: ScanProgressEvent) => void): void {
    this.emitter.off(`scan:${scanId}`, listener);
  }

  startScan(scanId: string, config: ScanConfig): void {
    // Enqueue without awaiting — background execution
    // Emit queued event so the UI knows the scan is waiting if queue is full
    if (this.queue.isAtCapacity()) {
      this.emit(scanId, {
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      });
    }
    void this.queue.enqueue(() => this.runScan(scanId, config));
  }

  private async runScan(scanId: string, config: ScanConfig): Promise<void> {
    const emit = (event: ScanProgressEvent): void => {
      this.emitter.emit(`scan:${scanId}`, event);
    };

    try {
      this.db.updateScan(scanId, { status: 'running' });

      emit({
        type: 'scan_start',
        timestamp: new Date().toISOString(),
        data: {},
      });

      // Dynamically import core scanner to avoid circular dependency issues
      const coreModule = await import(
        /* webpackIgnore: true */ '@luqen/core'
      ).catch(() => null) as null | {
        createScanner: (opts: unknown) => unknown;
        discoverUrls: (url: string, opts: unknown, returnResult: true) => Promise<{ urls: Array<{ url: string; discoveryMethod: string }> }>;
        scanUrls: (urls: unknown[], client: unknown, opts: unknown) => Promise<{ pages: Array<{ url: string; discoveryMethod: string; issueCount: number; issues: Array<{ type: string; code: string; message: string; selector: string; context: string }> }>; errors: unknown[] }>;
        WebserviceClient: new (url: string, headers: Record<string, string>) => unknown;
        WebservicePool: new (urls: readonly string[], headers: Record<string, string>) => unknown;
        computeContentHashes: (urls: readonly string[], concurrency?: number, headers?: Readonly<Record<string, string>>) => Promise<Map<string, string>>;
      };

      let pagesScanned = 0;
      let pagesSkipped = 0;
      let errors = 0;
      let warnings = 0;
      let notices = 0;
      let allIssues: Array<{ code: string; type: string; message: string; selector: string; context: string }> = [];
      let scanPages: Array<{ url: string; issueCount: number; issues: Array<{ code: string; type: string; message: string; selector: string; context: string }> }> = [];

      if (coreModule !== null) {
        const { createScanner, discoverUrls, scanUrls, WebserviceClient, WebservicePool, computeContentHashes } = coreModule;

        if (config.incremental === true && config.scanMode === 'site') {
          // --- Incremental scan: discover, hash, filter, scan changed pages only ---
          const orgId = config.orgId ?? 'system';

          // 1. Discover URLs
          const effectiveMaxPages = config.maxPages ?? 50;
          let discoveredUrls: Array<{ url: string; discoveryMethod: string }>;
          try {
            const result = await discoverUrls(config.siteUrl, {
              maxPages: effectiveMaxPages,
              crawlDepth: 2,
              alsoCrawl: true,
            }, true);
            discoveredUrls = result.urls;
          } catch {
            discoveredUrls = [{ url: config.siteUrl, discoveryMethod: 'crawl' }];
          }

          emit({
            type: 'discovery',
            timestamp: new Date().toISOString(),
            data: { pagesDiscovered: discoveredUrls.length },
          });

          // 2. Compute content hashes for all discovered URLs in parallel
          const currentHashes = await computeContentHashes(
            discoveredUrls.map((u) => u.url),
            config.concurrency,
          );

          // 3. Compare with stored hashes to find changed/new pages
          const storedHashes = this.db.getPageHashes(config.siteUrl, orgId);
          const changedUrls: Array<{ url: string; discoveryMethod: string }> = [];
          const skippedUrls: string[] = [];

          for (const discovered of discoveredUrls) {
            const currentHash = currentHashes.get(discovered.url);
            const storedHash = storedHashes.get(discovered.url);

            if (currentHash === undefined) {
              // Could not fetch — scan it to be safe
              changedUrls.push(discovered);
            } else if (storedHash === undefined || storedHash !== currentHash) {
              // New page or changed content
              changedUrls.push(discovered);
            } else {
              // Unchanged — skip
              skippedUrls.push(discovered.url);
            }
          }

          pagesSkipped = skippedUrls.length;

          // Emit skip events for unchanged pages
          for (const url of skippedUrls) {
            emit({
              type: 'scan_complete',
              timestamp: new Date().toISOString(),
              data: {
                pagesScanned: 0,
                totalPages: discoveredUrls.length,
                currentUrl: url,
                skipped: true,
              },
            });
          }

          // 4. Scan only changed URLs
          if (changedUrls.length > 0) {
            const allUrls = config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
              ? [...new Set([...config.webserviceUrls, config.webserviceUrl])]
              : [config.webserviceUrl];
            const client = allUrls.length > 1
              ? new WebservicePool(allUrls, {})
              : new WebserviceClient(config.webserviceUrl, {});
            const scanOptions = {
              standard: config.standard as 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA',
              concurrency: config.concurrency,
              timeout: 30_000,
              pollTimeout: 60_000,
              ignore: [] as string[],
              hideElements: '',
              headers: {},
              wait: 0,
              ...(config.runner !== undefined ? { runner: config.runner } : {}),
              onProgress: (progress: { type: string; url: string; current: number; total: number }) => {
                if (progress.type === 'scan:start') {
                  emit({
                    type: 'scan_complete',
                    timestamp: new Date().toISOString(),
                    data: {
                      pagesScanned: pagesSkipped + progress.current - 1,
                      totalPages: discoveredUrls.length,
                      currentUrl: progress.url,
                    },
                  });
                } else {
                  emit({
                    type: 'scan_complete',
                    timestamp: new Date().toISOString(),
                    data: {
                      pagesScanned: pagesSkipped + progress.current,
                      totalPages: discoveredUrls.length,
                      currentUrl: progress.url,
                    },
                  });
                }
              },
            };

            const result = await scanUrls(changedUrls, client, scanOptions);

            pagesScanned = result.pages.length + pagesSkipped;
            for (const page of result.pages) {
              for (const issue of page.issues) {
                if (issue.type === 'error') errors++;
                else if (issue.type === 'warning') warnings++;
                else notices++;
              }
            }
            allIssues = result.pages.flatMap((p) => p.issues);
            scanPages = result.pages.map((p) => ({
              url: p.url,
              issueCount: p.issueCount ?? p.issues.length,
              issues: p.issues,
            }));
          } else {
            pagesScanned = pagesSkipped;
          }

          // 5. Update stored hashes for all pages we computed hashes for
          const hashEntries: PageHashEntry[] = [];
          for (const [pageUrl, hash] of currentHashes) {
            hashEntries.push({ siteUrl: config.siteUrl, pageUrl, hash, orgId });
          }
          if (hashEntries.length > 0) {
            this.db.upsertPageHashes(hashEntries);
          }
        } else {
          // --- Standard (non-incremental) scan ---
          const scanner = createScanner({
            webserviceUrl: config.webserviceUrl,
            ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
              ? { webserviceUrls: config.webserviceUrls }
              : {}),
            standard: config.standard as 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA',
            concurrency: config.concurrency,
            singlePage: config.scanMode !== 'site',
            maxPages: config.maxPages,
            ...(config.runner !== undefined ? { runner: config.runner } : {}),
            onProgress: (progress: { type: string; url: string; current: number; total: number }) => {
              if (progress.type === 'scan:start') {
                // First scan:start event tells us discovery is done
                if (progress.current === 1) {
                  emit({
                    type: 'discovery',
                    timestamp: new Date().toISOString(),
                    data: { pagesDiscovered: progress.total },
                  });
                }
                emit({
                  type: 'scan_complete',
                  timestamp: new Date().toISOString(),
                  data: {
                    pagesScanned: progress.current - 1,
                    totalPages: progress.total,
                    currentUrl: progress.url,
                  },
                });
              } else {
                emit({
                  type: 'scan_complete',
                  timestamp: new Date().toISOString(),
                  data: {
                    pagesScanned: progress.current,
                    totalPages: progress.total,
                    currentUrl: progress.url,
                  },
                });
              }
            },
          } as Parameters<typeof createScanner>[0]);

          const result = await (scanner as { scan: (url: string) => Promise<{ pages: Array<{ url: string; issueCount: number; issues: Array<{ type: string; code: string; message: string; selector: string; context: string }> }>; summary: { pagesScanned: number; byLevel: { error: number; warning: number; notice: number } } }> }).scan(config.siteUrl);

          pagesScanned = result.summary.pagesScanned;
          errors = result.summary.byLevel.error;
          warnings = result.summary.byLevel.warning;
          notices = result.summary.byLevel.notice;
          allIssues = result.pages.flatMap((p) => p.issues);
          scanPages = result.pages.map((p) => ({
            url: p.url,
            issueCount: p.issueCount ?? p.issues.length,
            issues: p.issues,
          }));
        }
      }

      const hostname = new URL(config.siteUrl).hostname;
      const jsonPath = join(this.reportsDir, `${hostname}-${scanId}.json`);

      // Build report data — enriched with WCAG descriptions, regulations, template dedup
      const reportData: Record<string, unknown> = {
        scanId,
        siteUrl: config.siteUrl,
        standard: config.standard,
        completedAt: new Date().toISOString(),
      };

      // Summary
      reportData.summary = {
        pagesScanned,
        totalIssues: errors + warnings + notices,
        byLevel: { error: errors, warning: warnings, notice: notices },
        pagesFailed: 0,
        ...(pagesSkipped > 0 ? { pagesSkipped } : {}),
      };

      // Pages — preserve per-page structure from scanner if available
      reportData.pages = scanPages.length > 0
        ? scanPages
        : [{ url: config.siteUrl, issues: allIssues, issueCount: allIssues.length }];

      reportData.errors = [];

      let confirmedViolations: number | undefined;

      if (
        config.complianceUrl !== undefined &&
        config.complianceUrl !== '' &&
        config.complianceToken !== undefined &&
        config.complianceToken !== '' &&
        config.jurisdictions.length > 0
      ) {
        try {
          emit({
            type: 'compliance',
            timestamp: new Date().toISOString(),
            data: {},
          });

          // Deduplicate issues by code — compliance only needs unique issue types
          const seenCodes = new Set<string>();
          const uniqueIssues = allIssues.filter((issue) => {
            if (seenCodes.has(issue.code)) return false;
            seenCodes.add(issue.code);
            return true;
          });

          const complianceResult = await checkCompliance(
            config.complianceUrl,
            config.complianceToken,
            config.jurisdictions,
            uniqueIssues,
          );
          confirmedViolations = complianceResult.summary.totalConfirmedViolations ?? 0;

          // Save full compliance data so the report template can render it
          reportData.compliance = complianceResult;

          // Build compliance matrix for the report template
          if (complianceResult.matrix) {
            reportData.complianceMatrix = Object.values(complianceResult.matrix as Record<string, unknown>);
          }
        } catch (complianceErr) {
          // Non-fatal — compliance check failure doesn't fail the scan
          emit({
            type: 'scan_error',
            timestamp: new Date().toISOString(),
            data: { error: `Compliance check failed: ${String(complianceErr)}` },
          });
        }
      }

      const reportJson = JSON.stringify(reportData, null, 2);

      // Store report in DB (primary) and optionally on filesystem (backup)
      this.db.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        pagesScanned,
        totalIssues: errors + warnings + notices,
        errors,
        warnings,
        notices,
        ...(confirmedViolations !== undefined ? { confirmedViolations } : {}),
        jsonReport: reportJson,
        jsonReportPath: jsonPath,
      });

      // Best-effort filesystem write for backward compatibility
      try {
        await mkdir(this.reportsDir, { recursive: true });
        await writeFile(jsonPath, reportJson);
      } catch {
        // DB has the report — filesystem write failure is not critical
      }

      emit({
        type: 'complete',
        timestamp: new Date().toISOString(),
        data: {
          pagesScanned,
          ...(pagesSkipped > 0 ? { pagesSkipped } : {}),
          issues: { errors, warnings, notices },
          confirmedViolations,
          reportUrl: `/reports/${scanId}`,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.updateScan(scanId, {
        status: 'failed',
        error: message,
      });

      emit({
        type: 'failed',
        timestamp: new Date().toISOString(),
        data: { error: message },
      });
    }
  }
}

