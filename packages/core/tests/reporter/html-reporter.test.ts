import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateHtmlReport, buildAnnotatedPages } from '../../src/reporter/html-reporter.js';
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

    it('includes WCAG URL link in report when wcagUrl is available', async () => {
      const reportPath = await generateHtmlReport({
        siteUrl: 'https://example.com',
        pages,
        errors,
        outputDir,
        compliance,
      });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('www.w3.org/WAI/WCAG21/Understanding/non-text-content');
      expect(html).toContain('wcag-link');
    });
  });

  describe('WCAG hyperlinks', () => {
    it('renders WCAG URL as a link in the issue table', async () => {
      const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages, errors, outputDir });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('href="https://www.w3.org/WAI/WCAG21/Understanding/non-text-content"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener"');
    });
  });
});

describe('buildAnnotatedPages — confirmed violations vs. needs review', () => {
  const errorIssue = {
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'error' as const,
    message: 'Missing alt',
    selector: 'img',
    context: '<img>',
  };
  const warningIssue = {
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'warning' as const,
    message: 'Check alt',
    selector: 'img.warn',
    context: '<img class="warn">',
  };
  const noticeIssue = {
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'notice' as const,
    message: 'Verify alt',
    selector: 'img.note',
    context: '<img class="note">',
  };

  const compliance: ComplianceEnrichment = {
    summary: { totalJurisdictions: 1, passing: 0, failing: 1, totalMandatoryViolations: 3 },
    matrix: {
      EU: {
        jurisdictionId: 'EU',
        jurisdictionName: 'European Union',
        status: 'fail',
        mandatoryViolations: 3,
        recommendedViolations: 0,
        regulations: [],
      },
    },
    issueAnnotations: new Map([
      [
        'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
        [{ regulationName: 'EU Accessibility Act', shortName: 'EAA', jurisdictionId: 'EU', obligation: 'mandatory' }],
      ],
    ]),
  };

  it('counts only error-type issues as confirmedViolations', () => {
    const pages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 3, issues: [errorIssue, warningIssue, noticeIssue] },
    ];
    const { enrichedMatrix } = buildAnnotatedPages(pages, compliance);
    expect(enrichedMatrix).not.toBeNull();
    const eu = enrichedMatrix![0];
    expect(eu.confirmedViolations).toBe(1);
    expect(eu.needsReview).toBe(2);
    expect(eu.reviewStatus).toBe('fail');
  });

  it('sets reviewStatus to review when only warnings/notices present', () => {
    const pages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 2, issues: [warningIssue, noticeIssue] },
    ];
    const { enrichedMatrix } = buildAnnotatedPages(pages, compliance);
    const eu = enrichedMatrix![0];
    expect(eu.confirmedViolations).toBe(0);
    expect(eu.needsReview).toBe(2);
    expect(eu.reviewStatus).toBe('review');
  });

  it('sets reviewStatus to pass when no mandatory issues', () => {
    const pages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 0, issues: [] },
    ];
    const { enrichedMatrix } = buildAnnotatedPages(pages, compliance);
    const eu = enrichedMatrix![0];
    expect(eu.confirmedViolations).toBe(0);
    expect(eu.needsReview).toBe(0);
    expect(eu.reviewStatus).toBe('pass');
  });

  it('shows REVIEW NEEDED status in HTML when only warnings present', async () => {
    const outputDir = join(tmpdir(), `pally-review-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    const reviewPages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 1, issues: [warningIssue] },
    ];
    try {
      const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages: reviewPages, errors: [], outputDir, compliance });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('REVIEW NEEDED');
      // juris-status element should have s-review class, not s-fail
      expect(html).toContain('class="juris-status s-review"');
      expect(html).not.toContain('class="juris-status s-fail"');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('shows FAIL status in HTML when error-type issues present', async () => {
    const outputDir = join(tmpdir(), `pally-fail-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    const failPages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 1, issues: [errorIssue] },
    ];
    try {
      const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages: failPages, errors: [], outputDir, compliance });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('s-fail');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('returns null enrichedMatrix when no compliance provided', () => {
    const pages = [
      { url: 'https://example.com/', discoveryMethod: 'sitemap' as const, issueCount: 0, issues: [] },
    ];
    const { enrichedMatrix } = buildAnnotatedPages(pages, null);
    expect(enrichedMatrix).toBeNull();
  });
});

