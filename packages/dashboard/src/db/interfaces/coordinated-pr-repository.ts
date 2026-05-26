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
  readonly delegatedTo: string | null;
  readonly delegatedBy: string | null;
}

/**
 * Result row for listPendingLegs — denormalized join of leg + parent PR
 * + scan.site_url. Returned shape is keyed for the dashboard API surface.
 */
export interface PendingLegRow {
  readonly id: string;
  readonly coordinatedPrId: string;
  readonly siteId: string;
  readonly siteUrl: string | null;
  readonly orgId: string;
  readonly approvalStatus: CoordinatedPrApprovalStatus;
  readonly legStatus: CoordinatedPrLegStatus;
  readonly delegatedTo: string | null;
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
  /**
   * Phase 63.4 — Cursor-paginated list. The cursor is the `created_at`
   * of the last row from the previous page (rows are returned in
   * `created_at DESC` order). Pass `cursor: undefined` for the first
   * page. `nextCursor` is non-null only when more rows are available.
   *
   * Backward compatible: callers passing nothing get the first 50 rows.
   */
  listForOrg(
    orgId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ items: readonly CoordinatedPr[]; nextCursor: string | null }>;
  updateLeg(legId: string, patch: UpdateLegPatch): Promise<CoordinatedPrLeg | null>;
  markRolledBack(id: string, reason?: string): Promise<boolean>;
  recomputeStatus(id: string): Promise<CoordinatedPrStatus | null>;
  /** Phase 63.1 — leg + parent PR by leg id (used for org-scope checks). */
  getLegById(
    legId: string,
  ): Promise<{ leg: CoordinatedPrLeg; pr: CoordinatedPr } | null>;
  /**
   * Phase 63.1 — list pending legs filtered by site_url (joined from scans).
   * Optional org scoping; admin.system callers pass undefined to see all.
   */
  listPendingLegs(filter: {
    siteUrl: string;
    orgId?: string;
  }): Promise<readonly PendingLegRow[]>;
  /** Phase 63.1 — delegate a leg to a different user. */
  delegateLeg(
    legId: string,
    toUserId: string,
    decidedBy: string,
  ): Promise<boolean>;
}
