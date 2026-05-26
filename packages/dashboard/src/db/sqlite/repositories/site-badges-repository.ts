import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  SiteBadge,
  SiteBadgesRepository,
} from '../../interfaces/site-badges-repository.js';

interface SiteBadgeRow {
  id: string;
  org_id: string;
  site_url: string;
  enabled: number;
  created_at: string;
  created_by: string | null;
}

function rowToRecord(row: SiteBadgeRow): SiteBadge {
  return {
    id: row.id,
    orgId: row.org_id,
    siteUrl: row.site_url,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export class SqliteSiteBadgesRepository implements SiteBadgesRepository {
  constructor(private readonly db: Database.Database) {}

  async enable(orgId: string, siteUrl: string, userId: string): Promise<SiteBadge> {
    const existing = this.db
      .prepare('SELECT * FROM site_badges WHERE org_id = ? AND site_url = ?')
      .get(orgId, siteUrl) as SiteBadgeRow | undefined;
    if (existing !== undefined) {
      if (existing.enabled !== 1) {
        this.db
          .prepare('UPDATE site_badges SET enabled = 1 WHERE id = ?')
          .run(existing.id);
      }
      return rowToRecord({ ...existing, enabled: 1 });
    }
    const id = `sbdg_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO site_badges (id, org_id, site_url, enabled, created_at, created_by)
         VALUES (@id, @orgId, @siteUrl, 1, @now, @userId)`,
      )
      .run({ id, orgId, siteUrl, now, userId });
    return rowToRecord({
      id,
      org_id: orgId,
      site_url: siteUrl,
      enabled: 1,
      created_at: now,
      created_by: userId,
    });
  }

  async list(orgIdFilter?: string): Promise<readonly SiteBadge[]> {
    const rows = (orgIdFilter !== undefined
      ? this.db
          .prepare('SELECT * FROM site_badges WHERE org_id = ? ORDER BY created_at DESC')
          .all(orgIdFilter)
      : this.db
          .prepare('SELECT * FROM site_badges ORDER BY created_at DESC')
          .all()
    ) as SiteBadgeRow[];
    return rows.map(rowToRecord);
  }

  async setEnabled(id: string, orgId: string, enabled: boolean): Promise<boolean> {
    const result = this.db
      .prepare(
        'UPDATE site_badges SET enabled = ? WHERE id = ? AND org_id = ?',
      )
      .run(enabled ? 1 : 0, id, orgId);
    return result.changes > 0;
  }

  async get(id: string): Promise<SiteBadge | null> {
    const row = this.db
      .prepare('SELECT * FROM site_badges WHERE id = ?')
      .get(id) as SiteBadgeRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async getForSite(orgId: string, siteUrl: string): Promise<SiteBadge | null> {
    const row = this.db
      .prepare('SELECT * FROM site_badges WHERE org_id = ? AND site_url = ?')
      .get(orgId, siteUrl) as SiteBadgeRow | undefined;
    return row ? rowToRecord(row) : null;
  }
}
