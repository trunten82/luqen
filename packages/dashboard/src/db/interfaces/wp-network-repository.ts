/**
 * Phase 61 — repositories for the WordPress network/fleet feature.
 *
 * Two tables:
 *   - wp_sites:       sites registered by the plugin's OAuth client.
 *   - wp_user_links:  WP user ↔ dashboard user mapping per site_url.
 */

export interface WpSite {
  readonly id: string;
  readonly orgId: string;
  readonly oauthClientId: string;
  readonly url: string;
  readonly wpVersion: string | null;
  readonly pluginVersion: string | null;
  readonly status: 'active' | 'stale';
  readonly lastSeenAt: string;
  readonly createdAt: string;
}

export interface RegisterWpSiteInput {
  readonly orgId: string;
  readonly oauthClientId: string;
  readonly url: string;
  readonly wpVersion?: string;
  readonly pluginVersion?: string;
}

export interface ListWpSitesFilter {
  readonly orgId: string;
  readonly status?: 'active' | 'stale' | 'all';
}

export interface WpSitesRepository {
  /**
   * Idempotent register: insert OR update (last_seen_at + versions) by
   * (oauth_client_id, url). Returns the row.
   */
  register(input: RegisterWpSiteInput): Promise<WpSite>;
  get(id: string): Promise<WpSite | null>;
  list(filter: ListWpSitesFilter): Promise<readonly WpSite[]>;
  /**
   * Flip rows that haven't heartbeated in `staleAfterMs` to status='stale'.
   * Returns the count flipped. Idempotent.
   */
  markStale(staleAfterMs: number): Promise<number>;
}

export interface WpUserLink {
  readonly id: string;
  readonly siteUrl: string;
  readonly wpUserId: number;
  readonly wpLogin: string;
  readonly email: string;
  readonly dashboardUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertWpUserLinkInput {
  readonly siteUrl: string;
  readonly wpUserId: number;
  readonly wpLogin: string;
  readonly email: string;
  readonly dashboardUserId: string | null;
}

export interface WpUserLinksRepository {
  /**
   * Idempotent upsert on (site_url, wp_user_id). Returns the row.
   */
  upsert(input: UpsertWpUserLinkInput): Promise<WpUserLink>;
  get(siteUrl: string, wpUserId: number): Promise<WpUserLink | null>;
  listByDashboardUser(dashboardUserId: string): Promise<readonly WpUserLink[]>;
}
