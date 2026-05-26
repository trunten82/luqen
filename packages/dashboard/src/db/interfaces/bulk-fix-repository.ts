/**
 * Phase 62.3 — Bulk fix dispatch.
 *
 * A bulk_fix is a thin wrapper around the intent ("apply criterion X across
 * the fleet") that 62.3 dispatches through 62.2's coordinated PR flow. The
 * row holds the criterion + summary + status; the actual per-site legs live
 * on the linked coordinated_pr.
 */

export type BulkFixStatus = 'draft' | 'dispatched' | 'complete';

export interface BulkFix {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string | null;
  readonly createdBy: string;
  readonly criterion: string;
  readonly summary: string | null;
  readonly status: BulkFixStatus;
  readonly coordinatedPrId: string | null;
  readonly createdAt: string;
}

export interface CreateBulkFixInput {
  readonly id?: string;
  readonly orgId: string;
  readonly teamId?: string | null;
  readonly createdBy: string;
  readonly criterion: string;
  readonly summary?: string | null;
}

export interface BulkFixRepository {
  create(input: CreateBulkFixInput): Promise<BulkFix>;
  getById(id: string): Promise<BulkFix | null>;
  listForOrg(orgId: string, limit?: number): Promise<readonly BulkFix[]>;
  /** Flips status to 'dispatched' and writes the coordinated_pr_id. */
  markDispatched(id: string, coordinatedPrId: string): Promise<void>;
}
