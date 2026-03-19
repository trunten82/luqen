import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateHtmlReport } from '../../src/reporter/html-reporter.js';
import type { PageResult, ScanError, ComplianceEnrichment } from '../../src/types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateHtmlReport', () => {
  let outputDir: string;
  beforeEach(() => { outputDir = join(tmpdir(), `pally-html-test-${Date.now()}`); mkdirSync(outputDir, { recursive: true }); });
  afterEach(() => { rmSync(outputDir, { recursive: true, force: true }); });

  const pages: PageResult[] = [
    { url: 'https://example.com/', discoveryMethod: 'sitemap', issueCount: 1, issues: [
      { code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
    ]},
  ];
  const errors: ScanError[] = [];

  it('generates a self-contained HTML file with no external references', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(existsSync(reportPath)).toBe(true);
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/<link\s+.*href=.*\.css/);
    expect(html).toMatch(/\d+\s+pages?\s+scanned/i);
    expect(html).toContain('https://example.com/');
    expect(html).toContain('page-section');
  });

  it('includes summary card with page count', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('summary-card');
    expect(html).toContain('Pages Scanned');
  });

  it('has collapsible page sections', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('page-header');
    expect(html).toContain('page-body');
    expect(html).toContain('toggleSection');
  });

  it('does not overwrite existing report files', async () => {
    const path1 = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    await new Promise((r) => setTimeout(r, 10));
    const path2 = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    expect(path1).not.toBe(path2);
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);
  });

  it('includes WCAG criterion number when code matches known pattern', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('WCAG 1.1.1');
  });

  it('includes WCAG human-friendly title for known criteria', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('Non-text Content');
  });

  it('does NOT include compliance section when no compliance data is provided', async () => {
    const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
    const html = readFileSync(reportPath, 'utf-8');
    expect(html).not.toContain('id="compliance-matrix"');
    expect(html).not.toContain('Legal Compliance Matrix');
  });

  describe('with compliance enrichment', () => {
    const compliance: ComplianceEnrichment = {
      summary: {
        totalJurisdictions: 2,
        passing: 1,
        failing: 1,
        totalMandatoryViolations: 2,
      },
      matrix: {
        EU: {
          jurisdictionId: 'EU',
          jurisdictionName: 'European Union',
          status: 'fail',
          mandatoryViolations: 2,
          recommendedViolations: 0,
          regulations: [
            {
              regulationId: 'eu-accessibility-act',
              regulationName: 'EU Accessibility Act',
              shortName: 'EAA',
              status: 'fail',
              enforcementDate: '2025-06-28',
              violationCount: 2,
            },
          ],
        },
        US: {
          jurisdictionId: 'US',
          jurisdictionName: 'United States',
          status: 'pass',
          mandatoryViolations: 0,
          recommendedViolations: 0,
          regulations: [],
        },
      },
      issueAnnotations: new Map([
        [
          'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          [
            {
              regulationName: 'EU Accessibility Act',
              shortName: 'EAA',
              jurisdictionId: 'EU',
              obligation: 'mandatory',
            },
          ],
        ],
      ]),
    };

    it('includes compliance matrix section', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('id="compliance-matrix"');
      expect(html).toContain('Legal Compliance Matrix');
    });

    it('shows passing and failing jurisdiction counts in header', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('1 Passing');
      expect(html).toContain('1 Failing');
    });

    it('shows jurisdiction rows in compliance table', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('European Union');
      expect(html).toContain('United States');
    });

    it('shows regulation short names in the compliance table', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('EAA');
    });

    it('shows regulation tags inline on issue rows', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      // The reg-tag with EAA should appear in the issue table
      expect(html).toContain('reg-tag');
      expect(html).toContain('obligation-mandatory');
    });

    it('shows Legal Impact column header', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('Legal Impact');
    });

    it('does not show compliance section when compliance is null', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance: null,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).not.toContain('id="compliance-matrix"');
      expect(html).not.toContain('Legal Compliance Matrix');
    });

    it('renders obligation-recommended class for recommended obligations', async () => {
      const mixedCompliance: ComplianceEnrichment = {
        summary: { totalJurisdictions: 1, passing: 1, failing: 0, totalMandatoryViolations: 0 },
        matrix: {
          EU: {
            jurisdictionId: 'EU',
            jurisdictionName: 'European Union',
            status: 'pass',
            mandatoryViolations: 0,
            recommendedViolations: 1,
            regulations: [],
          },
        },
        issueAnnotations: new Map([
          [
            'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            [
              {
                regulationName: 'EU Accessibility Act',
                shortName: 'EAA',
                jurisdictionId: 'EU',
                obligation: 'recommended',
              },
            ],
          ],
        ]),
      };
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance: mixedCompliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('obligation-recommended');
    });

    it('renders obligation-optional class for optional obligations', async () => {
      const optionalCompliance: ComplianceEnrichment = {
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
        issueAnnotations: new Map([
          [
            'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            [
              {
                regulationName: 'EU Accessibility Act',
                shortName: 'EAA',
                jurisdictionId: 'EU',
                obligation: 'optional',
              },
            ],
          ],
        ]),
      };
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance: optionalCompliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('obligation-optional');
    });
  });
});
