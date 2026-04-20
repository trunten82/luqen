import type { Organization, OrgMember } from '../types.js';

export interface OrgRepository {
  createOrg(data: { name: string; slug: string }): Promise<Organization>;
  getOrg(id: string): Promise<Organization | null>;
  getOrgBySlug(slug: string): Promise<Organization | null>;
  listOrgs(): Promise<Organization[]>;
  deleteOrg(id: string): Promise<void>;
  addMember(orgId: string, userId: string, role: string): Promise<OrgMember>;
  removeMember(orgId: string, userId: string): Promise<void>;
  listMembers(orgId: string): Promise<OrgMember[]>;
  /** List direct members + members inherited from teams linked to this org */
  listAllMembers(orgId: string): Promise<OrgMember[]>;
  getUserOrgs(userId: string): Promise<Organization[]>;
  getOrgComplianceCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null>;
  updateOrgComplianceClient(orgId: string, clientId: string, clientSecret: string): Promise<void>;
  getOrgBrandingCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null>;
  updateOrgBrandingClient(orgId: string, clientId: string, clientSecret: string): Promise<void>;
  /**
   * Read the per-org branding routing mode.
   *
   * `'embedded'` — scans and retags run through the in-process `BrandingMatcher`
   *                against the dashboard-local SQLite branding tables.
   * `'remote'`   — scans and retags route through the `@luqen/branding` REST
   *                service via `ServiceClientRegistry.getBrandingTokenManager()`.
   *
   * CRITICAL: Implementations MUST NOT cache this value. PROJECT.md decision:
   * per-request reads only. `BrandingOrchestrator` calls this on every scan;
   * when an admin flips the mode, the next scan observes the new value with
   * zero invalidation logic.
   *
   * Added in 16-P03 (migration 043 schema). Defaults to `'embedded'` for
   * orgs created before this column existed.
   */
  getBrandingMode(orgId: string): Promise<'embedded' | 'remote'>;
  /**
   * Persist a new branding routing mode for the given org. Updates the row
   * in place — this is not an append-only history table.
   *
   * Added in 16-P03 (migration 043 schema).
   */
  setBrandingMode(orgId: string, mode: 'embedded' | 'remote'): Promise<void>;
  getOrgLLMCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null>;
  updateOrgLLMClient(orgId: string, clientId: string, clientSecret: string): Promise<void>;
  /**
   * Read/write the org-level brand score target (0-100 integer, or null for
   * 'no target'). Added in migration 044.
   */
  getBrandScoreTarget(orgId: string): Promise<number | null>;
  setBrandScoreTarget(orgId: string, target: number | null): Promise<void>;
  /**
   * Update the per-org agent display name (D-14). Pass `null` to clear;
   * pass `''` to store an explicit empty string. A nonexistent orgId is
   * a silent no-op (0 rows affected, no throw) — matches the existing
   * updateOrg* pattern (updateOrgComplianceClient / updateOrgBrandingClient
   * / updateOrgLLMClient).
   *
   * Added in migration 055 (Phase 32 Plan 03).
   */
  updateOrgAgentDisplayName(orgId: string, displayName: string | null): Promise<void>;
}
