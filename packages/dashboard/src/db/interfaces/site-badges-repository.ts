/**
 * Dynamic ("live") badges — Phase 64.
 *
 * A site_badges row makes /api/v1/badge/live/<id>.svg resolve to the
 * most recent completed scan for (org_id, site_url) on every request,
 * so scheduled scans automatically refresh the embedded badge.
 *
 * The (org_id, site_url) tuple is UNIQUE — enable() is idempotent.
 */

export interface SiteBadge {
  readonly id: string;
  readonly orgId: string;
  readonly siteUrl: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface SiteBadgesRepository {
  /**
   * Idempotent: returns the existing row if one already exists for
   * (orgId, siteUrl). `userId` is recorded on first creation for the
   * admin audit trail (Phase 64.1).
   */
  enable(orgId: string, siteUrl: string, userId: string): Promise<SiteBadge>;
  /** Returns true if a row was updated. */
  setEnabled(id: string, orgId: string, enabled: boolean): Promise<boolean>;
  get(id: string): Promise<SiteBadge | null>;
  getForSite(orgId: string, siteUrl: string): Promise<SiteBadge | null>;
  /**
   * Admin audit (Phase 64.1): every row. Optionally filter to one org.
   * Sorted newest first.
   */
  list(orgIdFilter?: string): Promise<readonly SiteBadge[]>;
}
