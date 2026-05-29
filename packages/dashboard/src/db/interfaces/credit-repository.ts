/**
 * Phase 80 — Per-org entitlement plan + AI-fix credit metering.
 *
 * The dashboard is the orchestrator and owns commercial concepts; the
 * LLM service stays a pure capability engine (its `llm_usage` table
 * records actual token/cost telemetry). This repository is the
 * enforcement/allocation layer on top.
 *
 * METERING IS OPT-IN: `allocated === null` means UNLIMITED — the
 * default for every org until an admin sets a cap. This keeps existing
 * generate-fix flows unaffected on deploy. When `allocated` is a
 * number, remaining balance = allocated − used and the capability is
 * gated when the balance hits zero.
 */

export type OrgPlanTier = 'free' | 'pro' | 'agency';

export interface OrgPlan {
  readonly orgId: string;
  readonly plan: OrgPlanTier;
  /** null = unlimited (metering off). */
  readonly allocated: number | null;
  readonly used: number;
  /** null when unlimited; otherwise max(0, allocated − used). */
  readonly balance: number | null;
  readonly unlimited: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

export interface CreditLedgerEntry {
  readonly id: string;
  readonly orgId: string;
  readonly delta: number;
  readonly reason: string;
  readonly balanceAfter: number | null;
  readonly actor: string | null;
  readonly createdAt: string;
}

export interface CreditCheck {
  readonly allowed: boolean;
  readonly unlimited: boolean;
  readonly balance: number | null;
}

export interface CreditConsumeResult {
  readonly allowed: boolean;
  readonly unlimited: boolean;
  readonly balanceAfter: number | null;
}

export interface CreditRepository {
  /** Read the org's plan, lazily defaulting to {plan:'free', unlimited} when no row exists. */
  getPlan(orgId: string): Promise<OrgPlan>;

  /** Set the commercial tier (free/pro/agency). */
  setPlan(orgId: string, plan: OrgPlanTier, actor: string | null): Promise<OrgPlan>;

  /**
   * Set the absolute AI-credit allocation. `null` → unlimited (metering
   * off). Records a ledger entry capturing the change.
   */
  setAllocation(orgId: string, allocated: number | null, actor: string | null): Promise<OrgPlan>;

  /** Increase the allocation by `amount` (top-up). No-op semantics on unlimited orgs (stays unlimited). */
  topUp(orgId: string, amount: number, actor: string | null): Promise<OrgPlan>;

  /** Peek whether a consume of 1 would be allowed, without mutating. */
  check(orgId: string): Promise<CreditCheck>;

  /**
   * Atomically consume `amount` credits. Unlimited orgs always succeed
   * with no decrement. Metered orgs succeed only if balance ≥ amount
   * (decrement + ledger entry); otherwise return allowed:false unchanged.
   */
  consume(orgId: string, amount: number, reason: string, actor: string | null): Promise<CreditConsumeResult>;

  /** Recent ledger entries, newest first. */
  getLedger(orgId: string, limit?: number): Promise<readonly CreditLedgerEntry[]>;
}
