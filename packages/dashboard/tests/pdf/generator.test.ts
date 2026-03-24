import { describe, it, expect } from 'vitest';
import { generatePdfFromData } from '../../src/pdf/generator.js';
import type { PdfScanMeta, PdfReportData } from '../../src/pdf/generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanMeta(overrides: Partial<PdfScanMeta> = {}): PdfScanMeta {
  return {
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: 'EU, US',
    createdAtDisplay: '2025-06-15 12:00',
    ...overrides,
  };
}

function makeReportData(overrides: Partial<PdfReportData> = {}): PdfReportData {
  return {
    summary: {
      pagesScanned: 10,
      totalIssues: 15,
      byLevel: { error: 5, warning: 7, notice: 3 },
    },
    topActionItems: [
      {
        severity: 'error',
        count: 3,
        criterion: '1.1.1',
        title: 'Images must have alt text',
        pageCount: 5,
        regulations: [{ shortName: 'EAA' }],
      },
      {
        severity: 'warning',
        count: 2,
        criterion: '2.4.6',
        title: 'Headings must be descriptive',
        pageCount: 3,
        regulations: [],
      },
    ],
    complianceMatrix: [
      {
        jurisdictionName: 'European Union',
        reviewStatus: 'fail',
        confirmedViolations: 3,
        needsReview: 1,
      },
    ],
    templateComponents: [
      {
        componentName: 'Header',
        issueCount: 4,
        maxAffectedPages: 8,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PDF Generator (PDFKit)', () => {
  // -----------------------------------------------------------------------
  // Basic generation
  // -----------------------------------------------------------------------

  describe('generatePdfFromData', () => {
    it('returns a Buffer', async () => {
      const result = await generatePdfFromData(makeScanMeta(), makeReportData());
      expect(result).toBeInstanceOf(Buffer);
    });

    it('returns a valid PDF starting with %PDF header', async () => {
      const result = await generatePdfFromData(makeScanMeta(), makeReportData());
      const header = result.subarray(0, 5).toString('ascii');
      expect(header).toBe('%PDF-');
    });

    it('produces a non-trivial buffer size', async () => {
      const result = await generatePdfFromData(makeScanMeta(), makeReportData());
      // A real PDF with content should be at least a few KB
      expect(result.length).toBeGreaterThan(1000);
    });
  });

  // -----------------------------------------------------------------------
  // Various report data shapes
  // -----------------------------------------------------------------------

  describe('report data variations', () => {
    it('works without compliance matrix (null)', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ complianceMatrix: null }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works without compliance matrix (undefined)', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ complianceMatrix: undefined }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works with empty compliance matrix', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ complianceMatrix: [] }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works without template components', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ templateComponents: [] }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works with empty topActionItems', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ topActionItems: [] }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works with many action items (page overflow)', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        severity: i % 2 === 0 ? 'error' : 'warning',
        count: i + 1,
        criterion: `${(i % 4) + 1}.${(i % 5) + 1}.${(i % 3) + 1}`,
        title: `Issue number ${i + 1} that needs to be fixed`,
        pageCount: Math.floor(Math.random() * 20) + 1,
        regulations: i % 3 === 0 ? [{ shortName: 'EAA' }] : [],
      }));

      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ topActionItems: items }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      // With 50 items it should produce a larger PDF
      expect(result.length).toBeGreaterThan(3000);
    });

    it('works with scan errors section', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          errors: [
            { url: 'https://example.com/broken', code: 'TIMEOUT', message: 'Page timed out' },
            { url: 'https://example.com/404', code: 'HTTP_ERROR', message: '404 Not Found' },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works without scan errors', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ errors: undefined }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works with empty errors array', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ errors: [] }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Summary variations
  // -----------------------------------------------------------------------

  describe('summary variations', () => {
    it('handles missing byLevel', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          summary: { pagesScanned: 5, totalIssues: 0 },
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('handles missing pagesScanned', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          summary: { totalIssues: 10, byLevel: { error: 3, warning: 4, notice: 3 } },
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('handles zero issues', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          summary: { pagesScanned: 5, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
          topActionItems: [],
          complianceMatrix: null,
          templateComponents: [],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('handles empty summary object', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({ summary: {} }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Scan meta variations
  // -----------------------------------------------------------------------

  describe('scan meta variations', () => {
    it('works with empty jurisdictions', async () => {
      const result = await generatePdfFromData(
        makeScanMeta({ jurisdictions: '' }),
        makeReportData(),
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('works with WCAG2A standard', async () => {
      const result = await generatePdfFromData(
        makeScanMeta({ standard: 'WCAG2A' }),
        makeReportData(),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('works with WCAG2AAA standard', async () => {
      const result = await generatePdfFromData(
        makeScanMeta({ standard: 'WCAG2AAA' }),
        makeReportData(),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('works with unknown standard code', async () => {
      const result = await generatePdfFromData(
        makeScanMeta({ standard: 'Section508' }),
        makeReportData(),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Compliance matrix statuses
  // -----------------------------------------------------------------------

  describe('compliance matrix statuses', () => {
    it('renders fail status', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          complianceMatrix: [
            { jurisdictionName: 'EU', reviewStatus: 'fail', confirmedViolations: 5 },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders review status', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          complianceMatrix: [
            { jurisdictionName: 'US', reviewStatus: 'review', confirmedViolations: 0, needsReview: 3 },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders pass status', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          complianceMatrix: [
            { jurisdictionName: 'UK', reviewStatus: 'pass', confirmedViolations: 0 },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders multiple jurisdictions', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          complianceMatrix: [
            { jurisdictionName: 'EU', reviewStatus: 'fail', confirmedViolations: 5 },
            { jurisdictionName: 'US', reviewStatus: 'review', confirmedViolations: 1, needsReview: 2 },
            { jurisdictionName: 'UK', reviewStatus: 'pass', confirmedViolations: 0 },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Template components
  // -----------------------------------------------------------------------

  describe('template components', () => {
    it('renders multiple template components', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          templateComponents: [
            { componentName: 'Header', issueCount: 4, maxAffectedPages: 8 },
            { componentName: 'Footer', issueCount: 2, maxAffectedPages: 10 },
            { componentName: 'Sidebar', issueCount: 1, maxAffectedPages: 5 },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Action item severity types
  // -----------------------------------------------------------------------

  describe('action item severities', () => {
    it('renders error severity items', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          topActionItems: [
            { severity: 'error', count: 5, criterion: '1.1.1', title: 'Missing alt text', pageCount: 3, regulations: [] },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders warning severity items', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          topActionItems: [
            { severity: 'warning', count: 2, criterion: '2.4.6', title: 'Empty heading', pageCount: 1, regulations: [] },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });

    it('renders items with multiple regulations', async () => {
      const result = await generatePdfFromData(
        makeScanMeta(),
        makeReportData({
          topActionItems: [
            {
              severity: 'error',
              count: 4,
              criterion: '1.3.1',
              title: 'Info and relationships',
              pageCount: 7,
              regulations: [{ shortName: 'EAA' }, { shortName: 'ADA' }, { shortName: 'AODA' }],
            },
          ],
        }),
      );
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  // -----------------------------------------------------------------------
  // Module exports
  // -----------------------------------------------------------------------

  describe('module exports', () => {
    it('exports generatePdfFromData function', async () => {
      const mod = await import('../../src/pdf/generator.js');
      expect(typeof mod.generatePdfFromData).toBe('function');
    });

    it('does not export legacy Puppeteer functions', async () => {
      const mod = await import('../../src/pdf/generator.js');
      expect((mod as any).generateReportPdf).toBeUndefined();
      expect((mod as any).isPuppeteerAvailable).toBeUndefined();
      expect((mod as any).closeBrowser).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent generation
  // -----------------------------------------------------------------------

  describe('concurrent generation', () => {
    it('handles concurrent PDF generation', async () => {
      const results = await Promise.all([
        generatePdfFromData(makeScanMeta({ siteUrl: 'https://a.com' }), makeReportData()),
        generatePdfFromData(makeScanMeta({ siteUrl: 'https://b.com' }), makeReportData()),
        generatePdfFromData(makeScanMeta({ siteUrl: 'https://c.com' }), makeReportData()),
      ]);

      for (const result of results) {
        expect(result).toBeInstanceOf(Buffer);
        expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Full report with all sections
  // -----------------------------------------------------------------------

  describe('full report', () => {
    it('generates a complete report with all sections populated', async () => {
      const result = await generatePdfFromData(
        makeScanMeta({
          siteUrl: 'https://full-test.example.com',
          standard: 'WCAG2AA',
          jurisdictions: 'EU, US, UK',
          createdAtDisplay: '2025-06-15 14:30',
        }),
        makeReportData({
          summary: {
            pagesScanned: 25,
            totalIssues: 42,
            byLevel: { error: 12, warning: 18, notice: 12 },
          },
          topActionItems: [
            { severity: 'error', count: 8, criterion: '1.1.1', title: 'Images missing alt text', pageCount: 15, regulations: [{ shortName: 'EAA' }] },
            { severity: 'error', count: 4, criterion: '1.3.1', title: 'Info and relationships', pageCount: 10, regulations: [{ shortName: 'ADA' }] },
            { severity: 'warning', count: 6, criterion: '2.4.6', title: 'Headings and labels', pageCount: 8, regulations: [] },
          ],
          complianceMatrix: [
            { jurisdictionName: 'European Union', reviewStatus: 'fail', confirmedViolations: 5, needsReview: 2 },
            { jurisdictionName: 'United States', reviewStatus: 'review', confirmedViolations: 1, needsReview: 4 },
            { jurisdictionName: 'United Kingdom', reviewStatus: 'pass', confirmedViolations: 0 },
          ],
          templateComponents: [
            { componentName: 'Navigation', issueCount: 6, maxAffectedPages: 25 },
            { componentName: 'Footer', issueCount: 3, maxAffectedPages: 25 },
          ],
          errors: [
            { url: 'https://full-test.example.com/timeout', code: 'TIMEOUT', message: 'Request timed out after 30s' },
          ],
        }),
      );

      expect(result).toBeInstanceOf(Buffer);
      expect(result.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(result.length).toBeGreaterThan(2000);
    });
  });
});
