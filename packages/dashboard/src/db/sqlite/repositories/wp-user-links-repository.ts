import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  WpUserLink,
  WpUserLinksRepository,
  UpsertWpUserLinkInput,
} from '../../interfaces/wp-network-repository.js';

interface WpUserLinkRow {
  id: string;
  site_url: string;
  wp_user_id: number;
  wp_login: string;
  email: string;
  dashboard_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: WpUserLinkRow): WpUserLink {
  return {
    id: row.id,
    siteUrl: row.site_url,
    wpUserId: row.wp_user_id,
    wpLogin: row.wp_login,
    email: row.email,
    dashboardUserId: row.dashboard_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteWpUserLinksRepository implements WpUserLinksRepository {
  constructor(private readonly db: Database.Database) {}

  async upsert(input: UpsertWpUserLinkInput): Promise<WpUserLink> {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM wp_user_links WHERE site_url = ? AND wp_user_id = ?')
      .get(input.siteUrl, input.wpUserId) as WpUserLinkRow | undefined;

    if (existing !== undefined) {
      this.db
        .prepare(
          `UPDATE wp_user_links
             SET wp_login = @wpLogin,
                 email = @email,
                 dashboard_user_id = @dashboardUserId,
                 updated_at = @now
           WHERE id = @id`,
        )
        .run({
          id: existing.id,
          wpLogin: input.wpLogin,
          email: input.email,
          dashboardUserId: input.dashboardUserId,
          now,
        });
      const updated = this.db
        .prepare('SELECT * FROM wp_user_links WHERE id = ?')
        .get(existing.id) as WpUserLinkRow;
      return rowToRecord(updated);
    }

    const id = `wpl_${randomUUID().replace(/-/g, '')}`;
    this.db
      .prepare(
        `INSERT INTO wp_user_links
           (id, site_url, wp_user_id, wp_login, email, dashboard_user_id,
            created_at, updated_at)
         VALUES (@id, @siteUrl, @wpUserId, @wpLogin, @email,
                 @dashboardUserId, @now, @now)`,
      )
      .run({
        id,
        siteUrl: input.siteUrl,
        wpUserId: input.wpUserId,
        wpLogin: input.wpLogin,
        email: input.email,
        dashboardUserId: input.dashboardUserId,
        now,
      });
    const created = this.db
      .prepare('SELECT * FROM wp_user_links WHERE id = ?')
      .get(id) as WpUserLinkRow;
    return rowToRecord(created);
  }

  async get(siteUrl: string, wpUserId: number): Promise<WpUserLink | null> {
    const row = this.db
      .prepare('SELECT * FROM wp_user_links WHERE site_url = ? AND wp_user_id = ?')
      .get(siteUrl, wpUserId) as WpUserLinkRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async listByDashboardUser(dashboardUserId: string): Promise<readonly WpUserLink[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM wp_user_links WHERE dashboard_user_id = ? ORDER BY updated_at DESC',
      )
      .all(dashboardUserId) as WpUserLinkRow[];
    return rows.map(rowToRecord);
  }
}