describe('buildAnnotatedPages — template issue deduplication', () => {
  function makeIssue(overrides: Partial<PageResult['issues'][number]> = {}): PageResult['issues'][number] {
    return {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Missing alt text',
      selector: 'header img',
      context: '<img src="logo.png">',
      ...overrides,
    };
  }

  function makePage(url: string, issues: PageResult['issues']): PageResult {
    return { url, discoveryMethod: 'sitemap', issueCount: issues.length, issues };
  }

  it('extracts template issues that appear on 3+ pages', () => {
    const sharedIssue = makeIssue();
    const pages: PageResult[] = [
      makePage('https://example.com/1', [sharedIssue]),
      makePage('https://example.com/2', [sharedIssue]),
      makePage('https://example.com/3', [sharedIssue]),
      makePage('https://example.com/4', [sharedIssue]),
      makePage('https://example.com/5', [sharedIssue]),
    ];
    const { templateIssues } = buildAnnotatedPages(pages, undefined);
    expect(templateIssues).toHaveLength(1);
    expect(templateIssues[0].affectedCount).toBe(5);
  });

  it('sets affectedPages to the list of page URLs', () => {
    const sharedIssue = makeIssue();
    const pages: PageResult[] = [
      makePage('https://example.com/a', [sharedIssue]),
      makePage('https://example.com/b', [sharedIssue]),
      makePage('https://example.com/c', [sharedIssue]),
    ];
    const { templateIssues } = buildAnnotatedPages(pages, undefined);
    expect(templateIssues[0].affectedPages).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('removes template issues from individual page results', () => {
    const sharedIssue = makeIssue();
    const uniqueIssue = makeIssue({ selector: 'main h1', context: '<h1>Title</h1>' });
    const pages: PageResult[] = [
      makePage('https://example.com/1', [sharedIssue, uniqueIssue]),
      makePage('https://example.com/2', [sharedIssue]),
      makePage('https://example.com/3', [sharedIssue]),
    ];
    const { annotatedPages } = buildAnnotatedPages(pages, undefined);
    // sharedIssue should be removed from page 1
    expect(annotatedPages[0].issues).toHaveLength(1);
    expect(annotatedPages[0].issues[0].selector).toBe('main h1');
    // sharedIssue should be removed from pages 2 and 3 too
    expect(annotatedPages[1].issues).toHaveLength(0);
    expect(annotatedPages[2].issues).toHaveLength(0);
  });

  it('does NOT treat issues appearing on fewer than 3 pages as template issues', () => {
    const sharedIssue = makeIssue();
    const pages: PageResult[] = [
      makePage('https://example.com/1', [sharedIssue]),
      makePage('https://example.com/2', [sharedIssue]),
    ];
    const { templateIssues, annotatedPages } = buildAnnotatedPages(pages, undefined);
    expect(templateIssues).toHaveLength(0);
    // Issue should remain on pages
    expect(annotatedPages[0].issues).toHaveLength(1);
    expect(annotatedPages[1].issues).toHaveLength(1);
  });

  it('handles pages with no shared issues gracefully', () => {
    const pages: PageResult[] = [
      makePage('https://example.com/1', [makeIssue({ selector: 'div.a' })]),
      makePage('https://example.com/2', [makeIssue({ selector: 'div.b' })]),
      makePage('https://example.com/3', [makeIssue({ selector: 'div.c' })]),
    ];
    const { templateIssues, annotatedPages } = buildAnnotatedPages(pages, undefined);
    expect(templateIssues).toHaveLength(0);
    expect(annotatedPages[0].issues).toHaveLength(1);
    expect(annotatedPages[1].issues).toHaveLength(1);
    expect(annotatedPages[2].issues).toHaveLength(1);
  });

  it('renders template issues section in HTML report', async () => {
    const sharedIssue = makeIssue();
    const templatePages: PageResult[] = [
      makePage('https://example.com/p1', [sharedIssue]),
      makePage('https://example.com/p2', [sharedIssue]),
      makePage('https://example.com/p3', [sharedIssue]),
      makePage('https://example.com/p4', [sharedIssue]),
    ];
    const outputDir = join(tmpdir(), `pally-template-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    try {
      const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages: templatePages, errors: [], outputDir });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).toContain('id="template-issues"');
      expect(html).toContain('Template &amp; Layout Issues');
      expect(html).toContain('Affects 4 pages');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does NOT render template issues section when no template issues exist', async () => {
    const uniquePages: PageResult[] = [
      makePage('https://example.com/x', [makeIssue({ selector: 'div.x' })]),
    ];
    const outputDir = join(tmpdir(), `pally-notemplate-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
    try {
      const reportPath = await generateHtmlReport({ siteUrl: 'https://example.com', pages: uniquePages, errors: [], outputDir });
      const html = readFileSync(reportPath, 'utf-8');
      expect(html).not.toContain('id="template-issues"');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
