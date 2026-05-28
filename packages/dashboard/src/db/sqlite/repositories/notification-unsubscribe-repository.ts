import type Database from 'better-sqlite3';
import type {
  NotificationUnsubscribe,
  NotificationUnsubscribeRepository,
} from '../../interfaces/notification-unsubscribe-repository.js';

interface Row {
  recipient_address: string;
  channel: string;
  org_id: string;
  unsubscribed_at: string;
  resubscribed_at: string | null;
}

function rowToRecord(row: Row): NotificationUnsubscribe {
  return {
    recipientAddress: row.recipient_address,
    channel: row.channel,
    orgId: row.org_id,
    unsubscribedAt: row.unsubscribed_at,
    resubscribedAt: row.resubscribed_at,
  };
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export class SqliteNotificationUnsubscribeRepository
  implements NotificationUnsubscribeRepository
{
  constructor(private readonly db: Database.Database) {}

  async isUnsubscribed(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT resubscribed_at FROM notification_unsubscribes
           WHERE recipient_address = ? AND channel = ? AND org_id = ?`,
      )
      .get(normalizeAddress(recipientAddress), channel, orgId) as
      | { resubscribed_at: string | null }
      | undefined;
    if (row === undefined) return false;
    return row.resubscribed_at === null;
  }

  async unsubscribe(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const address = normalizeAddress(recipientAddress);
    // Upsert: insert new row, or clear resubscribed_at on an existing row so
    // a previously resubscribed recipient can be opted out again.
    this.db
      .prepare(
        `INSERT INTO notification_unsubscribes
           (recipient_address, channel, org_id, unsubscribed_at, resubscribed_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(recipient_address, channel, org_id)
           DO UPDATE SET unsubscribed_at = excluded.unsubscribed_at,
                         resubscribed_at = NULL`,
      )
      .run(address, channel, orgId, now);
  }

  async resubscribe(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE notification_unsubscribes
           SET resubscribed_at = ?
           WHERE recipient_address = ? AND channel = ? AND org_id = ?
             AND resubscribed_at IS NULL`,
      )
      .run(now, normalizeAddress(recipientAddress), channel, orgId);
    return result.changes > 0;
  }

  async listForOrg(
    orgId: string,
    channel?: string,
  ): Promise<readonly NotificationUnsubscribe[]> {
    const rows = channel === undefined
      ? (this.db
          .prepare(
            `SELECT * FROM notification_unsubscribes
               WHERE org_id = ?
               ORDER BY unsubscribed_at DESC`,
          )
          .all(orgId) as Row[])
      : (this.db
          .prepare(
            `SELECT * FROM notification_unsubscribes
               WHERE org_id = ? AND channel = ?
               ORDER BY unsubscribed_at DESC`,
          )
          .all(orgId, channel) as Row[]);
    return rows.map(rowToRecord);
  }
}
