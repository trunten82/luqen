import type Database from 'better-sqlite3';
import type { PageHashRepository } from '../../interfaces/page-hash-repository.js';
import type { PageHashEntry } from '../../types.js';

// ---------------------------------------------------------------------------
// SqlitePageHashRepository
// ---------------------------------------------------------------------------

export class SqlitePageHashRepository implements PageHashRepository {
  constructor(private readonly db: Database.Database) {}

  async getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>> {
    const stmt = this.db.prepare(
      'SELECT page_url, content_hash FROM page_hashes WHERE site_url = @siteUrl AND org_id = @orgId',
    );
    const rows = stmt.all({ siteUrl, orgId }) as Array<{ page_url: string; content_hash: string }>;
    const result = new Map<string, string>();
    for (const row of rows) {
      result.set(row.page_url, row.content_hash);
    }
    return result;
  }

  async upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
      VALUES (@siteUrl, @pageUrl, @hash, @lastScannedAt, @orgId)
      ON CONFLICT (site_url, page_url, org_id)
      DO UPDATE SET content_hash = @hash, last_scanned_at = @lastScannedAt
    `);
    stmt.run({
      siteUrl,
      pageUrl,
      hash,
      lastScannedAt: new Date().toISOString(),
      orgId,
    });
  }

  async upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO page_hashes (site_url, page_url, content_hash, last_scanned_at, org_id)
      VALUES (@siteUrl, @pageUrl, @hash, @lastScannedAt, @orgId)
      ON CONFLICT (site_url, page_url, org_id)
      DO UPDATE SET content_hash = @hash, last_scanned_at = @lastScannedAt
    `);

    const upsertMany = this.db.transaction((rows: ReadonlyArray<PageHashEntry>) => {
      const now = new Date().toISOString();
      for (const entry of rows) {
        stmt.run({
          siteUrl: entry.siteUrl,
          pageUrl: entry.pageUrl,
          hash: entry.hash,
          lastScannedAt: now,
          orgId: entry.orgId,
        });
      }
    });

    upsertMany(entries);
  }
}
