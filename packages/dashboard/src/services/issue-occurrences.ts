/**
 * Flatten a normalized report back into one entry per issue OCCURRENCE.
 *
 * normalizeReportData() lifts any issue whose code+selector+context appears on
 * 3+ pages out of page.issues into templateIssues. Anything that lists issues
 * row-by-row (the issues.xlsx export) must put those occurrences back, or its
 * count falls short of summary.totalIssues by every template occurrence.
 *
 * Two producers exist and they differ: the dashboard's own dedup STRIPS the
 * template occurrences from page.issues, while core's JSON reporter writes
 * templateIssues AND keeps page.issues whole. So a template occurrence is only
 * added where the page does not already carry it — never blindly — which keeps
 * both shapes at exactly one entry per occurrence.
 */

interface OccurrenceIssue {
  readonly code: string;
  readonly selector?: string;
  readonly context?: string;
}

interface OccurrencePage<I extends OccurrenceIssue> {
  readonly url: string;
  readonly issues: readonly I[];
}

type TemplateIssue = OccurrenceIssue & { readonly affectedPages?: readonly string[] };

export interface IssueOccurrence<I extends OccurrenceIssue> {
  readonly pageUrl: string;
  readonly issue: I;
  readonly isTemplate: boolean;
}

export function issueFingerprint(issue: OccurrenceIssue): string {
  return `${issue.code}||${issue.selector}||${issue.context}`;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function flattenIssueOccurrences<P extends OccurrenceIssue, T extends TemplateIssue>(
  pages: readonly OccurrencePage<P>[],
  templateIssues: readonly T[] | null | undefined,
): IssueOccurrence<P | T>[] {
  const templateFps = new Set((templateIssues ?? []).map(issueFingerprint));

  const pageRows: IssueOccurrence<P>[] = pages.flatMap((page) =>
    page.issues.map((issue) => ({
      pageUrl: page.url,
      issue,
      isTemplate: templateFps.has(issueFingerprint(issue)),
    })),
  );

  // How many times each (page, fingerprint) is already present in page.issues.
  const present = countBy(pageRows, (r) => `${r.pageUrl}\u0000${issueFingerprint(r.issue)}`);

  const templateRows: IssueOccurrence<T>[] = (templateIssues ?? []).flatMap((ti) => {
    const fp = issueFingerprint(ti);
    const wanted = countBy(ti.affectedPages ?? [], (url) => url);
    return [...wanted].flatMap(([url, needed]) => {
      const missing = Math.max(0, needed - (present.get(`${url}\u0000${fp}`) ?? 0));
      return Array.from({ length: missing }, () => ({ pageUrl: url, issue: ti, isTemplate: true }));
    });
  });

  return [...pageRows, ...templateRows];
}
