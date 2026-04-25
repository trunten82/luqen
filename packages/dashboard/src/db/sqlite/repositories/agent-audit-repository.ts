import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AgentAuditEntry,
  AgentAuditFilters,
  AgentAuditRepository,
  AppendAuditInput,
  PaginationOptions,
  ToolOutcome,
} from '../../interfaces/agent-audit-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches agent_audit_log columns (snake_case) verbatim.
// ---------------------------------------------------------------------------

interface AgentAuditRow {
  id: string;
  user_id: string;
  org_id: string;
  conversation_id: string | null;
  tool_name: string;
  args_json: string;
  outcome: string;
  outcome_detail: string | null;
  // Phase 36 (ATOOL-04): nullable rationale column added by migration 057.
  // Older rows persisted before 057 read back as NULL.
  rationale: string | null;
  latency_ms: number;
  created_at: string;
}

function rowToEntry(row: AgentAuditRow): AgentAuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    conversationId: row.conversation_id,
    toolName: row.tool_name,
    argsJson: row.args_json,
    // Safe cast: migration 048 adds `CHECK (outcome IN ('success','error','denied','timeout'))`
    // which rejects any other value at write time.
    outcome: row.outcome as ToolOutcome,
    outcomeDetail: row.outcome_detail,
    // Coalesce defensively: SQLite returns null for rows inserted before
    // migration 057, and `?? null` collapses any unexpected undefined.
    rationale: row.rationale ?? null,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Shared filter builder — org_id is always required; other filters optional.
// Mirrors the shape of scan-repository.ts:buildFilterQuery().
// ---------------------------------------------------------------------------

function buildFilterQuery(
  orgId: string | null,
  filters: AgentAuditFilters,
): { where: string; params: Record<string, unknown> } {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (orgId !== null) {
    conditions.push('org_id = @orgId');
    params['orgId'] = orgId;
  }

  if (filters.userId !== undefined) {
    conditions.push('user_id = @userId');
    params['userId'] = filters.userId;
  }
  if (filters.toolName !== undefined) {
    conditions.push('tool_name = @toolName');
    params['toolName'] = filters.toolName;
  }
  if (filters.outcome !== undefined) {
    conditions.push('outcome = @outcome');
    params['outcome'] = filters.outcome;
  }
  if (filters.outcomeDetail !== undefined) {
    // Phase 36 (ATOOL-04): exact-match on outcome_detail. Primary use case
    // is the /admin/audit cap-hit chip filter (outcomeDetail='iteration_cap').
    // Filter pushdown is acceptable: idx_agent_audit_log_org_created already
    // narrows by org_id; the LIMIT 200 cap on listForOrg bounds the scan.
    conditions.push('outcome_detail = @outcomeDetail');
    params['outcomeDetail'] = filters.outcomeDetail;
  }
  if (filters.from !== undefined) {
    conditions.push('created_at >= @from');
    params['from'] = filters.from;
  }
  if (filters.to !== undefined) {
    conditions.push('created_at <= @to');
    params['to'] = filters.to;
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// ---------------------------------------------------------------------------
// SqliteAgentAuditRepository
//
// IMPORTANT — IMMUTABILITY CONTRACT (31-CONTEXT.md line 117):
// This class deliberately implements only `append`, `getEntry`, `listForOrg`,
// `countForOrg`. It must NEVER grow update/delete/remove/clear methods — a
// Group F runtime test in tests/repositories/agent-audit-repository.test.ts
// pins this via `expect(repo).not.toHaveProperty(...)` assertions.
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

export class SqliteAgentAuditRepository implements AgentAuditRepository {
  constructor(private readonly db: Database.Database) {}

  async append(input: AppendAuditInput): Promise<AgentAuditEntry> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO agent_audit_log
           (id, user_id, org_id, conversation_id, tool_name, args_json, outcome, outcome_detail, rationale, latency_ms, created_at)
         VALUES
           (@id, @userId, @orgId, @conversationId, @toolName, @argsJson, @outcome, @outcomeDetail, @rationale, @latencyMs, @createdAt)`,
      )
      .run({
        id,
        userId: input.userId,
        orgId: input.orgId,
        conversationId: input.conversationId ?? null,
        toolName: input.toolName,
        argsJson: input.argsJson,
        outcome: input.outcome,
        outcomeDetail: input.outcomeDetail ?? null,
        // Phase 36 (ATOOL-04): undefined or null both persist as NULL.
        // Bound parameter — no string concat (mitigates T-36-01 tampering).
        rationale: input.rationale ?? null,
        latencyMs: input.latencyMs,
        createdAt,
      });

    const row = this.db
      .prepare('SELECT * FROM agent_audit_log WHERE id = ?')
      .get(id) as AgentAuditRow;
    return rowToEntry(row);
  }

  async getEntry(id: string, orgId: string): Promise<AgentAuditEntry | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM agent_audit_log WHERE id = @id AND org_id = @orgId',
      )
      .get({ id, orgId }) as AgentAuditRow | undefined;
    return row !== undefined ? rowToEntry(row) : null;
  }

  async listForOrg(
    orgId: string | null,
    filters: AgentAuditFilters,
    pagination: PaginationOptions,
  ): Promise<AgentAuditEntry[]> {
    const { where, params } = buildFilterQuery(orgId, filters);
    // Cap mitigates T-31-10 (unbounded query DOS). Mirrors the existing
    // audit-repository.ts pattern: default 50, hard max 200.
    const limit = Math.min(pagination.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const offset = pagination.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_audit_log ${where}
         ORDER BY created_at DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as AgentAuditRow[];

    return rows.map(rowToEntry);
  }

  async countForOrg(
    orgId: string | null,
    filters: AgentAuditFilters,
  ): Promise<number> {
    const { where, params } = buildFilterQuery(orgId, filters);
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM agent_audit_log ${where}`)
      .get(params) as { count: number };
    return row.count;
  }

  async distinctUsers(orgId: string | null): Promise<string[]> {
    const sql = orgId === null
      ? 'SELECT DISTINCT user_id FROM agent_audit_log ORDER BY user_id'
      : 'SELECT DISTINCT user_id FROM agent_audit_log WHERE org_id = @orgId ORDER BY user_id';
    const rows = (orgId === null
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all({ orgId })) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  async distinctToolNames(orgId: string | null): Promise<string[]> {
    const sql = orgId === null
      ? 'SELECT DISTINCT tool_name FROM agent_audit_log ORDER BY tool_name'
      : 'SELECT DISTINCT tool_name FROM agent_audit_log WHERE org_id = @orgId ORDER BY tool_name';
    const rows = (orgId === null
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all({ orgId })) as Array<{ tool_name: string }>;
    return rows.map((r) => r.tool_name);
  }
}
