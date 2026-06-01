/**
 * Phase 80 — per-org entitlement (plan) foundation.
 *
 * One row per organization (org_id primary key). Holds the org's commercial
 * plan — the thin entitlement foundation that the WordPress Pro gate (GATE-06),
 * the agency partner entitlement (AGENCY-04), and the pricing/packaging model
 * (PRICE-03) build on. Monetisation is admin-controlled — there is no billing
 * integration; the plan is a configuration value an admin sets.
 *
 * AI-fix credits are NOT stored here: they live in the @luqen/llm service
 * alongside the usage ledger and are surfaced through the LLM client.
 */

export type OrgPlan = 'free' | 'pro' | 'agency';

export const ORG_PLANS: readonly OrgPlan[] = ['free', 'pro', 'agency'];

export interface EntitlementRecord {
  readonly orgId: string;
  readonly plan: OrgPlan;
  /**
   * Phase 81 (AGENCY-04) — for an agency-plan org, the number of client sites
   * the partner seat covers. null = unlimited / not set.
   */
  readonly maxClientSites?: number | null;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

export interface EntitlementRepository {
  /** The org's plan record. Returns a default 'free' record when unset. */
  get(orgId: string): Promise<EntitlementRecord>;

  /** Set the org's plan. */
  setPlan(orgId: string, plan: OrgPlan, updatedBy?: string): Promise<EntitlementRecord>;

  /**
   * Set the agency partner seat size (max client sites). null clears the limit.
   * Phase 81 (AGENCY-04).
   */
  setMaxClientSites(orgId: string, maxClientSites: number | null, updatedBy?: string): Promise<EntitlementRecord>;
}
