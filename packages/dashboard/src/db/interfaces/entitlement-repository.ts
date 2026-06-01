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
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

export interface EntitlementRepository {
  /** The org's plan record. Returns a default 'free' record when unset. */
  get(orgId: string): Promise<EntitlementRecord>;

  /** Set the org's plan. */
  setPlan(orgId: string, plan: OrgPlan, updatedBy?: string): Promise<EntitlementRecord>;
}
