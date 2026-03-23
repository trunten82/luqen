import type Database from 'better-sqlite3';
import type { RepoRepository } from '../../interfaces/repo-repository.js';
import type { ConnectedRepo } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

interface ConnectedRepoRow {
  id: string;
  site_url_pattern: string;
  repo_url: string;
  repo_path: string | null;
  branch: string;
  auth_token: string | null;
  created_by: string;
  created_at: string;
  org_id: string;
}

function repoRowToRecord(row: ConnectedRepoRow): ConnectedRepo {
  return {
    id: row.id,
    siteUrlPattern: row.site_url_pattern,
    repoUrl: row.repo_url,
    repoPath: row.repo_path,
    branch: row.branch,
    authToken: row.auth_token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteRepoRepository
// ---------------------------------------------------------------------------

export class SqliteRepoRepository implements RepoRepository {
  constructor(private readonly db: Database.Database) {}

  async listRepos(orgId?: string): Promise<ConnectedRepo[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM connected_repos ${where} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as ConnectedRepoRow[];
    return rows.map(repoRowToRecord);
  }

  async getRepo(id: string): Promise<ConnectedRepo | null> {
    const stmt = this.db.prepare('SELECT * FROM connected_repos WHERE id = ?');
    const row = stmt.get(id) as ConnectedRepoRow | undefined;
    return row !== undefined ? repoRowToRecord(row) : null;
  }

  async findRepoForUrl(siteUrl: string, orgId: string): Promise<ConnectedRepo | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM connected_repos WHERE @siteUrl LIKE site_url_pattern AND org_id = @orgId ORDER BY created_at DESC LIMIT 1',
    );
    const row = stmt.get({ siteUrl, orgId }) as ConnectedRepoRow | undefined;
    return row !== undefined ? repoRowToRecord(row) : null;
  }

  async createRepo(data: {
    readonly id: string;
    readonly siteUrlPattern: string;
    readonly repoUrl: string;
    readonly repoPath?: string;
    readonly branch?: string;
    readonly authToken?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): Promise<ConnectedRepo> {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO connected_repos (id, site_url_pattern, repo_url, repo_path, branch, auth_token, created_by, created_at, org_id)
      VALUES (@id, @siteUrlPattern, @repoUrl, @repoPath, @branch, @authToken, @createdBy, @createdAt, @orgId)
    `);

    stmt.run({
      id: data.id,
      siteUrlPattern: data.siteUrlPattern,
      repoUrl: data.repoUrl,
      repoPath: data.repoPath ?? null,
      branch: data.branch ?? 'main',
      authToken: data.authToken ?? null,
      createdBy: data.createdBy,
      createdAt: now,
      orgId: data.orgId ?? 'system',
    });

    const created = await this.getRepo(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve connected repo after creation: ${data.id}`);
    }
    return created;
  }

  async deleteRepo(id: string): Promise<void> {
    this.db.prepare('DELETE FROM connected_repos WHERE id = ?').run(id);
  }
}
