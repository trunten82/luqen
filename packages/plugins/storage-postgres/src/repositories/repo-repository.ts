import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectedRepo {
  readonly id: string;
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath: string | null;
  readonly branch: string;
  readonly authToken: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId: string;
}

interface RepoRepository {
  listRepos(orgId?: string): Promise<ConnectedRepo[]>;
  getRepo(id: string): Promise<ConnectedRepo | null>;
  findRepoForUrl(siteUrl: string, orgId: string): Promise<ConnectedRepo | null>;
  createRepo(data: {
    readonly id: string;
    readonly siteUrlPattern: string;
    readonly repoUrl: string;
    readonly repoPath?: string;
    readonly branch?: string;
    readonly authToken?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): Promise<ConnectedRepo>;
  deleteRepo(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface ConnectedRepoRow {
  id: string;
  site_url_pattern: string;
  repo_url: string;
  repo_path: string | null;
  branch: string;
  auth_token: string | null;
  created_by: string;
  created_at: string | Date;
  org_id: string;
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
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
    createdAt: toIso(row.created_at),
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// PgRepoRepository
// ---------------------------------------------------------------------------

export class PgRepoRepository implements RepoRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listRepos(orgId?: string): Promise<ConnectedRepo[]> {
    if (orgId !== undefined) {
      const result = await this.pool.query<ConnectedRepoRow>(
        'SELECT * FROM connected_repos WHERE org_id = $1 ORDER BY created_at DESC',
        [orgId],
      );
      return result.rows.map(repoRowToRecord);
    }

    const result = await this.pool.query<ConnectedRepoRow>(
      'SELECT * FROM connected_repos ORDER BY created_at DESC',
    );
    return result.rows.map(repoRowToRecord);
  }

  async getRepo(id: string): Promise<ConnectedRepo | null> {
    const result = await this.pool.query<ConnectedRepoRow>(
      'SELECT * FROM connected_repos WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? repoRowToRecord(result.rows[0]) : null;
  }

  async findRepoForUrl(siteUrl: string, orgId: string): Promise<ConnectedRepo | null> {
    const result = await this.pool.query<ConnectedRepoRow>(
      'SELECT * FROM connected_repos WHERE $1 LIKE site_url_pattern AND org_id = $2 ORDER BY created_at DESC LIMIT 1',
      [siteUrl, orgId],
    );
    return result.rows.length > 0 ? repoRowToRecord(result.rows[0]) : null;
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

    await this.pool.query(
      `INSERT INTO connected_repos (id, site_url_pattern, repo_url, repo_path, branch, auth_token, created_by, created_at, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.id,
        data.siteUrlPattern,
        data.repoUrl,
        data.repoPath ?? null,
        data.branch ?? 'main',
        data.authToken ?? null,
        data.createdBy,
        now,
        data.orgId ?? 'system',
      ],
    );

    const created = await this.getRepo(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve connected repo after creation: ${data.id}`);
    }
    return created;
  }

  async deleteRepo(id: string): Promise<void> {
    await this.pool.query('DELETE FROM connected_repos WHERE id = $1', [id]);
  }
}
