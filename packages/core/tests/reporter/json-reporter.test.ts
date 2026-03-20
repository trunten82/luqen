import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateJsonReport } from '../../src/reporter/json-reporter.js';
import type { PageResult, ScanError, ComplianceEnrichment } from '../../src/types.js';
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

  it('includes compliance field in JSON output when compliance data is provided', async () => {
    const compliance: ComplianceEnrichment = {
      summary: { totalJurisdictions: 1, passing: 0, failing: 1, totalMandatoryViolations: 1 },
      matrix: {
        EU: {
          jurisdictionId: 'EU',
          jurisdictionName: 'European Union',
          status: 'fail',
          mandatoryViolations: 1,
          recommendedViolations: 0,
          regulations: [
            { regulationId: 'eaa', regulationName: 'EU Accessibility Act', shortName: 'EAA', status: 'fail', enforcementDate: '2025-06-28', violationCount: 1 },
          ],
        },
      },
      issueAnnotations: new Map([
        ['WCAG2AA.H37', [{ regulationName: 'EU Accessibility Act', shortName: 'EAA', jurisdictionId: 'EU', obligation: 'mandatory' }]],
      ]),
    };

    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir, compliance });
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.compliance).toBeDefined();
    expect(content.compliance.summary.totalJurisdictions).toBe(1);
    expect(content.compliance.matrix.EU.status).toBe('fail');
    expect(content.compliance.issueAnnotations['WCAG2AA.H37']).toBeDefined();
  });

  it('does not include compliance field when compliance is not provided', async () => {
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.compliance).toBeUndefined();
  });

  it('does not include compliance field when compliance is null', async () => {
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir, compliance: null });
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.compliance).toBeUndefined();
  });

  it('includes nextSteps suggesting compliance when no compliance data', async () => {
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.nextSteps).toBeDefined();
    expect(Array.isArray(content.nextSteps)).toBe(true);
    expect(content.nextSteps.some((s: string) => /compliance/i.test(s))).toBe(true);
  });

  it('includes nextSteps suggesting dashboard when compliance data is present', async () => {
    const compliance: ComplianceEnrichment = {
      summary: { totalJurisdictions: 1, passing: 1, failing: 0, totalMandatoryViolations: 0 },
      matrix: {
        EU: {
          jurisdictionId: 'EU',
          jurisdictionName: 'European Union',
          status: 'pass',
          mandatoryViolations: 0,
          recommendedViolations: 0,
          regulations: [],
        },
      },
      issueAnnotations: new Map(),
    };
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages, errors, outputDir, compliance });
    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.nextSteps).toBeDefined();
    expect(content.nextSteps.some((s: string) => /dashboard/i.test(s))).toBe(true);
  });

  it('counts notice issues in byLevel', async () => {
    const noticePages: PageResult[] = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap', issueCount: 1, issues: [
        { code: 'WCAG2AA.H37', type: 'notice', message: 'Consider alt', selector: 'img', context: '<img>' },
      ]},
    ];
    const report = await generateJsonReport({ siteUrl: 'https://example.com', pages: noticePages, errors: [], outputDir });
    expect(report.summary.byLevel.notice).toBe(1);
  });
});
