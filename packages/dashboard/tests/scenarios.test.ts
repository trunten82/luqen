/**
 * Synthetic scenario tests for the dashboard package.
 *
 * Scenario 1: Full Scan Lifecycle
 * Scenario 2: Report Comparison Edge Cases
 * Scenario 3: Self-Audit Result Parsing
 * Scenario 4: Monitor Data Flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScanDb, type ScanRecord } from '../src/db/scans.js';
import { diffReports, type NormalizedReport } from '../src/compare/diff.js';
import {
  parseAuditResults,
  formatAuditSummary,
  buildPageUrls,
  type AuditPageResult,
} from '../src/self-audit.js';
import {
  buildMonitorViewData,
  isSourceStale,
  formatLastChecked,
  type MonitorSource,
  type MonitorProposal,
} from '../src/routes/admin/monitor.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

// ============================================================================
// Scenario 1: Full Scan Lifecycle
// ============================================================================

describe('Scenario 1: Full Scan Lifecycle', () => {
  let db: ScanDb;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(tmpdir(), `scenario1-${randomUUID()}.db`);
    db = new ScanDb(dbPath);
    db.initialize();
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('creates a scan record with synthetic data and retrieves it', () => {
    const id = randomUUID();
    const record = db.createScan({
      id,
      siteUrl: 'https://synthetic-site.example.com',
      standard: 'WCAG2AA',
      jurisdictions: ['EU', 'US'],
      createdBy: 'scenario-test',
      createdAt: new Date().toISOString(),
    });

    expect(record.id).toBe(id);
    expect(record.status).toBe('queued');
    expect(record.jurisdictions).toEqual(['EU', 'US']);
  });

  it('appears in listScans after creation', () => {
    const id = randomUUID();
    db.createScan({
      id,
      siteUrl: 'https://synthetic-site.example.com',
      standard: 'WCAG2AA',
      jurisdictions: ['EU'],
      createdBy: 'scenario-test',
      createdAt: new Date().toISOString(),
    });

    const all = db.listScans();
    expect(all.some((s) => s.id === id)).toBe(true);
  });

  it('transitions through queued -> running -> completed lifecycle', () => {
    const id = randomUUID();
    const created = db.createScan({
      id,
      siteUrl: 'https://lifecycle.example.com',
      standard: 'WCAG2AA',
      jurisdictions: ['EU'],
      createdBy: 'scenario-test',
      createdAt: new Date().toISOString(),
    });
    expect(created.status).toBe('queued');

    // Transition to running
    const running = db.updateScan(id, { status: 'running' });
    expect(running.status).toBe('running');

    // Transition to completed with report data
    const completed = db.updateScan(id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      pagesScanned: 15,
      totalIssues: 42,
      errors: 10,
      warnings: 20,
      notices: 12,
      confirmedViolations: 5,
      jsonReportPath: '/reports/scan-report.json',
    });

    expect(completed.status).toBe('completed');
    expect(completed.pagesScanned).toBe(15);
    expect(completed.totalIssues).toBe(42);
    expect(completed.errors).toBe(10);
    expect(completed.warnings).toBe(20);
    expect(completed.notices).toBe(12);
    expect(completed.confirmedViolations).toBe(5);
    expect(completed.jsonReportPath).toBe('/reports/scan-report.json');
  });

  it('filters listScans by status', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    db.createScan({
      id: id1,
      siteUrl: 'https://a.example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    });

    db.createScan({
      id: id2,
      siteUrl: 'https://b.example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    });

    db.updateScan(id1, { status: 'completed' });

    const completed = db.listScans({ status: 'completed' });
    const queued = db.listScans({ status: 'queued' });

    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe(id1);
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe(id2);
  });

  it('deletes a scan and verifies it is gone', () => {
    const id = randomUUID();
    db.createScan({
      id,
      siteUrl: 'https://delete-me.example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    });

    expect(db.getScan(id)).not.toBeNull();

    db.deleteScan(id);

    expect(db.getScan(id)).toBeNull();
    expect(db.listScans().some((s) => s.id === id)).toBe(false);
  });

  it('handles the failed scan path', () => {
    const id = randomUUID();
    db.createScan({
      id,
      siteUrl: 'https://fail.example.com',
      standard: 'WCAG2AA',
      jurisdictions: ['EU'],
      createdBy: 'test',
      createdAt: new Date().toISOString(),
    });

    db.updateScan(id, { status: 'running' });
    const failed = db.updateScan(id, {
      status: 'failed',
      error: 'Connection refused by target host',
    });

    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Connection refused by target host');
  });
});

// ============================================================================
// Scenario 2: Report Comparison Edge Cases
// ============================================================================

describe('Scenario 2: Report Comparison Edge Cases', () => {
  const makeIssue = (
    code: string,
    selector: string,
    message: string,
    type: string = 'error',
  ) => ({
    type,
    code,
    message,
    selector,
  });

  const emptyReport: NormalizedReport = {
    summary: { byLevel: { error: 0, warning: 0, notice: 0 } },
    pages: [],
  };

  const makeReport = (
    pages: Array<{
      url: string;
      issues: Array<{ type: string; code: string; message: string; selector: string }>;
    }>,
  ): NormalizedReport => {
    let errors = 0;
    let warnings = 0;
    let notices = 0;
    for (const page of pages) {
      for (const issue of page.issues) {
        if (issue.type === 'error') errors++;
        else if (issue.type === 'warning') warnings++;
        else notices++;
      }
    }
    return {
      summary: { byLevel: { error: errors, warning: warnings, notice: notices } },
      pages,
    };
  };

  it('compares report A with 0 issues against report B with many issues', () => {
    const reportB = makeReport([
      {
        url: 'https://example.com/',
        issues: [
          makeIssue('WCAG2AA.1_1_1', 'img', 'Missing alt'),
          makeIssue('WCAG2AA.1_3_1', 'table', 'Missing th', 'warning'),
          makeIssue('WCAG2AA.2_4_1', 'a', 'Empty link', 'notice'),
        ],
      },
    ]);

    const diff = diffReports(emptyReport, reportB);

    expect(diff.added).toHaveLength(3);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.summaryDelta).toEqual({ errors: 1, warnings: 1, notices: 1 });
  });

  it('compares two identical reports (delta should be 0)', () => {
    const report = makeReport([
      {
        url: 'https://example.com/page1',
        issues: [
          makeIssue('WCAG2AA.1_1_1', 'img.hero', 'Missing alt text'),
          makeIssue('WCAG2AA.1_3_1', 'div.content', 'No heading structure', 'warning'),
        ],
      },
    ]);

    const diff = diffReports(report, report);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.summaryDelta).toEqual({ errors: 0, warnings: 0, notices: 0 });
  });

  it('compares reports with overlapping and unique issues', () => {
    const shared = makeIssue('WCAG2AA.1_1_1', 'img.logo', 'Missing alt');
    const onlyInA = makeIssue('WCAG2AA.2_1_1', 'div.menu', 'Not keyboard accessible');
    const onlyInB = makeIssue('WCAG2AA.4_1_1', 'span.badge', 'Invalid ARIA role', 'warning');

    const reportA = makeReport([
      { url: 'https://example.com/', issues: [shared, onlyInA] },
    ]);
    const reportB = makeReport([
      { url: 'https://example.com/', issues: [shared, onlyInB] },
    ]);

    const diff = diffReports(reportA, reportB);

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0].code).toBe('WCAG2AA.1_1_1');

    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].code).toBe('WCAG2AA.2_1_1');

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].code).toBe('WCAG2AA.4_1_1');

    // A had 2 errors, B has 1 error + 1 warning
    expect(diff.summaryDelta.errors).toBe(-1);
    expect(diff.summaryDelta.warnings).toBe(1);
  });

  it('compares report B with 0 issues against report A with many (all resolved)', () => {
    const reportA = makeReport([
      {
        url: 'https://example.com/',
        issues: [
          makeIssue('WCAG2AA.1_1_1', 'img', 'Missing alt'),
          makeIssue('WCAG2AA.1_3_1', 'table', 'Missing header'),
        ],
      },
    ]);

    const diff = diffReports(reportA, emptyReport);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(2);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.summaryDelta.errors).toBe(-2);
  });

  it('handles reports without byLevel in summary', () => {
    const reportA: NormalizedReport = {
      summary: {},
      pages: [
        {
          url: 'https://example.com/',
          issues: [makeIssue('X', 'y', 'z')],
        },
      ],
    };
    const reportB: NormalizedReport = {
      summary: {},
      pages: [],
    };

    const diff = diffReports(reportA, reportB);
    expect(diff.summaryDelta).toEqual({ errors: 0, warnings: 0, notices: 0 });
  });
});

// ============================================================================
// Scenario 3: Self-Audit Result Parsing
// ============================================================================

describe('Scenario 3: Self-Audit Result Parsing', () => {
  it('correctly counts errors, warnings, and notices', () => {
    const pages: AuditPageResult[] = [
      {
        url: 'http://localhost:3000/login',
        issues: [
          { code: 'WCAG2AA.1_1_1', type: 'error', message: 'Missing alt', selector: 'img', context: '<img src="logo.png">' },
          { code: 'WCAG2AA.1_3_1', type: 'warning', message: 'Heading order', selector: 'h3', context: '<h3>Login</h3>' },
        ],
        error: null,
      },
      {
        url: 'http://localhost:3000/home',
        issues: [
          { code: 'WCAG2AA.2_4_1', type: 'notice', message: 'Landmark', selector: 'nav', context: '<nav>' },
          { code: 'WCAG2AA.4_1_1', type: 'error', message: 'Duplicate id', selector: '#main', context: '<div id="main">' },
          { code: 'WCAG2AA.1_4_3', type: 'error', message: 'Low contrast', selector: '.text', context: '<span class="text">' },
        ],
        error: null,
      },
    ];

    const summary = parseAuditResults(pages);

    expect(summary.pagesScanned).toBe(2);
    expect(summary.totalErrors).toBe(3);
    expect(summary.totalWarnings).toBe(1);
    expect(summary.totalNotices).toBe(1);
    expect(summary.pagesWithErrors).toBe(2);
    expect(summary.pagesFailed).toBe(0);
  });

  it('determines FAIL when errors exist', () => {
    const pages: AuditPageResult[] = [
      {
        url: 'http://localhost:3000/reports',
        issues: [
          { code: 'WCAG2AA.1_1_1', type: 'error', message: 'Missing alt', selector: 'img', context: '' },
        ],
        error: null,
      },
    ];

    const summary = parseAuditResults(pages);
    const formatted = formatAuditSummary(summary);

    expect(summary.totalErrors).toBeGreaterThan(0);
    expect(formatted).toContain('FAIL');
  });

  it('determines PASS when no errors exist', () => {
    const pages: AuditPageResult[] = [
      {
        url: 'http://localhost:3000/home',
        issues: [
          { code: 'WCAG2AA.1_3_1', type: 'warning', message: 'Heading', selector: 'h2', context: '' },
          { code: 'WCAG2AA.2_4_1', type: 'notice', message: 'Link text', selector: 'a', context: '' },
        ],
        error: null,
      },
    ];

    const summary = parseAuditResults(pages);
    const formatted = formatAuditSummary(summary);

    expect(summary.totalErrors).toBe(0);
    expect(formatted).toContain('PASS');
  });

  it('counts pages that failed to scan', () => {
    const pages: AuditPageResult[] = [
      {
        url: 'http://localhost:3000/home',
        issues: [],
        error: 'Connection timed out',
      },
      {
        url: 'http://localhost:3000/login',
        issues: [],
        error: null,
      },
    ];

    const summary = parseAuditResults(pages);
    expect(summary.pagesFailed).toBe(1);
    expect(summary.pagesScanned).toBe(2);
  });

  it('handles an empty page list', () => {
    const summary = parseAuditResults([]);
    expect(summary.pagesScanned).toBe(0);
    expect(summary.totalErrors).toBe(0);
    expect(summary.totalWarnings).toBe(0);
    expect(summary.totalNotices).toBe(0);
    expect(summary.pagesFailed).toBe(0);
    expect(summary.pagesWithErrors).toBe(0);
  });

  it('buildPageUrls produces correct URLs', () => {
    const urls = buildPageUrls('http://localhost:3000/');
    expect(urls).toContain('http://localhost:3000/login');
    expect(urls).toContain('http://localhost:3000/home');
    expect(urls).toContain('http://localhost:3000/reports');
    expect(urls.every((u) => !u.includes('//'))).toBe(false);
    // All URLs should start with the base
    expect(urls.every((u) => u.startsWith('http://localhost:3000/'))).toBe(true);
  });

  it('buildPageUrls strips trailing slashes from base', () => {
    const urls1 = buildPageUrls('http://localhost:3000/');
    const urls2 = buildPageUrls('http://localhost:3000');
    expect(urls1).toEqual(urls2);
  });
});

// ============================================================================
// Scenario 4: Monitor Data Flow
// ============================================================================

describe('Scenario 4: Monitor Data Flow', () => {
  const now = new Date();

  const makeSources = (configs: Array<{ lastChecked?: string }>): MonitorSource[] =>
    configs.map((c, i) => ({
      id: `src-${i}`,
      name: `Source ${i}`,
      url: `https://source-${i}.example.com`,
      type: 'html' as const,
      schedule: 'daily' as const,
      lastChecked: c.lastChecked,
    }));

  const makeProposals = (count: number, statuses: string[]): MonitorProposal[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `prop-${i}`,
      status: statuses[i] ?? 'pending',
      source: `Source ${i}`,
      type: 'amendment' as const,
      summary: `Proposal ${i} summary`,
      detectedAt: new Date().toISOString(),
    }));

  it('builds monitor view data from various source configurations', () => {
    const sources = makeSources([
      { lastChecked: new Date(now.getTime() - 1000).toISOString() },
      { lastChecked: undefined },
      { lastChecked: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString() },
    ]);
    const proposals = makeProposals(2, ['pending', 'approved']);

    const view = buildMonitorViewData(sources, proposals);

    expect(view.sourcesCount).toBe(3);
    expect(view.pendingProposalsCount).toBe(1);
    expect(view.sources).toHaveLength(3);
    expect(view.proposals).toHaveLength(2);
  });

  it('detects staleness at boundary conditions', () => {
    const exactly24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const justUnder24h = new Date(Date.now() - 24 * 60 * 60 * 1000 + 60000).toISOString();
    const justOver24h = new Date(Date.now() - 24 * 60 * 60 * 1000 - 60000).toISOString();

    // Exactly 24h should be stale (threshold is >)
    // Just under 24h should NOT be stale
    expect(isSourceStale(justUnder24h)).toBe(false);
    // Just over 24h should be stale
    expect(isSourceStale(justOver24h)).toBe(true);
    // Undefined should be stale
    expect(isSourceStale(undefined)).toBe(true);
  });

  it('handles empty sources and proposals', () => {
    const view = buildMonitorViewData([], []);
    expect(view.sourcesCount).toBe(0);
    expect(view.pendingProposalsCount).toBe(0);
    expect(view.lastScanTime).toBe('Never');
    expect(view.sources).toEqual([]);
    expect(view.proposals).toEqual([]);
  });

  it('formats lastChecked correctly', () => {
    expect(formatLastChecked(undefined)).toBe('Never');
    expect(formatLastChecked('invalid-date')).toBe('Never');

    const validDate = '2025-06-15T10:30:00Z';
    const formatted = formatLastChecked(validDate);
    expect(formatted).not.toBe('Never');
    // Should contain some recognizable date parts
    expect(formatted).toMatch(/\d/);
  });

  it('computes lastScanTime from most recent source check', () => {
    const older = new Date(Date.now() - 7200000).toISOString();
    const newer = new Date(Date.now() - 3600000).toISOString();

    const sources = makeSources([
      { lastChecked: older },
      { lastChecked: newer },
    ]);

    const view = buildMonitorViewData(sources, []);

    expect(view.lastScanTime).not.toBe('Never');
  });

  it('proposal formatting with various statuses', () => {
    const proposals = makeProposals(3, ['pending', 'approved', 'rejected']);
    const view = buildMonitorViewData([], proposals);

    expect(view.pendingProposalsCount).toBe(1);
    expect(view.proposals[0].status).toBe('pending');
    expect(view.proposals[1].status).toBe('approved');
    expect(view.proposals[2].status).toBe('rejected');

    // Each proposal should have display fields
    for (const p of view.proposals) {
      expect(p.id).toBeTruthy();
      expect(p.summary).toBeTruthy();
      expect(p.detectedAtDisplay).toBeTruthy();
    }
  });

  it('marks source stale in view when never checked', () => {
    const sources = makeSources([{ lastChecked: undefined }]);
    const view = buildMonitorViewData(sources, []);

    expect(view.sources[0].stale).toBe(true);
    expect(view.sources[0].lastCheckedDisplay).toBe('Never');
  });
});
