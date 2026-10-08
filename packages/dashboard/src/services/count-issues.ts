/**
 * countIssues — the ONE issue-count function (FP-05).
 *
 * It reproduces the semantic that produced the stored errors / warnings /
 * notices / total_issues columns: packages/core/src/index.ts:388-400 and the
 * incremental twin in scanner/orchestrator.ts. For every issue OCCURRENCE:
 * type 'error' -> errors, 'warning' -> warnings, ANYTHING ELSE (an unknown type,
 * or no type at all) -> notices. total = errors + warnings + notices.
 *
 * It is deliberately NOT core's json-reporter.ts:113-125 semantic (which skips
 * unknown types and sums page.issueCount): the dashboard columns never came
 * from that.
 *
 * One entry per occurrence for both template shapes is delegated to
 * flattenIssueOccurrences (PR #96) — reused, not re-implemented. That function
 * dereferences page.issues unguarded, so the input is sanitised first; this
 * module never throws on a malformed stored report.
 */
import { flattenIssueOccurrences } from './issue-occurrences.js';

export interface IssueCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
  readonly total: number;
}

export interface SanitizedIssue {
  readonly code: string;
  readonly selector?: string;
  readonly context?: string;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

export interface SanitizedPage {
  readonly url: string;
  readonly issues: readonly SanitizedIssue[];
}

export interface SanitizedTemplateIssue extends SanitizedIssue {
  readonly affectedPages?: readonly string[];
}

export interface SanitizedReportParts {
  readonly pages: readonly SanitizedPage[];
  readonly templateIssues: readonly SanitizedTemplateIssue[] | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectsOnly(value: unknown): SanitizedIssue[] {
  return Array.isArray(value) ? (value.filter(isObject) as SanitizedIssue[]) : [];
}

/** Read only the parts of a stored report that occurrence-flattening needs, tolerating any shape. */
export function sanitizeReportParts(report: unknown): SanitizedReportParts {
  if (!isObject(report)) return { pages: [], templateIssues: null };
  const rawPages = Array.isArray(report.pages) ? report.pages : [];
  const pages: SanitizedPage[] = rawPages
    .filter(isObject)
    .map((p) => ({ url: String(p.url), issues: objectsOnly(p.issues) }));
  const templateIssues = Array.isArray(report.templateIssues)
    ? report.templateIssues.filter(isObject).map(
        (t): SanitizedTemplateIssue => ({
          ...(t as SanitizedIssue),
          affectedPages: Array.isArray(t.affectedPages) ? (t.affectedPages as string[]) : [],
        }),
      )
    : null;
  return { pages, templateIssues };
}

export function countIssues(report: unknown): IssueCounts {
  const { pages, templateIssues } = sanitizeReportParts(report);
  let errors = 0;
  let warnings = 0;
  let notices = 0;
  for (const occurrence of flattenIssueOccurrences(pages, templateIssues)) {
    const type = occurrence.issue.type;
    if (type === 'error') errors++;
    else if (type === 'warning') warnings++;
    else notices++;
  }
  return { errors, warnings, notices, total: errors + warnings + notices };
}
