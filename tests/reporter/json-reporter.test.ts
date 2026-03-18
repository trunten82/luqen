import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateJsonReport } from '../../src/reporter/json-reporter.js';
import type { PageResult, ScanError } from '../../src/types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateJsonReport', () => {
  let outputDir: string;
  beforeEach(() => { outputDir = join(tmpdir(), `pally-json-test-${Date.now()}`); mkdirSync(outputDir, { recursive: true }); });
  afterEach(() => { rmSync(outputDir, { recursive: true, force: true }); });

  const pages: PageResult[] = [
    { url: 'https://example.com/', discoveryMethod: 'sitemap', issueCount: 2, issues: [
      { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img src="x">' },
      { code: 'WCAG2AA.H44', type: 'warning', message: 'Missing label', selector: 'input', context: '<input>' },
    ]},
    { url: 'https://example.com/about', discoveryMethod: 'sitemap', issueCount: 0, issues: [] },
  ];
  const errors: ScanError[] = [];

  it('generates a valid JSON report with summary', async () => {
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(report.summary.pagesScanned).toBe(2);
    expect(report.summary.totalIssues).toBe(2);
    expect(report.summary.byLevel.error).toBe(1);
    expect(report.summary.byLevel.warning).toBe(1);
    expect(report.summary.byLevel.notice).toBe(0);
  });

  it('writes report to outputDir with timestamped name', async () => {
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(existsSync(report.reportPath)).toBe(true);
    expect(report.reportPath).toMatch(/pally-report-.*\.json$/);
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.summary.totalIssues).toBe(2);
  });

  it('does not overwrite existing report files', async () => {
    const report1 = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    await new Promise((r) => setTimeout(r, 10));
    const report2 = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(report1.reportPath).not.toBe(report2.reportPath);
    expect(existsSync(report1.reportPath)).toBe(true);
    expect(existsSync(report2.reportPath)).toBe(true);
  });
});
