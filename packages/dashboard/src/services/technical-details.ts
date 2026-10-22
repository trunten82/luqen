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
