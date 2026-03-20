import { describe, it, expect } from 'vitest';
import {
  buildPageUrls,
  parseAuditResults,
  formatAuditSummary,
  type AuditPageResult,
  type AuditSummary,
} from '../src/self-audit.js';

describe('self-audit', () => {
  // -------------------------------------------------------------------------
  // buildPageUrls
  // -------------------------------------------------------------------------
  describe('buildPageUrls', () => {
    it('generates URLs for all dashboard routes from a base URL', () => {
      const urls = buildPageUrls('http://localhost:5000');

      expect(urls).toContain('http://localhost:5000/login');
      expect(urls).toContain('http://localhost:5000/home');
      expect(urls).toContain('http://localhost:5000/reports');
      expect(urls).toContain('http://localhost:5000/scan/new');
      expect(urls).toContain('http://localhost:5000/admin/system');
    });

    it('strips trailing slash from base URL', () => {
      const urls = buildPageUrls('http://localhost:5000/');

      for (const url of urls) {
        expect(url).not.toContain('//login');
        expect(url).toMatch(/^http:\/\/localhost:5000\/[a-z]/);
      }
    });

    it('works with custom port in URL', () => {
      const urls = buildPageUrls('http://127.0.0.1:9999');

      expect(urls.every((u) => u.startsWith('http://127.0.0.1:9999/'))).toBe(true);
    });

    it('returns at least 5 page URLs', () => {
      const urls = buildPageUrls('http://localhost:5000');
      expect(urls.length).toBeGreaterThanOrEqual(5);
    });

    it('returns only unique URLs', () => {
      const urls = buildPageUrls('http://localhost:5000');
      const unique = new Set(urls);
      expect(unique.size).toBe(urls.length);
    });
  });

  // -------------------------------------------------------------------------
  // parseAuditResults
  // -------------------------------------------------------------------------
  describe('parseAuditResults', () => {
    it('returns zero counts for pages with no issues', () => {
      const pages: AuditPageResult[] = [
        { url: 'http://localhost:5000/login', issues: [], error: null },
        { url: 'http://localhost:5000/home', issues: [], error: null },
      ];

      const summary = parseAuditResults(pages);

      expect(summary.totalErrors).toBe(0);
      expect(summary.totalWarnings).toBe(0);
      expect(summary.totalNotices).toBe(0);
      expect(summary.pagesWithErrors).toBe(0);
      expect(summary.pagesScanned).toBe(2);
      expect(summary.pagesFailed).toBe(0);
    });

    it('counts errors, warnings, and notices separately', () => {
      const pages: AuditPageResult[] = [
        {
          url: 'http://localhost:5000/login',
          issues: [
            { code: 'WCAG2AA.1.1.1', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
            { code: 'WCAG2AA.1.3.1', type: 'warning', message: 'Possible heading', selector: 'div', context: '<div>' },
            { code: 'WCAG2AA.2.4.2', type: 'notice', message: 'Check title', selector: 'head', context: '<head>' },
          ],
          error: null,
        },
      ];

      const summary = parseAuditResults(pages);

      expect(summary.totalErrors).toBe(1);
      expect(summary.totalWarnings).toBe(1);
      expect(summary.totalNotices).toBe(1);
      expect(summary.pagesWithErrors).toBe(1);
    });

    it('aggregates issues across multiple pages', () => {
      const pages: AuditPageResult[] = [
        {
          url: 'http://localhost:5000/login',
          issues: [
            { code: 'WCAG2AA.1.1.1', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
          ],
          error: null,
        },
        {
          url: 'http://localhost:5000/home',
          issues: [
            { code: 'WCAG2AA.1.1.1', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
            { code: 'WCAG2AA.4.1.2', type: 'error', message: 'Missing label', selector: 'input', context: '<input>' },
          ],
          error: null,
        },
      ];

      const summary = parseAuditResults(pages);

      expect(summary.totalErrors).toBe(3);
      expect(summary.pagesWithErrors).toBe(2);
      expect(summary.pagesScanned).toBe(2);
    });

    it('counts failed pages when error is present', () => {
      const pages: AuditPageResult[] = [
        {
          url: 'http://localhost:5000/login',
          issues: [],
          error: 'Connection refused',
        },
        {
          url: 'http://localhost:5000/home',
          issues: [],
          error: null,
        },
      ];

      const summary = parseAuditResults(pages);

      expect(summary.pagesFailed).toBe(1);
      expect(summary.pagesScanned).toBe(2);
    });

    it('includes per-page breakdown in results', () => {
      const pages: AuditPageResult[] = [
        {
          url: 'http://localhost:5000/login',
          issues: [
            { code: 'WCAG2AA.1.1.1', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
          ],
          error: null,
        },
      ];

      const summary = parseAuditResults(pages);

      expect(summary.pages).toHaveLength(1);
      expect(summary.pages[0].url).toBe('http://localhost:5000/login');
      expect(summary.pages[0].errors).toBe(1);
      expect(summary.pages[0].warnings).toBe(0);
      expect(summary.pages[0].notices).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // formatAuditSummary
  // -------------------------------------------------------------------------
  describe('formatAuditSummary', () => {
    it('formats a clean audit with no issues', () => {
      const summary: AuditSummary = {
        pagesScanned: 5,
        pagesFailed: 0,
        pagesWithErrors: 0,
        totalErrors: 0,
        totalWarnings: 0,
        totalNotices: 0,
        pages: [
          { url: 'http://localhost:5000/login', errors: 0, warnings: 0, notices: 0, scanError: null },
          { url: 'http://localhost:5000/home', errors: 0, warnings: 0, notices: 0, scanError: null },
          { url: 'http://localhost:5000/reports', errors: 0, warnings: 0, notices: 0, scanError: null },
          { url: 'http://localhost:5000/scan/new', errors: 0, warnings: 0, notices: 0, scanError: null },
          { url: 'http://localhost:5000/admin/system', errors: 0, warnings: 0, notices: 0, scanError: null },
        ],
      };

      const output = formatAuditSummary(summary);

      expect(output).toContain('PASS');
      expect(output).toContain('5 pages scanned');
      expect(output).toContain('0 errors');
    });

    it('formats an audit with errors as FAIL', () => {
      const summary: AuditSummary = {
        pagesScanned: 2,
        pagesFailed: 0,
        pagesWithErrors: 1,
        totalErrors: 3,
        totalWarnings: 1,
        totalNotices: 2,
        pages: [
          { url: 'http://localhost:5000/login', errors: 3, warnings: 1, notices: 2, scanError: null },
          { url: 'http://localhost:5000/home', errors: 0, warnings: 0, notices: 0, scanError: null },
        ],
      };

      const output = formatAuditSummary(summary);

      expect(output).toContain('FAIL');
      expect(output).toContain('3 errors');
      expect(output).toContain('1 warnings');
      expect(output).toContain('2 notices');
    });

    it('includes per-page details in output', () => {
      const summary: AuditSummary = {
        pagesScanned: 1,
        pagesFailed: 0,
        pagesWithErrors: 1,
        totalErrors: 2,
        totalWarnings: 0,
        totalNotices: 0,
        pages: [
          { url: 'http://localhost:5000/login', errors: 2, warnings: 0, notices: 0, scanError: null },
        ],
      };

      const output = formatAuditSummary(summary);

      expect(output).toContain('/login');
      expect(output).toContain('2 errors');
    });

    it('shows scan errors for failed pages', () => {
      const summary: AuditSummary = {
        pagesScanned: 1,
        pagesFailed: 1,
        pagesWithErrors: 0,
        totalErrors: 0,
        totalWarnings: 0,
        totalNotices: 0,
        pages: [
          { url: 'http://localhost:5000/login', errors: 0, warnings: 0, notices: 0, scanError: 'Connection refused' },
        ],
      };

      const output = formatAuditSummary(summary);

      expect(output).toContain('Connection refused');
      expect(output).toContain('1 page(s) failed');
    });
  });
});
