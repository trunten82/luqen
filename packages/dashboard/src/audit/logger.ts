import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface AuditEntry {
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

export interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export class AuditLogger {
  constructor(private readonly db: Database.Database) {}

  log(entry: {
    actor: string;
    actorId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: string | Record<string, unknown>;
    ipAddress?: string;
    orgId?: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, timestamp, actor, actor_id, action, resource_type, resource_id, details, ip_address, org_id)
      VALUES (@id, @timestamp, @actor, @actorId, @action, @resourceType, @resourceId, @details, @ipAddress, @orgId)
    `);
    stmt.run({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actor: entry.actor,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : (entry.details ?? null),
      ipAddress: entry.ipAddress ?? null,
      orgId: entry.orgId ?? 'system',
    });
  }

  query(q: AuditQuery): { entries: AuditEntry[]; total: number } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (q.actor) { conditions.push('actor = @actor'); params.actor = q.actor; }
    if (q.action) { conditions.push('action = @action'); params.action = q.action; }
    if (q.resourceType) { conditions.push('resource_type = @resourceType'); params.resourceType = q.resourceType; }
    if (q.from) { conditions.push('timestamp >= @from'); params.from = q.from; }
    if (q.to) { conditions.push('timestamp <= @to'); params.to = q.to; }
    if (q.orgId) { conditions.push('org_id = @orgId'); params.orgId = q.orgId; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;

    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(params) as { count: number };
    const rows = this.db.prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset });

    return {
      entries: (rows as Array<Record<string, unknown>>).map(r => ({
        id: r.id as string,
        timestamp: r.timestamp as string,
        actor: r.actor as string,
        actorId: r.actor_id as string | null,
        action: r.action as string,
        resourceType: r.resource_type as string,
        resourceId: r.resource_id as string | null,
        details: r.details as string | null,
        ipAddress: r.ip_address as string | null,
        orgId: r.org_id as string,
      })),
      total: countRow.count,
    };
  }
}
