import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  WpSite,
  WpSitesRepository,
  RegisterWpSiteInput,
  ListWpSitesFilter,
  ListAllWpSitesFilter,
} from '../../interfaces/wp-network-repository.js';

interface WpSiteRow {
  id: string;
  org_id: string;
  oauth_client_id: string;
  url: string;
  wp_version: string | null;
  plugin_version: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
}

function rowToRecord(row: WpSiteRow): WpSite {
  return {
    id: row.id,
    orgId: row.org_id,
    oauthClientId: row.oauth_client_id,
    url: row.url,
    wpVersion: row.wp_version,
    pluginVersion: row.plugin_version,
    status: row.status === 'stale' ? 'stale' : 'active',
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export class SqliteWpSitesRepository implements WpSitesRepository {
  constructor(private readonly db: Database.Database) {}

  async register(input: RegisterWpSiteInput): Promise<WpSite> {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM wp_sites WHERE oauth_client_id = ? AND url = ?')
      .get(input.oauthClientId, input.url) as WpSiteRow | undefined;

    if (existing !== undefined) {
      this.db
        .prepare(
          `UPDATE wp_sites
             SET wp_version = COALESCE(@wpVersion, wp_version),
                 plugin_version = COALESCE(@pluginVersion, plugin_version),
                 status = 'active',
                 last_seen_at = @now
           WHERE id = @id`,
        )
        .run({
          id: existing.id,
          wpVersion: input.wpVersion ?? null,
          pluginVersion: input.pluginVersion ?? null,
          now,
        });
      const updated = this.db
        .prepare('SELECT * FROM wp_sites WHERE id = ?')
        .get(existing.id) as WpSiteRow;
      return rowToRecord(updated);
    }

    const id = `site_${randomUUID().replace(/-/g, '')}`;
    this.db
      .prepare(
        `INSERT INTO wp_sites
           (id, org_id, oauth_client_id, url, wp_version, plugin_version,
            status, last_seen_at, created_at)
         VALUES (@id, @orgId, @oauthClientId, @url, @wpVersion, @pluginVersion,
                 'active', @now, @now)`,
      )
      .run({
        id,
        orgId: input.orgId,
        oauthClientId: input.oauthClientId,
        url: input.url,
        wpVersion: input.wpVersion ?? null,
        pluginVersion: input.pluginVersion ?? null,
        now,
      });
    const created = this.db
      .prepare('SELECT * FROM wp_sites WHERE id = ?')
      .get(id) as WpSiteRow;
    return rowToRecord(created);
  }

  async get(id: string): Promise<WpSite | null> {
    const row = this.db
      .prepare('SELECT * FROM wp_sites WHERE id = ?')
      .get(id) as WpSiteRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async list(filter: ListWpSitesFilter): Promise<readonly WpSite[]> {
    const status = filter.status ?? 'active';
    const rows = (
      status === 'all'
        ? this.db
            .prepare(
              'SELECT * FROM wp_sites WHERE org_id = ? ORDER BY last_seen_at DESC',
            )
            .all(filter.orgId)
        : this.db
            .prepare(
              'SELECT * FROM wp_sites WHERE org_id = ? AND status = ? ORDER BY last_seen_at DESC',
            )
            .all(filter.orgId, status)
    ) as WpSiteRow[];
    return rows.map(rowToRecord);
  }

  async listAll(filter: ListAllWpSitesFilter = {}): Promise<readonly WpSite[]> {
    const status = filter.status ?? 'all';
    const rows = (
      status === 'all'
        ? this.db
            .prepare('SELECT * FROM wp_sites ORDER BY last_seen_at DESC')
            .all()
        : this.db
            .prepare(
              'SELECT * FROM wp_sites WHERE status = ? ORDER BY last_seen_at DESC',
            )
            .all(status)
    ) as WpSiteRow[];
    return rows.map(rowToRecord);
  }

  async markStale(staleAfterMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE wp_sites SET status = 'stale'
          WHERE status = 'active' AND last_seen_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }
}
