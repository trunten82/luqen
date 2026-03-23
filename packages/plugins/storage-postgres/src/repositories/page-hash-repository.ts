import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageHashEntry {
  readonly siteUrl: string;
  readonly pageUrl: string;
  readonly hash: string;
  readonly orgId: string;
}

interface PageHashRepository {
  getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>>;
  upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): Promise<void>;
  upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): Promise<void>;
}

// ---------------------------------------------------------------------------
// PgPageHashRepository
// ---------------------------------------------------------------------------

export class PgPageHashRepository implements PageHashRepository {
  constructor(private readonly pool: pg.Pool) {}

  async getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>> {
    const result = await this.pool.query<{ page_url: string; content_hash: string }>(
      'SELECT page_url, content_hash FROM page_hashes WHERE site_url = $1 AND org_id = $2',
      [siteUrl, orgId],
    );
    const map = new Map<string, string>();
    for (const row of result.rows) {
      map.set(row.page_url, row.content_hash);
    }
    return map;
  }

  async upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (site_url, page_url, org_id)
       DO UPDATE SET content_hash = $3, last_scanned_at = $4`,
      [siteUrl, pageUrl, hash, new Date().toISOString(), orgId],
    );
  }

  async upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): Promise<void> {
    if (entries.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date().toISOString();
      for (const entry of entries) {
        await client.query(
          `INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (site_url, page_url, org_id)
           DO UPDATE SET content_hash = $3, last_scanned_at = $4`,
          [entry.siteUrl, entry.pageUrl, entry.hash, now, entry.orgId],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
