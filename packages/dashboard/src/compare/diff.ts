/**
 * Report comparison diff logic.
 *
 * Compares two normalized report objects and produces a structured diff
 * of added, removed, and unchanged issues plus a summary delta.
 */

export interface DiffIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context?: string;
  readonly pageUrl?: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
  readonly wcagUrl?: string;
}

export interface SummaryDelta {
  readonly errors: number;
  readonly warnings: number;
  readonly notices: number;
}

export interface DiffResult {
  readonly added: readonly DiffIssue[];
  readonly removed: readonly DiffIssue[];
  readonly unchanged: readonly DiffIssue[];
  readonly summaryDelta: SummaryDelta;
}

interface NormalizedPage {
  readonly url: string;
  readonly issues?: ReadonlyArray<{
    readonly type: string;
    readonly code: string;
    readonly message: string;
    readonly selector: string;
    readonly context?: string;
    readonly wcagCriterion?: string;
    readonly wcagTitle?: string;
    readonly wcagUrl?: string;
  }>;
}

export interface NormalizedReport {
  readonly summary: {
    readonly byLevel?: {
      readonly error: number;
      readonly warning: number;
      readonly notice: number;
    };
  };
  readonly pages: readonly NormalizedPage[];
}

/** Build a unique key for an issue so we can detect matches between reports. */
function issueKey(issue: { code: string; selector: string; message: string }): string {
  return `${issue.code}|||${issue.selector}|||${issue.message}`;
}

/** Flatten all page issues into DiffIssue[] with pageUrl attached. */
function flattenIssues(report: NormalizedReport): DiffIssue[] {
  const result: DiffIssue[] = [];
  for (const page of report.pages) {
    if (page.issues === undefined) continue;
    for (const issue of page.issues) {
      result.push({
        type: issue.type,
        code: issue.code,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        pageUrl: page.url,
        wcagCriterion: issue.wcagCriterion,
        wcagTitle: issue.wcagTitle,
        wcagUrl: issue.wcagUrl,
      });
    }
  }
  return result;
}

/**
 * Compare two normalized reports and produce a diff.
 *
 * - `added`: issues in report B that are not in report A (new issues)
 * - `removed`: issues in report A that are not in report B (resolved issues)
 * - `unchanged`: issues present in both A and B
 * - `summaryDelta`: B counts minus A counts (positive = regression)
 */
export function diffReports(reportA: NormalizedReport, reportB: NormalizedReport): DiffResult {
  const issuesA = flattenIssues(reportA);
  const issuesB = flattenIssues(reportB);

  // Build a map of key -> list of issues for report A
  const mapA = new Map<string, DiffIssue[]>();
  for (const issue of issuesA) {
    const key = issueKey(issue);
    const list = mapA.get(key);
    if (list !== undefined) {
      list.push(issue);
    } else {
      mapA.set(key, [issue]);
    }
  }

  const added: DiffIssue[] = [];
  const unchanged: DiffIssue[] = [];

  // Walk through B: if key exists in A, it's unchanged; otherwise it's added
  for (const issue of issuesB) {
    const key = issueKey(issue);
    const aList = mapA.get(key);
    if (aList !== undefined && aList.length > 0) {
      // Consume one match from A
      aList.pop();
      unchanged.push(issue);
    } else {
      added.push(issue);
    }
  }

  // Remaining items in A (not consumed) are removed (resolved)
  const removed: DiffIssue[] = [];
  for (const list of mapA.values()) {
    for (const issue of list) {
      removed.push(issue);
    }
  }

  const aLevel = reportA.summary.byLevel ?? { error: 0, warning: 0, notice: 0 };
  const bLevel = reportB.summary.byLevel ?? { error: 0, warning: 0, notice: 0 };

  const summaryDelta: SummaryDelta = {
    errors: bLevel.error - aLevel.error,
    warnings: bLevel.warning - aLevel.warning,
    notices: bLevel.notice - aLevel.notice,
  };

  return { added, removed, unchanged, summaryDelta };
}
