/**
 * Phase 62.2 — Coordinated multi-repo PRs.
 *
 * A coordinated PR aggregates N per-site legs into one logical unit so a
 * network admin can fan one fix across the fleet under one transaction.
 * The plugin's Luqen_Coordinated_Fix_Job reports leg progress back via
 * POST /api/v1/coordinated-prs/:id/legs/:legId, which calls updateLeg()
 * then recomputeStatus(). The org-level knobs
 * coordinated_pr_requires_site_approval and coordinated_pr_failure_mode
 * control the initial approval seeding and the failure rollup rule
 * respectively.
 */

export type CoordinatedPrStatus =
  | 'draft'
  | 'opening'
  | 'partial'
  | 'complete'
  | 'rolled_back';

export type CoordinatedPrLegStatus =
  | 'queued'
  | 'opening'
  | 'opened'
  | 'failed'
  | 'rolled_back';

export type CoordinatedPrApprovalStatus = 'pending' | 'approved' | 'skipped';

export interface CoordinatedPr {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string | null;
  readonly createdBy: string;
  readonly status: CoordinatedPrStatus;
  readonly summary: string | null;
  readonly createdAt: string;
}

export interface CoordinatedPrLeg {
  readonly id: string;
  readonly coordinatedPrId: string;
  readonly siteId: string;
  readonly hostPrUrl: string | null;
  readonly hostPrState: string | null;
  readonly lastError: string | null;
  readonly legStatus: CoordinatedPrLegStatus;
  readonly approvalStatus: CoordinatedPrApprovalStatus;
}

export interface CreateCoordinatedPrInput {
  readonly id?: string;
  readonly orgId: string;
  readonly teamId?: string | null;
  readonly createdBy: string;
  readonly summary?: string | null;
  readonly legs: ReadonlyArray<{ readonly siteId: string }>;
}

export interface UpdateLegPatch {
  readonly hostPrUrl?: string | null;
  readonly hostPrState?: string | null;
  readonly lastError?: string | null;
  readonly legStatus?: CoordinatedPrLegStatus;
  readonly approvalStatus?: CoordinatedPrApprovalStatus;
}

export interface CoordinatedPrRepository {
  createCoordinatedPr(input: CreateCoordinatedPrInput): Promise<{
    pr: CoordinatedPr;
    legs: readonly CoordinatedPrLeg[];
  }>;
  getCoordinatedPr(
    id: string,
  ): Promise<{ pr: CoordinatedPr; legs: readonly CoordinatedPrLeg[] } | null>;
  listForOrg(orgId: string, limit?: number): Promise<readonly CoordinatedPr[]>;
  updateLeg(legId: string, patch: UpdateLegPatch): Promise<CoordinatedPrLeg | null>;
  markRolledBack(id: string, reason?: string): Promise<boolean>;
  recomputeStatus(id: string): Promise<CoordinatedPrStatus | null>;
}
