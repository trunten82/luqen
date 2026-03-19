import { EventEmitter } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ScanDb } from '../db/scans.js';
import { checkCompliance } from '../compliance-client.js';

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

export class ScanOrchestrator {
  private readonly emitter = new EventEmitter();
  private readonly queue: ScanQueue;
  private readonly db: ScanDb;
  private readonly reportsDir: string;

  constructor(db: ScanDb, reportsDir: string, maxConcurrent = 2) {
    this.db = db;
    this.reportsDir = reportsDir;
    this.queue = new ScanQueue(maxConcurrent);
    this.emitter.setMaxListeners(100);
  }

  emit(scanId: string, event: ScanProgressEvent): void {
    this.emitter.emit(`scan:${scanId}`, event);
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
      const htmlPath = join(this.reportsDir, `${hostname}-${scanId}.html`);

      const reportData = {
        scanId,
        siteUrl: config.siteUrl,
        standard: config.standard,
        pagesScanned,
        errors,
        warnings,
        notices,
        issues: allIssues,
        completedAt: new Date().toISOString(),
      };

      await writeFile(jsonPath, JSON.stringify(reportData, null, 2));
      await writeFile(htmlPath, buildHtmlReport(reportData));

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
        } catch (complianceErr) {
          // Non-fatal — compliance check failure doesn't fail the scan
          emit({
            type: 'scan_error',
            timestamp: new Date().toISOString(),
            data: { error: `Compliance check failed: ${String(complianceErr)}` },
          });
        }
      }

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
        htmlReportPath: htmlPath,
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

function buildHtmlReport(data: {
  scanId: string;
  siteUrl: string;
  standard: string;
  pagesScanned: number;
  errors: number;
  warnings: number;
  notices: number;
  completedAt: string;
  issues: Array<{ code: string; type: string; message: string; selector: string; context: string }>;
}): string {
  const escapeHtml = (str: string): string =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const issueRows = data.issues
    .map(
      (issue) => `
    <tr>
      <td>${escapeHtml(issue.type)}</td>
      <td>${escapeHtml(issue.code)}</td>
      <td>${escapeHtml(issue.message)}</td>
      <td><code>${escapeHtml(issue.selector)}</code></td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessibility Report — ${escapeHtml(data.siteUrl)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    .summary { display: flex; gap: 2rem; margin: 1rem 0; }
    .card { border: 1px solid #ccc; padding: 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Accessibility Report</h1>
  <p><strong>Site:</strong> ${escapeHtml(data.siteUrl)}</p>
  <p><strong>Standard:</strong> ${escapeHtml(data.standard)}</p>
  <p><strong>Completed:</strong> ${escapeHtml(data.completedAt)}</p>
  <div class="summary">
    <div class="card"><strong>${data.pagesScanned}</strong><br>Pages Scanned</div>
    <div class="card"><strong>${data.errors}</strong><br>Errors</div>
    <div class="card"><strong>${data.warnings}</strong><br>Warnings</div>
    <div class="card"><strong>${data.notices}</strong><br>Notices</div>
  </div>
  ${data.issues.length > 0 ? `
  <h2>Issues</h2>
  <table>
    <caption>Accessibility issues found during scan</caption>
    <thead>
      <tr>
        <th scope="col">Type</th>
        <th scope="col">Code</th>
        <th scope="col">Message</th>
        <th scope="col">Selector</th>
      </tr>
    </thead>
    <tbody>${issueRows}</tbody>
  </table>` : '<p>No issues found.</p>'}
</body>
</html>`;
}
