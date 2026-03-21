/**
 * Self-audit module: scans the dashboard's own pages for WCAG 2.1 AA issues.
 *
 * The heavy scanning is delegated to the core scanner via the pa11y webservice.
 * This module owns the URL generation, result parsing, and summary formatting.
 */

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface AuditIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

export interface AuditPageResult {
  readonly url: string;
  readonly issues: readonly AuditIssue[];
  readonly error: string | null;
}

export interface AuditPageSummary {
  readonly url: string;
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
  readonly scanError: string | null;
}

export interface AuditSummary {
  readonly pagesScanned: number;
  readonly pagesFailed: number;
  readonly pagesWithErrors: number;
  readonly totalErrors: number;
  readonly totalWarnings: number;
  readonly totalNotices: number;
  readonly pages: readonly AuditPageSummary[];
}

// -------------------------------------------------------------------------
// Dashboard routes to audit
// -------------------------------------------------------------------------

const DASHBOARD_ROUTES: readonly string[] = [
  '/login',
  '/home',
  '/reports',
  '/scan/new',
  '/admin/system',
];

// -------------------------------------------------------------------------
// URL builder
// -------------------------------------------------------------------------

export function buildPageUrls(baseUrl: string): string[] {
  const normalised = baseUrl.replace(/\/+$/, '');
  return DASHBOARD_ROUTES.map((route) => `${normalised}${route}`);
}

// -------------------------------------------------------------------------
// Result parser
// -------------------------------------------------------------------------

export function parseAuditResults(pages: readonly AuditPageResult[]): AuditSummary {
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalNotices = 0;
  let pagesWithErrors = 0;
  let pagesFailed = 0;

  const pageSummaries: AuditPageSummary[] = pages.map((page) => {
    const errors = page.issues.filter((i) => i.type === 'error').length;
    const warnings = page.issues.filter((i) => i.type === 'warning').length;
    const notices = page.issues.filter((i) => i.type === 'notice').length;

    totalErrors += errors;
    totalWarnings += warnings;
    totalNotices += notices;

    if (errors > 0) {
      pagesWithErrors += 1;
    }

    if (page.error !== null) {
      pagesFailed += 1;
    }

    return {
      url: page.url,
      errors,
      warnings,
      notices,
      scanError: page.error,
    };
  });

  return {
    pagesScanned: pages.length,
    pagesFailed,
    pagesWithErrors,
    totalErrors,
    totalWarnings,
    totalNotices,
    pages: pageSummaries,
  };
}

// -------------------------------------------------------------------------
// Summary formatter
// -------------------------------------------------------------------------

export function formatAuditSummary(summary: AuditSummary): string {
  const lines: string[] = [];

  const status = summary.totalErrors > 0 ? 'FAIL' : 'PASS';

  lines.push('');
  lines.push(`=== Luqen Self-Audit: ${status} ===`);
  lines.push('');
  lines.push(`  ${summary.pagesScanned} pages scanned`);

  if (summary.pagesFailed > 0) {
    lines.push(`  ${summary.pagesFailed} page(s) failed to scan`);
  }

  lines.push(`  ${summary.totalErrors} errors | ${summary.totalWarnings} warnings | ${summary.totalNotices} notices`);
  lines.push('');

  // Per-page breakdown
  lines.push('--- Per-page results ---');

  for (const page of summary.pages) {
    const path = new URL(page.url).pathname;

    if (page.scanError !== null) {
      lines.push(`  ${path}: SCAN ERROR - ${page.scanError}`);
    } else if (page.errors > 0) {
      lines.push(`  ${path}: ${page.errors} errors, ${page.warnings} warnings, ${page.notices} notices`);
    } else {
      lines.push(`  ${path}: OK (${page.warnings} warnings, ${page.notices} notices)`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
