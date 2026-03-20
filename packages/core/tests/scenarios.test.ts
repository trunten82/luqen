/**
 * Synthetic scenario tests for the core package.
 *
 * Scenario 8: Scanner Pipeline
 * Scenario 9: Report Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanUrls, type ScanOptions } from '../src/scanner/scanner.js';
import type { WebserviceClient, Pa11yTask, Pa11yResult } from '../src/scanner/webservice-client.js';
import type { DiscoveredUrl, PageResult, ScanError, ComplianceEnrichment, RegulationAnnotation } from '../src/types.js';
import { generateJsonReport } from '../src/reporter/json-reporter.js';
import { buildAnnotatedPages } from '../src/reporter/html-reporter.js';
import { extractCriterion, getWcagDescription } from '../src/wcag-descriptions.js';
import { parseIssueCode } from '../../compliance/src/engine/matcher.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';

// ============================================================================
// Helpers
// ============================================================================

function makeMockClient(issuesByUrl: Record<string, Array<{ code: string; type: string; message: string; selector: string; context: string }>>): WebserviceClient {
  let taskCounter = 0;
  const taskUrlMap = new Map<string, string>();

  return {
    async createTask(input: { url: string }): Promise<Pa11yTask> {
      const id = `task-${taskCounter++}`;
      taskUrlMap.set(id, input.url);
      return { id, name: `scan-${input.url}`, url: input.url };
    },
    async runTask(): Promise<void> {},
    async getResults(taskId: string): Promise<Pa11yResult[]> {
      const url = taskUrlMap.get(taskId) ?? '';
      const issues = issuesByUrl[url] ?? [];
      return [{
        date: new Date().toISOString(),
        results: issues,
      }];
    },
    async deleteTask(): Promise<void> {},
  } as unknown as WebserviceClient;
}

const defaultScanOptions: ScanOptions = {
  standard: 'WCAG2AA',
  concurrency: 2,
  timeout: 5000,
  pollTimeout: 100,
  ignore: [],
  hideElements: '',
  headers: {},
  wait: 0,
};

// ============================================================================
// Scenario 8: Scanner Pipeline
// ============================================================================

describe('Scenario 8: Scanner Pipeline', () => {
  it('feeds synthetic webservice responses through the scanner', async () => {
    const syntheticIssues = {
      'https://example.com/': [
        { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Missing alt', selector: 'img.hero', context: '<img src="hero.jpg">' },
        { code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42', type: 'warning', message: 'Heading order', selector: 'h3.title', context: '<h3>Title</h3>' },
      ],
      'https://example.com/about': [
        { code: 'WCAG2AA.Principle2.Guideline2_4.2_4_1.G1', type: 'notice', message: 'Bypass blocks', selector: 'body', context: '<body>' },
      ],
    };

    const client = makeMockClient(syntheticIssues);
    const urls: DiscoveredUrl[] = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' },
      { url: 'https://example.com/about', discoveryMethod: 'crawl' },
    ];

    const results = await scanUrls(urls, client, defaultScanOptions);

    expect(results.pages).toHaveLength(2);
    expect(results.errors).toHaveLength(0);

    const homePage = results.pages.find((p) => p.url === 'https://example.com/');
    expect(homePage).toBeDefined();
    expect(homePage!.issues).toHaveLength(2);
    expect(homePage!.issueCount).toBe(2);

    const aboutPage = results.pages.find((p) => p.url === 'https://example.com/about');
    expect(aboutPage).toBeDefined();
    expect(aboutPage!.issues).toHaveLength(1);
    expect(aboutPage!.discoveryMethod).toBe('crawl');
  });

  it('verifies issue enrichment with WCAG mapping', () => {
    const code = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';
    const criterion = extractCriterion(code);
    expect(criterion).toBe('1.1.1');

    const description = getWcagDescription('1.1.1');
    expect(description).toBeDefined();
    expect(description!.title).toBe('Non-text Content');
    expect(description!.url).toContain('w3.org');
  });

  it('verifies template deduplication logic', () => {
    // Create 4 pages with the same issue on 3 of them (template issue threshold)
    const templateIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error' as const,
      message: 'Missing alt on nav logo',
      selector: 'img.nav-logo',
      context: '<img class="nav-logo" src="/logo.svg">',
    };

    const uniqueIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42',
      type: 'warning' as const,
      message: 'Missing heading structure',
      selector: 'div.content',
      context: '<div class="content">',
    };

    const pages: PageResult[] = [
      { url: 'https://example.com/page1', discoveryMethod: 'sitemap', issueCount: 2, issues: [templateIssue, uniqueIssue] },
      { url: 'https://example.com/page2', discoveryMethod: 'sitemap', issueCount: 1, issues: [templateIssue] },
      { url: 'https://example.com/page3', discoveryMethod: 'sitemap', issueCount: 1, issues: [templateIssue] },
      { url: 'https://example.com/page4', discoveryMethod: 'sitemap', issueCount: 1, issues: [uniqueIssue] },
    ];

    const { annotatedPages, templateIssues } = buildAnnotatedPages(pages, null);

    // The template issue should be extracted (appears on 3+ pages)
    expect(templateIssues).toHaveLength(1);
    expect(templateIssues[0].affectedCount).toBe(3);
    expect(templateIssues[0].affectedPages).toContain('https://example.com/page1');
    expect(templateIssues[0].affectedPages).toContain('https://example.com/page2');
    expect(templateIssues[0].affectedPages).toContain('https://example.com/page3');

    // Template issue should be removed from individual pages
    for (const page of annotatedPages) {
      const hasTemplate = page.issues.some(
        (i) => i.code === templateIssue.code && i.selector === templateIssue.selector && i.context === templateIssue.context,
      );
      expect(hasTemplate).toBe(false);
    }

    // Unique issue should remain on pages 1 and 4
    const page1 = annotatedPages.find((p) => p.url === 'https://example.com/page1');
    expect(page1!.issues.some((i) => i.code === uniqueIssue.code)).toBe(true);
  });

  it('handles scanner error for unavailable URL', async () => {
    const client: WebserviceClient = {
      async createTask(input: { url: string }): Promise<Pa11yTask> {
        throw new Error('Connection refused');
      },
      async runTask(): Promise<void> {},
      async getResults(): Promise<Pa11yResult[]> { return []; },
      async deleteTask(): Promise<void> {},
    } as unknown as WebserviceClient;

    const urls: DiscoveredUrl[] = [
      { url: 'https://unreachable.example.com/', discoveryMethod: 'sitemap' },
    ];

    const results = await scanUrls(urls, client, defaultScanOptions);

    expect(results.pages).toHaveLength(0);
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].code).toBe('WEBSERVICE_ERROR');
    expect(results.errors[0].message).toContain('Connection refused');
  });

  it('tracks progress events', async () => {
    const client = makeMockClient({
      'https://example.com/': [
        { code: 'X', type: 'error', message: 'm', selector: 's', context: 'c' },
      ],
    });

    const progressEvents: Array<{ type: string; url: string }> = [];
    const options: ScanOptions = {
      ...defaultScanOptions,
      onProgress: (event) => {
        progressEvents.push({ type: event.type, url: event.url });
      },
    };

    await scanUrls(
      [{ url: 'https://example.com/', discoveryMethod: 'sitemap' }],
      client,
      options,
    );

    expect(progressEvents.some((e) => e.type === 'scan:start')).toBe(true);
    expect(progressEvents.some((e) => e.type === 'scan:complete')).toBe(true);
  });
});

// ============================================================================
// Scenario 9: Report Generation
// ============================================================================

describe('Scenario 9: Report Generation', () => {
  const outputDir = join(tmpdir(), `scenario9-${randomUUID()}`);

  it('generates a JSON report from synthetic data with all fields populated', async () => {
    const pages: PageResult[] = [
      {
        url: 'https://example.com/',
        discoveryMethod: 'sitemap',
        issueCount: 2,
        issues: [
          { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
          { code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42', type: 'warning', message: 'Heading', selector: 'h3', context: '<h3>' },
        ],
      },
      {
        url: 'https://example.com/about',
        discoveryMethod: 'crawl',
        issueCount: 1,
        issues: [
          { code: 'WCAG2AA.Principle2.Guideline2_4.2_4_1.G1', type: 'notice', message: 'Bypass', selector: 'body', context: '<body>' },
        ],
      },
    ];

    const errors: ScanError[] = [
      { url: 'https://example.com/broken', code: 'TIMEOUT', message: 'Timed out', retried: true },
    ];

    const report = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    // Verify all summary fields
    expect(report.summary.url).toBe('https://example.com');
    expect(report.summary.pagesScanned).toBe(2);
    expect(report.summary.pagesFailed).toBe(1);
    expect(report.summary.totalIssues).toBe(3);
    expect(report.summary.byLevel.error).toBe(1);
    expect(report.summary.byLevel.warning).toBe(1);
    expect(report.summary.byLevel.notice).toBe(1);

    // Verify file was created
    expect(report.reportPath).toContain('example-com');
    expect(existsSync(report.reportPath)).toBe(true);

    // Verify JSON content
    const rawContent = readFileSync(report.reportPath, 'utf-8');
    const parsed = JSON.parse(rawContent);
    expect(parsed.summary).toBeDefined();
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.errors).toHaveLength(1);

    // Cleanup
    if (existsSync(report.reportPath)) rmSync(report.reportPath);
  });

  it('generates a JSON report with compliance section when jurisdictions provided', async () => {
    const pages: PageResult[] = [
      {
        url: 'https://example.com/',
        discoveryMethod: 'sitemap',
        issueCount: 1,
        issues: [
          { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
        ],
      },
    ];

    const compliance: ComplianceEnrichment = {
      matrix: {
        EU: {
          jurisdictionId: 'EU',
          jurisdictionName: 'European Union',
          status: 'fail',
          mandatoryViolations: 1,
          recommendedViolations: 0,
          regulations: [{
            regulationId: 'EAA',
            regulationName: 'European Accessibility Act',
            shortName: 'EAA',
            status: 'fail',
            enforcementDate: '2025-06-28',
            violationCount: 1,
          }],
        },
      },
      issueAnnotations: new Map([
        ['WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', [
          {
            regulationName: 'European Accessibility Act',
            shortName: 'EAA',
            jurisdictionId: 'EU',
            obligation: 'mandatory' as const,
          },
        ]],
      ]),
      summary: {
        totalJurisdictions: 1,
        passing: 0,
        failing: 1,
        totalMandatoryViolations: 1,
      },
    };

    const report = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors: [],
      outputDir,
      compliance,
    });

    const rawContent = readFileSync(report.reportPath, 'utf-8');
    const parsed = JSON.parse(rawContent);

    // Compliance section should exist
    expect(parsed.compliance).toBeDefined();
    expect(parsed.compliance.summary).toBeDefined();
    expect(parsed.compliance.matrix).toBeDefined();
    expect(parsed.compliance.matrix.EU).toBeDefined();
    expect(parsed.compliance.matrix.EU.status).toBe('fail');
    expect(parsed.compliance.issueAnnotations).toBeDefined();

    // Cleanup
    if (existsSync(report.reportPath)) rmSync(report.reportPath);
  });

  it('includes template issues in JSON report when present', async () => {
    // Same issue on 3 pages triggers template dedup
    const sharedIssue = {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error' as const,
      message: 'Missing alt on nav logo',
      selector: 'img.nav-logo',
      context: '<img class="nav-logo" src="/logo.svg">',
    };

    const pages: PageResult[] = [
      { url: 'https://example.com/p1', discoveryMethod: 'sitemap', issueCount: 1, issues: [sharedIssue] },
      { url: 'https://example.com/p2', discoveryMethod: 'sitemap', issueCount: 1, issues: [sharedIssue] },
      { url: 'https://example.com/p3', discoveryMethod: 'sitemap', issueCount: 1, issues: [sharedIssue] },
    ];

    const report = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors: [],
      outputDir,
    });

    const rawContent = readFileSync(report.reportPath, 'utf-8');
    const parsed = JSON.parse(rawContent);

    expect(parsed.templateIssues).toBeDefined();
    expect(parsed.templateIssues).toHaveLength(1);
    expect(parsed.templateIssues[0].affectedCount).toBe(3);

    // Cleanup
    if (existsSync(report.reportPath)) rmSync(report.reportPath);
  });

  it('handles empty pages and errors gracefully', async () => {
    const report = await generateJsonReport({
      siteUrl: 'https://empty.example.com',
      pages: [],
      errors: [],
      outputDir,
    });

    expect(report.summary.pagesScanned).toBe(0);
    expect(report.summary.totalIssues).toBe(0);
    expect(report.summary.pagesFailed).toBe(0);
    expect(report.summary.byLevel).toEqual({ error: 0, warning: 0, notice: 0 });

    // Cleanup
    if (existsSync(report.reportPath)) rmSync(report.reportPath);
  });

  it('produces hostname-based filenames', async () => {
    const report = await generateJsonReport({
      siteUrl: 'https://www.my-site.example.com',
      pages: [],
      errors: [],
      outputDir,
    });

    expect(report.reportPath).toContain('www-my-site-example-com');

    // Cleanup
    if (existsSync(report.reportPath)) rmSync(report.reportPath);
  });
});
