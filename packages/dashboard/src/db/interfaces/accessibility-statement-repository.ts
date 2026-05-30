/**
 * Per-org Accessibility Statement configuration.
 *
 * One row per organization (org_id primary key). Drives the public, hostable
 * accessibility statement page. Conservative-by-default: a statement is only
 * served publicly when `enabled` is true.
 */

export interface AccessibilityStatementRecord {
  readonly orgId: string;
  readonly enabled: boolean;
  /** Public-facing entity name (defaults to the org name when blank). */
  readonly entityName?: string;
  /** The site/property the statement covers (used to pick the latest scan). */
  readonly siteUrl?: string;
  /** Target WCAG version: '2.1' or '2.2'. */
  readonly wcagVersion: string;
  /** Target conformance level: 'A' | 'AA' | 'AAA'. */
  readonly wcagLevel: string;
  /** Barrier-report channel that routes to the ORG (not a lawyer). */
  readonly contactEmail?: string;
  /** Optional alternative contact (a form/page URL). */
  readonly contactUrl?: string;
  /** Custom remediation-commitment prose (falls back to a default). */
  readonly commitment?: string;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Fields an admin can write. */
export interface AccessibilityStatementInput {
  readonly enabled: boolean;
  readonly entityName?: string;
  readonly siteUrl?: string;
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly contactEmail?: string;
  readonly contactUrl?: string;
  readonly commitment?: string;
}

/** A statement joined with its org's public identity (for the public route). */
export interface AccessibilityStatementWithOrg {
  readonly record: AccessibilityStatementRecord;
  readonly orgId: string;
  readonly orgName: string;
  readonly orgSlug: string;
}

export interface AccessibilityStatementRepository {
  /** Returns the org's statement config, or null if never configured. */
  get(orgId: string): Promise<AccessibilityStatementRecord | null>;

  /**
   * Resolve an ENABLED statement by org slug, joined with org identity.
   * Returns null when the org is unknown or the statement is disabled — the
   * public route maps that to a 404.
   */
  getEnabledByOrgSlug(slug: string): Promise<AccessibilityStatementWithOrg | null>;

  /** Create or update the org's statement config. */
  upsert(
    orgId: string,
    data: AccessibilityStatementInput,
    updatedBy?: string,
  ): Promise<AccessibilityStatementRecord>;
}
