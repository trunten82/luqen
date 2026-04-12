/**
 * Brand drilldown service — Phase 25.
 *
 * Filters issues from a scan's JSON report by brand-score dimension
 * (color, typography, components) so the drilldown modal can show
 * exactly which elements are failing for a given dimension.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrilldownDimension = 'color' | 'typography' | 'components';

export interface DrilldownIssue {
  readonly selector: string;
  readonly context: string;
  readonly message: string;
  readonly code: string;
  readonly matchDetail: string;
  readonly strategy: string;
}

const VALID_DIMENSIONS: ReadonlySet<string> = new Set<string>([
  'color',
  'typography',
  'components',
]);

/** Type guard for query-param validation. */
export function isValidDimension(s: string): s is DrilldownDimension {
  return VALID_DIMENSIONS.has(s);
}

// ---------------------------------------------------------------------------
// Contrast code fragments used by the color-score dimension
// ---------------------------------------------------------------------------

const CONTRAST_CODES: readonly string[] = [
  'Guideline1_4.1_4_3',
  'Guideline1_4.1_4_6',
  'Guideline1_4.1_4_11',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RawIssue {
  readonly type?: string;
  readonly code?: string;
  readonly message?: string;
  readonly selector?: string;
  readonly context?: string;
  readonly brandMatch?: {
    readonly matched?: boolean;
    readonly strategy?: string;
    readonly matchDetail?: string;
  };
}

function isBrandMatched(issue: RawIssue): boolean {
  return issue.brandMatch?.matched === true;
}

function matchesDimension(dimension: DrilldownDimension, issue: RawIssue): boolean {
  switch (dimension) {
    case 'color':
      return (
        isBrandMatched(issue) &&
        CONTRAST_CODES.some((frag) => (issue.code ?? '').includes(frag))
      );
    case 'typography':
      return isBrandMatched(issue) && issue.brandMatch?.strategy === 'font';
    case 'components':
      return isBrandMatched(issue) && issue.brandMatch?.strategy === 'selector';
    default:
      return false;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter issues from a scan's stored JSON report by brand-score dimension.
 *
 * Returns a frozen, deduplicated array of {@link DrilldownIssue} objects.
 * Safe to call with any shape of `reportData` — returns `[]` on bad input.
 */
export function filterDrilldownIssues(
  dimension: DrilldownDimension,
  reportData: unknown,
): readonly DrilldownIssue[] {
  if (reportData === null || reportData === undefined || typeof reportData !== 'object') {
    return Object.freeze([]);
  }

  const pages = (reportData as Record<string, unknown>).pages;
  if (!Array.isArray(pages)) {
    return Object.freeze([]);
  }

  // Flatten all issues across all pages
  const allIssues: RawIssue[] = [];
  for (const page of pages) {
    const issues = (page as Record<string, unknown>).issues;
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        allIssues.push(issue as RawIssue);
      }
    }
  }

  // Filter by dimension
  const matched = allIssues.filter((issue) => matchesDimension(dimension, issue));

  // Deduplicate by code + selector (keep first occurrence)
  const seen = new Set<string>();
  const deduped: DrilldownIssue[] = [];
  for (const issue of matched) {
    const key = `${issue.code ?? ''}||${issue.selector ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      selector: issue.selector ?? '',
      context: truncate(issue.context ?? '', 200),
      message: issue.message ?? '',
      code: issue.code ?? '',
      matchDetail: issue.brandMatch?.matchDetail ?? '',
      strategy: issue.brandMatch?.strategy ?? '',
    });
  }

  return Object.freeze(deduped);
}
