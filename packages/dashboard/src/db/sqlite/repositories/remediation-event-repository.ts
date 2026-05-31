import type Database from 'better-sqlite3';
import type { RemediationEventRepository } from '../../interfaces/remediation-event-repository.js';
import type {
  RemediationEvent,
  RemediationEventType,
  CreateRemediationEventInput,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type
// ---------------------------------------------------------------------------

interface RemediationEventRow {
  id: string;
  org_id: string;
  site_url: string;
  scan_id: string | null;
  criterion: string | null;
  event_type: string;
  detail: string | null;
  actor: string | null;
  created_at: string;
}

function rowToRecord(row: RemediationEventRow): RemediationEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    siteUrl: row.site_url,
    scanId: row.scan_id,
    criterion: row.criterion,
    eventType: row.event_type as RemediationEventType,
    detail: row.detail,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteRemediationEventRepository
// ---------------------------------------------------------------------------

let counter = 0;

export class SqliteRemediationEventRepository implements RemediationEventRepository {
  constructor(private readonly db: Database.Database) {}

  async record(data: CreateRemediationEventInput): Promise<RemediationEvent> {
    const now = data.createdAt ?? new Date().toISOString();
    // Append-only: a monotonic suffix keeps ids unique even within the same ms.
    const id = `rem-${Date.now().toString(36)}-${(counter++).toString(36)}`;

    const record: RemediationEvent = {
      id,
      orgId: data.orgId ?? 'system',
      siteUrl: data.siteUrl,
      scanId: data.scanId ?? null,
      criterion: data.criterion ?? null,
      eventType: data.eventType,
      detail: data.detail ?? null,
      actor: data.actor ?? null,
      createdAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO remediation_events
          (id, org_id, site_url, scan_id, criterion, event_type, detail, actor, created_at)
        VALUES
          (@id, @orgId, @siteUrl, @scanId, @criterion, @eventType, @detail, @actor, @createdAt)
      `)
      .run(record);

    return record;
  }

  async listForSite(orgId: string, siteUrl: string, limit = 200): Promise<RemediationEvent[]> {
    const rows = this.db
      .prepare(`
        SELECT * FROM remediation_events
        WHERE org_id = ? AND site_url = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(orgId, siteUrl, limit) as RemediationEventRow[];
    return rows.map(rowToRecord);
  }

  async listForScan(scanId: string): Promise<RemediationEvent[]> {
    const rows = this.db
      .prepare('SELECT * FROM remediation_events WHERE scan_id = ? ORDER BY created_at DESC')
      .all(scanId) as RemediationEventRow[];
    return rows.map(rowToRecord);
  }
}
