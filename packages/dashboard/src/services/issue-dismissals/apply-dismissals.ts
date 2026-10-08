/**
 * applyDismissals — pure removal of dismissed occurrences from a stored report (D-08, D-10).
 *
 * No storage access and no mutation: the input report and dismissal list may be
 * deeply frozen. A dismissal applies when its siteKey equals the siteKey
 * argument (D-10) and an issue's code AND selector are strictly equal to the
 * dismissal's (byte-exact by design). Matching covers every page and the
 * core-produced `templateIssues`, in both template shapes.
 *
 * When nothing matches (or the report is not an object) the SAME report
 * reference and an empty `dismissed` list are returned — this is what keeps
 * zero-dismissal output byte-identical once Phase 88 routes render paths here.
 *
 * Out of scope on purpose: compliance, complianceMatrix, regulationMatrix and
 * confirmedViolations are left untouched (Phase 88, FP-12).
 */
import { flattenIssueOccurrences } from '../issue-occurrences.js';
import { countIssues, sanitizeReportParts } from '../count-issues.js';

export interface DismissalMatch {
  readonly id: string;
  readonly code: string;
  readonly selector: string;
  readonly siteKey: string;
}

export interface DismissedOccurrence {
  readonly dismissalId: string;
  readonly pageUrl: string;
  readonly issue: unknown;
  readonly isTemplate: boolean;
}

export interface AppliedDismissals<R> {
  readonly report: R;
  readonly dismissed: readonly DismissedOccurrence[];
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const keyOf = (code: string, selector: string): string => `${code}\u0000${selector}`;

/** code+selector -> dismissal id, for the dismissals of THIS site only; first one wins. */
function buildMatcher(
  dismissals: readonly DismissalMatch[],
  siteKey: string,
): (issue: unknown) => string | undefined {
  const byKey = new Map<string, string>();
  for (const d of dismissals) {
    if (d.siteKey !== siteKey) continue;
    const key = keyOf(d.code, d.selector);
    if (!byKey.has(key)) byKey.set(key, d.id);
  }
  return (issue) => {
    if (!isObject(issue) || typeof issue.code !== 'string' || typeof issue.selector !== 'string') {
      return undefined;
    }
    return byKey.get(keyOf(issue.code, issue.selector));
  };
}

function filterPage(page: unknown, matcher: (issue: unknown) => string | undefined): unknown {
  if (!isObject(page) || !Array.isArray(page.issues)) return page;
  const kept = page.issues.filter((i) => matcher(i) === undefined);
  const removed = page.issues.length - kept.length;
  if (removed === 0) return page;
  const issueCount = typeof page.issueCount === 'number' ? Math.max(0, page.issueCount - removed) : kept.length;
  return { ...page, issues: kept, issueCount };
}

function withRecomputedSummary(report: Obj): Obj {
  if (!isObject(report.summary)) return report;
  const counts = countIssues(report);
  const byLevel = isObject(report.summary.byLevel) ? report.summary.byLevel : {};
  return {
    ...report,
    summary: {
      ...report.summary,
      totalIssues: counts.total,
      byLevel: { ...byLevel, error: counts.errors, warning: counts.warnings, notice: counts.notices },
    },
  };
}

export function applyDismissals<R>(
  rawReport: R,
  activeDismissals: readonly DismissalMatch[],
  siteKey: string,
): AppliedDismissals<R> {
  if (!isObject(rawReport)) return { report: rawReport, dismissed: [] };
  const matcher = buildMatcher(activeDismissals, siteKey);
  const { pages, templateIssues } = sanitizeReportParts(rawReport);

  const dismissed: DismissedOccurrence[] = [];
  for (const occurrence of flattenIssueOccurrences(pages, templateIssues)) {
    const dismissalId = matcher(occurrence.issue);
    if (dismissalId === undefined) continue;
    dismissed.push({
      dismissalId,
      pageUrl: occurrence.pageUrl,
      issue: occurrence.issue,
      isTemplate: occurrence.isTemplate,
    });
  }
  if (dismissed.length === 0) return { report: rawReport, dismissed: [] };

  const next: Obj = { ...rawReport };
  if (Array.isArray(rawReport.pages)) {
    next.pages = rawReport.pages.map((p) => filterPage(p, matcher));
  }
  if (Array.isArray(rawReport.templateIssues)) {
    next.templateIssues = rawReport.templateIssues.filter((t) => matcher(t) === undefined);
  }
  return { report: withRecomputedSummary(next) as R, dismissed };
}
