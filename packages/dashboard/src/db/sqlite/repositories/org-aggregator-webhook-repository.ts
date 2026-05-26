import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  CreateOrgAggregatorWebhookInput,
  OrgAggregatorWebhook,
  OrgAggregatorWebhookRepository,
} from '../../interfaces/org-aggregator-webhook-repository.js';

interface Row {
  id: string;
  org_id: string;
  url: string;
  secret: string | null;
  active: number;
  created_at: string;
  created_by: string | null;
}

function rowToRecord(row: Row): OrgAggregatorWebhook {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    secret: row.secret,
    active: row.active === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function newId(): string {
  return `oaw_${randomUUID().replace(/-/g, '')}`;
}

export class SqliteOrgAggregatorWebhookRepository
  implements OrgAggregatorWebhookRepository
{
  constructor(private readonly db: Database.Database) {}

  async create(
    input: CreateOrgAggregatorWebhookInput,
  ): Promise<OrgAggregatorWebhook> {
    const id = input.id ?? newId();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO org_aggregator_webhooks
           (id, org_id, url, secret, active, created_at, created_by)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.orgId,
        input.url,
        input.secret ?? null,
        createdAt,
        input.createdBy ?? null,
      );
    const row = this.db
      .prepare('SELECT * FROM org_aggregator_webhooks WHERE id = ?')
      .get(id) as Row | undefined;
    if (row === undefined) {
      throw new Error('failed to read back created aggregator webhook');
    }
    return rowToRecord(row);
  }

  async listActive(orgId: string): Promise<readonly OrgAggregatorWebhook[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM org_aggregator_webhooks
           WHERE org_id = ? AND active = 1
           ORDER BY created_at ASC`,
      )
      .all(orgId) as Row[];
    return rows.map(rowToRecord);
  }

  async listAll(orgId: string): Promise<readonly OrgAggregatorWebhook[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM org_aggregator_webhooks
           WHERE org_id = ?
           ORDER BY created_at ASC`,
      )
      .all(orgId) as Row[];
    return rows.map(rowToRecord);
  }

  async delete(id: string): Promise<boolean> {
    // Soft delete — flip active=0 so historical audit refs survive.
    const result = this.db
      .prepare('UPDATE org_aggregator_webhooks SET active = 0 WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
