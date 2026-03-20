import { EventEmitter } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ScanDb } from '../db/scans.js';
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
  readonly webserviceUrl: string;
  readonly complianceUrl?: string;
  readonly complianceToken?: string;
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
    // Always emit locally for same-instance listeners
    this.emitter.emit(`scan:${scanId}`, event);
    // Also publish to Redis when available for cross-instance delivery
    if (this.ssePublisher !== undefined) {
      void this.ssePublisher.publish(scanId, event);
    }
  }

  on(scanId: string, listener: (event: ScanProgressEvent) => void): void {
    this.emitter.on(`scan:${scanId}`, listener);
  }

  off(scanId: string, listener: (event: ScanProgressEvent) => void): void {
    this.emitter.off(`scan:${scanId}`, listener);
  }

  startScan(scanId: string, config: ScanConfig): void {
    // Enqueue without awaiting — background execution
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
      const { createScanner } = await import(
        /* webpackIgnore: true */ '@pally-agent/core'
      ).catch(() => ({ createScanner: null })) as { createScanner: null | ((opts: unknown) => unknown) };

      let pagesScanned = 0;
      let errors = 0;
      let warnings = 0;
      let notices = 0;
      let allIssues: Array<{ code: string; type: string; message: string; selector: string; context: string }> = [];

      if (createScanner !== null) {
        const scanner = createScanner({
          webserviceUrl: config.webserviceUrl,
          standard: config.standard as 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA',
          concurrency: config.concurrency,
          onProgress: (progress: { type: string; url: string; current: number; total: number }) => {
            emit({
              type: 'scan_complete',
              timestamp: new Date().toISOString(),
              data: {
                pagesScanned: progress.current,
                totalPages: progress.total,
                currentUrl: progress.url,
              },
            });
          },
        } as Parameters<typeof createScanner>[0]);

        const result = await (scanner as { scan: (url: string) => Promise<{ pages: Array<{ issues: Array<{ type: string; code: string; message: string; selector: string; context: string }> }>; summary: { pagesScanned: number; byLevel: { error: number; warning: number; notice: number } } }> }).scan(config.siteUrl);

        pagesScanned = result.summary.pagesScanned;
        errors = result.summary.byLevel.error;
        warnings = result.summary.byLevel.warning;
        notices = result.summary.byLevel.notice;
        allIssues = result.pages.flatMap((p) => p.issues);
      }

      // Ensure reports dir exists
      await mkdir(this.reportsDir, { recursive: true });

      const hostname = new URL(config.siteUrl).hostname;
      const jsonPath = join(this.reportsDir, `${hostname}-${scanId}.json`);

      // Build report data — enriched with WCAG descriptions, regulations, template dedup
      const reportData: Record<string, unknown> = {
        scanId,
        siteUrl: config.siteUrl,
        standard: config.standard,
        completedAt: new Date().toISOString(),
      };

      // Placeholder for enriched data (populated by core if available)
      let templateIssues: unknown[] = [];

      // Summary
      reportData.summary = {
        pagesScanned,
        totalIssues: errors + warnings + notices,
        byLevel: { error: errors, warning: warnings, notice: notices },
        pagesFailed: 0,
      };

      // Pages — group issues per page if scanner returned PageResult[], else single page
      reportData.pages = [{
        url: config.siteUrl,
        issues: allIssues,
        issueCount: allIssues.length,
      }];

      // Template issues (deduplication)
      if (templateIssues.length > 0) {
        reportData.templateIssues = templateIssues;
        reportData.templateIssueCount = templateIssues.length;
        reportData.templateOccurrenceCount = templateIssues.reduce(
          (sum: number, t: unknown) => sum + ((t as { affectedCount?: number }).affectedCount ?? 0), 0
        );
      }

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

          const complianceResult = await checkCompliance(
            config.complianceUrl,
            config.complianceToken,
            config.jurisdictions,
            allIssues,
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

      await writeFile(jsonPath, JSON.stringify(reportData, null, 2));

      this.db.updateScan(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        pagesScanned,
        totalIssues: errors + warnings + notices,
        errors,
        warnings,
        notices,
        ...(confirmedViolations !== undefined ? { confirmedViolations } : {}),
        jsonReportPath: jsonPath,
      });

      emit({
        type: 'complete',
        timestamp: new Date().toISOString(),
        data: {
          pagesScanned,
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

