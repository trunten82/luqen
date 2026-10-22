/**
 * Technical details of an accessibility finding (Phase 93, D-06): the ONE module that owns who may
 * see an element's selector and markup, which fields those are, and every redaction function.
 *
 * The report page, the brand drilldown and the REST data API all call it, so a viewer who lacks
 * `reports.view_technical` gets the same answer on every surface.
 *
 * Everything here is immutable: redaction returns new objects and never edits its input. A redacted
 * field is ABSENT, never null, so "absent" always means "not entitled".
 */

/** The permission that shows an element's selector and markup. */
export const TECHNICAL_DETAILS_PERMISSION = 'reports.view_technical';

/**
 * D-07: the issue fields a viewer without {@link TECHNICAL_DETAILS_PERMISSION} does not get.
 *
 * Derived from the report page: report-detail.hbs renders `{{selector}}` and `{{context}}` only
 * inside `perm.reportsViewTechnical` blocks, passes `context` into the fix hint only with that flag
 * (fix-suggestions.ts), and the brand drilldown strips exactly these two (HARD-02). Not in the list
 * on purpose: `brandMatch.matchDetail` (a guideline pattern shown to every viewer), `code`,
 * `message`, `runner`, `wcag*`, `regulations`, `pageUrl`. A test re-derives this list from the
 * rendered page (tests/integration/technical-fields-derivation.test.ts).
 */
export const TECHNICAL_ISSUE_FIELDS = ['context', 'selector'] as const;

export type TechnicalIssueField = (typeof TECHNICAL_ISSUE_FIELDS)[number];

/** Fail closed: true only when a permission set exists and holds the technical-details permission. */
export function mayViewTechnicalDetails(permissions: ReadonlySet<string> | undefined): boolean {
  return permissions?.has(TECHNICAL_DETAILS_PERMISSION) === true;
}

/** The same decision for a request whose preHandler attached its resolved permission set. */
export function requestMayViewTechnicalDetails(request: unknown): boolean {
  const granted = (request as { permissions?: ReadonlySet<string> } | undefined)?.permissions;
  return mayViewTechnicalDetails(granted);
}

/** A new object without the technical fields; every other key is kept. */
export function withoutTechnicalFields<T extends object>(item: T): Omit<T, TechnicalIssueField> {
  const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const field of TECHNICAL_ISSUE_FIELDS) delete copy[field];
  return copy as Omit<T, TechnicalIssueField>;
}

/** The same array for an entitled viewer, otherwise a new array of redacted copies. */
export function itemsForViewer<T extends object>(
  items: readonly T[],
  viewTechnical: boolean,
): readonly T[] | ReadonlyArray<Omit<T, TechnicalIssueField>> {
  return viewTechnical ? items : items.map((item) => withoutTechnicalFields(item));
}

/**
 * A GraphQL Assignment as a viewer may see it: the same object for an entitled viewer, otherwise a
 * new object without `selector` and `issueFingerprint`.
 *
 * The fingerprint is withheld because the report page builds a per-issue fingerprint as
 * code + "|" + selector + "|" + message (report-detail.hbs:1365), so serving it serves the selector.
 * The bulk form (criterion + "||bulk||" + title) carries no selector but is withheld too: any caller
 * can set a fingerprint to any text through assignIssue, so the rule must not depend on its shape.
 */
export function assignmentForViewer<T extends { readonly selector?: unknown; readonly issueFingerprint?: unknown }>(
  assignment: T,
  viewTechnical: boolean,
): T | Omit<T, 'selector' | 'issueFingerprint'> {
  if (viewTechnical) return assignment;
  const { selector: _selector, issueFingerprint: _issueFingerprint, ...rest } = assignment;
  return rest;
}

// ---------------------------------------------------------------------------
// Stored report blobs (D-08)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An issue copy: a plain object with a string `code` that carries a technical field. */
function isIssueCopy(value: Record<string, unknown>): boolean {
  return typeof value['code'] === 'string' && TECHNICAL_ISSUE_FIELDS.some((field) => field in value);
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!isPlainObject(value)) return value;
  const walked: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) walked[key] = redactDeep(child);
  return isIssueCopy(walked) ? withoutTechnicalFields(walked) : walked;
}

/**
 * A raw scan report as a viewer may see it: the same reference for an entitled viewer, otherwise a
 * structural copy with the technical fields removed from EVERY issue copy, at any depth.
 *
 * Generic on purpose: a nested copy nobody listed (a future shape) cannot carry a selector out.
 * The locations known today are `pages[].issues[]`, `templateIssues[]`, flat `issues[]`,
 * `results[].issues[]` and `compliance.annotatedIssues[].originalIssue` (report-service.ts,
 * filter-compliance.ts). An object counts as an issue copy when it has a string `code` and one of
 * the technical keys; `errors[]` entries and layout objects without a string code are left as they are.
 */
export function reportForViewer<T>(report: T, viewTechnical: boolean): T {
  return viewTechnical ? report : (redactDeep(report) as T);
}

/**
 * A scan row whose `jsonReport` blob follows {@link reportForViewer}. The same row for an entitled
 * viewer or a row without a blob; otherwise a new row with the blob parsed, redacted and
 * re-serialised compactly. A blob that cannot be parsed cannot be redacted, so it is dropped from
 * the copy (fail closed).
 */
export function reportBlobForViewer<T extends { readonly jsonReport?: string }>(
  row: T,
  viewTechnical: boolean,
): T {
  if (viewTechnical || row.jsonReport === undefined) return row;
  const { jsonReport, ...rest } = row;
  try {
    const redacted = reportForViewer(JSON.parse(jsonReport) as unknown, false);
    return { ...(rest as unknown as T), jsonReport: JSON.stringify(redacted) };
  } catch {
    return rest as unknown as T;
  }
}
