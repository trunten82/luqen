import type { AuditEntry, AuditQuery, CreateAuditInput } from '../types.js';

export interface AuditRepository {
  log(entry: CreateAuditInput): Promise<void>;
  query(params: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }>;
  /**
   * Phase 63.4 — Cursor-paginated org listing ordered by `timestamp DESC`.
   * The cursor is the `timestamp` of the last row from the previous page.
   * Backward compatible: `opts` omitted returns the first 50 rows.
   * Backed by the idx_audit_org_action_created composite (migration 071)
   * when callers also filter by action.
   */
  listForOrg(
    orgId: string,
    opts?: { limit?: number; cursor?: string; action?: string },
  ): Promise<{ items: readonly AuditEntry[]; nextCursor: string | null }>;
}
