/**
 * Regression: reports-list OOM/502.
 *
 * The `json_report` column stores the ENTIRE scan report JSON inline (multi-MB
 * per row; 66 MB max observed on live). `listScans`/`listForOrg` previously did
 * `SELECT *`, dragging every row's blob into the V8 heap. The `/reports` list
 * route fetches a page plus a per-row "compare previous" lookup, so admin page-1
 * materialized hundreds of MB→GB of report JSON as UTF-16 strings → heap OOM
 * (SIGABRT) → nginx 502.
 *
 * Contract pinned here:
 *  - list queries omit `jsonReport` by default (metadata only)
 *  - `listScans({ includeReport: true })` opt-in still returns the blob (batch
 *    services: branding-retag, rescore, migrate-data depend on it)
 *  - `getReport(id)` — the detail path — still returns the parsed blob
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';

const BIG_REPORT = JSON.stringify({
  summary: { totalIssues: 5, pagesScanned: 3 },
  filler: 'x'.repeat(200_000),
});

describe('scan list queries exclude json_report blob (OOM guard)', () => {
  let tmpDir: string;
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'luqen-list-noreport-'));
    storage = new SqliteStorageAdapter(join(tmpDir, 'test.sqlite'));
    await storage.migrate();
    await storage.scans.createScan({
      id: 'scan-1',
      siteUrl: 'https://example.com/',
      standard: 'WCAG2AA',
      jurisdictions: [],
      regulations: [],
      createdBy: 'alice',
      createdAt: new Date().toISOString(),
      orgId: 'org-1',
    });
    await storage.scans.updateScan('scan-1', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      totalIssues: 5,
      jsonReport: BIG_REPORT,
    });
  });

  afterEach(async () => {
    await storage.disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listScans() omits jsonReport but keeps metadata', async () => {
    const [scan] = await storage.scans.listScans();
    expect(scan).toBeDefined();
    expect(scan.jsonReport).toBeUndefined();
    // metadata still present
    expect(scan.status).toBe('completed');
    expect(scan.totalIssues).toBe(5);
    expect(scan.siteUrl).toBe('https://example.com/');
  });

  it('listScans({ includeReport: true }) returns the blob for batch callers', async () => {
    const [scan] = await storage.scans.listScans({ includeReport: true });
    expect(scan.jsonReport).toBe(BIG_REPORT);
  });

  it('listForOrg() omits jsonReport', async () => {
    const { items } = await storage.scans.listForOrg('org-1');
    expect(items[0]).toBeDefined();
    expect(items[0].jsonReport).toBeUndefined();
    expect(items[0].status).toBe('completed');
  });

  it('getReport(id) still returns the parsed report blob', async () => {
    const report = await storage.scans.getReport('scan-1');
    expect(report).not.toBeNull();
    expect((report as { summary: { totalIssues: number } }).summary.totalIssues).toBe(5);
  });
});
