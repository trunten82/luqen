import type { Collection, Db, Filter } from 'mongodb';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
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

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface AuditDoc {
  _id: string;
  timestamp: string;
  actor: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  orgId: string;
}

function docToEntry(doc: AuditDoc): AuditEntry {
  return {
    id: doc._id,
    timestamp: doc.timestamp,
    actor: doc.actor,
    actorId: doc.actorId,
    action: doc.action,
    resourceType: doc.resourceType,
    resourceId: doc.resourceId,
    details: doc.details,
    ipAddress: doc.ipAddress,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoAuditRepository
// ---------------------------------------------------------------------------

export class MongoAuditRepository {
  private readonly collection: Collection<AuditDoc>;

  constructor(db: Db) {
    this.collection = db.collection<AuditDoc>('audit_log');
  }

  async log(entry: CreateAuditInput): Promise<void> {
    const doc: AuditDoc = {
      _id: randomUUID(),
      timestamp: new Date().toISOString(),
      actor: entry.actor,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      details: typeof entry.details === 'object'
        ? JSON.stringify(entry.details)
        : (entry.details ?? null),
      ipAddress: entry.ipAddress ?? null,
      orgId: entry.orgId ?? 'system',
    };

    await this.collection.insertOne(doc);
  }

  async query(q: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    const filter: Filter<AuditDoc> = {};

    if (q.actor) filter['actor'] = q.actor;
    if (q.action) filter['action'] = q.action;
    if (q.resourceType) filter['resourceType'] = q.resourceType;
    if (q.orgId) filter['orgId'] = q.orgId;

    if (q.from || q.to) {
      const range: Record<string, string> = {};
      if (q.from) range['$gte'] = q.from;
      if (q.to) range['$lte'] = q.to;
      filter['timestamp'] = range;
    }

    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;

    const [total, docs] = await Promise.all([
      this.collection.countDocuments(filter),
      this.collection
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
    ]);

    return {
      entries: docs.map(docToEntry),
      total,
    };
  }
}
