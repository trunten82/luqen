import type pg from 'pg';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly details: string | null;
  readonly ipAddress: string | null;
  readonly orgId: string;
}

interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

interface CreateAuditInput {
  readonly actor: string;
  readonly actorId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly details?: string | Record<string, unknown>;
  readonly ipAddress?: string;
  readonly orgId?: string;
}

interface AuditRepository {
  log(entry: CreateAuditInput): Promise<void>;
  query(params: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }>;
}

// ---------------------------------------------------------------------------
// PgAuditRepository
// ---------------------------------------------------------------------------

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly pool: pg.Pool) {}

  async log(entry: CreateAuditInput): Promise<void> {
    const details = typeof entry.details === 'object'
      ? JSON.stringify(entry.details)
      : (entry.details ?? null);

    await this.pool.query(
      `INSERT INTO audit_log (id, timestamp, actor, actor_id, action, resource_type, resource_id, details, ip_address, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        new Date().toISOString(),
        entry.actor,
        entry.actorId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        details,
        entry.ipAddress ?? null,
        entry.orgId ?? 'system',
      ],
    );
  }

  async query(q: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.actor) { conditions.push(`actor = $${idx++}`); params.push(q.actor); }
    if (q.action) { conditions.push(`action = $${idx++}`); params.push(q.action); }
    if (q.resourceType) { conditions.push(`resource_type = $${idx++}`); params.push(q.resourceType); }
    if (q.from) { conditions.push(`timestamp >= $${idx++}`); params.push(q.from); }
    if (q.to) { conditions.push(`timestamp <= $${idx++}`); params.push(q.to); }
    if (q.orgId) { conditions.push(`org_id = $${idx++}`); params.push(q.orgId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM audit_log ${where}`,
      params,
    );

    const dataParams = [...params, limit, offset];
    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${idx++} OFFSET $${idx}`,
      dataParams,
    );

    return {
      entries: dataResult.rows.map((r) => ({
        id: r.id as string,
        timestamp: toIso(r.timestamp as string | Date),
        actor: r.actor as string,
        actorId: r.actor_id as string | null,
        action: r.action as string,
        resourceType: r.resource_type as string,
        resourceId: r.resource_id as string | null,
        details: typeof r.details === 'object' && r.details !== null
          ? JSON.stringify(r.details)
          : (r.details as string | null),
        ipAddress: r.ip_address as string | null,
        orgId: r.org_id as string,
      })),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}
