/**
 * AgentAuditRepository — Phase 31 (APER-03).
 *
 * Append-only audit log for agent tool invocations. Every call that goes
 * through the MCP dispatch layer (Phase 32 `onAfterInvoke` hook) writes
 * one row here with {userId, orgId, conversationId?, toolName, argsJson,
 * outcome, outcomeDetail?, latencyMs, createdAt}. Phase 33 (APER-04) will
 * surface these rows in `/admin/agent-audit`.
 *
 * IMPORTANT — IMMUTABILITY CONTRACT (locked in 31-CONTEXT.md line 117):
 * This interface deliberately exposes NO update or delete methods. The
 * `agent_audit_log` table is immutable by API surface. Do NOT add
 * `update*` / `delete*` / `remove*` / `clear*` methods — a runtime test
 * in `tests/repositories/agent-audit-repository.test.ts` (Group F) pins
 * this contract via `expect(repo).not.toHaveProperty(...)` assertions.
 *
 * This is a DIFFERENT repository from the existing
 * `packages/dashboard/src/db/interfaces/audit-repository.ts` (generic
 * HTTP/request audit on `audit_log`). Do not conflate them:
 *   - `storage.audit`       → generic HTTP audit (pre-existing, unchanged)
 *   - `storage.agentAudit`  → this one — agent tool-invocation audit
 */

export type ToolOutcome = 'success' | 'error' | 'denied' | 'timeout';

export interface AgentAuditEntry {
  readonly id: string;
  readonly userId: string;
  readonly orgId: string;
  readonly conversationId: string | null;
  readonly toolName: string;
  readonly argsJson: string;
  readonly outcome: ToolOutcome;
  readonly outcomeDetail: string | null;
  readonly latencyMs: number;
  readonly createdAt: string;
}

export interface AppendAuditInput {
  readonly userId: string;
  readonly orgId: string;
  readonly conversationId?: string;
  readonly toolName: string;
  readonly argsJson: string;
  readonly outcome: ToolOutcome;
  readonly outcomeDetail?: string;
  readonly latencyMs: number;
}

export interface AgentAuditFilters {
  readonly userId?: string;
  readonly toolName?: string;
  readonly outcome?: ToolOutcome;
  /** ISO-8601 inclusive lower bound on created_at. */
  readonly from?: string;
  /** ISO-8601 inclusive upper bound on created_at. */
  readonly to?: string;
}

export interface PaginationOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface AgentAuditRepository {
  /**
   * Append a single audit entry and return the persisted row (with
   * server-generated id + createdAt). ONLY mutation method on this
   * repository — see Immutability Contract in the file docblock.
   */
  append(input: AppendAuditInput): Promise<AgentAuditEntry>;

  /**
   * Org-scoped lookup. Returns null if the id exists but belongs to a
   * different org (mitigates T-31-09 cross-org info disclosure).
   */
  getEntry(id: string, orgId: string): Promise<AgentAuditEntry | null>;

  /**
   * Org-scoped list with optional filters (userId, toolName, outcome,
   * created_at range) ordered `created_at DESC` to match the
   * `idx_agent_audit_log_org_created` index. Pagination capped at 200
   * rows to mitigate T-31-10 (unbounded query DOS).
   */
  listForOrg(
    orgId: string | null,
    filters: AgentAuditFilters,
    pagination: PaginationOptions,
  ): Promise<AgentAuditEntry[]>;

  /**
   * Row count matching the same org + filters as `listForOrg`. `orgId: null`
   * signifies a cross-org query (admin.system only — enforced upstream).
   */
  countForOrg(orgId: string | null, filters: AgentAuditFilters): Promise<number>;

  /**
   * Distinct user_id values present in the audit log for the given org
   * scope (used for the filter dropdown on `/admin/audit`). `orgId: null`
   * returns distinct users across all orgs — admin.system only.
   */
  distinctUsers(orgId: string | null): Promise<string[]>;

  /**
   * Distinct tool_name values for the filter dropdown. Same org-scope
   * contract as distinctUsers.
   */
  distinctToolNames(orgId: string | null): Promise<string[]>;
}
