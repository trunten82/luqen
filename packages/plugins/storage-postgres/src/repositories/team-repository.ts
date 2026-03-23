import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly orgId: string;
  readonly createdAt: string;
  readonly memberCount?: number;
  readonly members?: ReadonlyArray<TeamMember>;
}

interface TeamMember {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
}

interface TeamRepository {
  listTeams(orgId?: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  getTeamByName(name: string, orgId?: string): Promise<Team | null>;
  createTeam(data: { readonly name: string; readonly description: string; readonly orgId: string }): Promise<Team>;
  updateTeam(id: string, data: { readonly name?: string; readonly description?: string }): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  addTeamMember(teamId: string, userId: string, role?: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  listTeamMembers(teamId: string): Promise<TeamMember[]>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface TeamRow {
  id: string;
  name: string;
  description: string;
  org_id: string;
  created_at: string | Date;
  member_count?: string;
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}

function teamRowToRecord(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    orgId: row.org_id,
    createdAt: toIso(row.created_at),
    ...(row.member_count !== undefined ? { memberCount: parseInt(row.member_count, 10) } : {}),
  };
}

// ---------------------------------------------------------------------------
// PgTeamRepository
// ---------------------------------------------------------------------------

export class PgTeamRepository implements TeamRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listTeams(orgId?: string): Promise<Team[]> {
    let result: pg.QueryResult<TeamRow>;
    if (orgId !== undefined) {
      result = await this.pool.query<TeamRow>(
        `SELECT t.*, COUNT(tm.user_id) as member_count
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id
         WHERE t.org_id = $1 OR t.org_id = 'system'
         GROUP BY t.id
         ORDER BY t.name ASC`,
        [orgId],
      );
    } else {
      result = await this.pool.query<TeamRow>(
        `SELECT t.*, COUNT(tm.user_id) as member_count
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id
         GROUP BY t.id
         ORDER BY t.name ASC`,
      );
    }
    return result.rows.map(teamRowToRecord);
  }

  async getTeam(id: string): Promise<Team | null> {
    const result = await this.pool.query<TeamRow>(
      'SELECT * FROM teams WHERE id = $1',
      [id],
    );
    if (result.rows.length === 0) return null;

    const members = await this.listTeamMembers(id);
    return {
      ...teamRowToRecord(result.rows[0]),
      memberCount: members.length,
      members,
    };
  }

  async getTeamByName(name: string, orgId?: string): Promise<Team | null> {
    let result: pg.QueryResult<TeamRow>;
    if (orgId !== undefined) {
      result = await this.pool.query<TeamRow>(
        'SELECT * FROM teams WHERE name = $1 AND org_id = $2',
        [name, orgId],
      );
    } else {
      result = await this.pool.query<TeamRow>(
        'SELECT * FROM teams WHERE name = $1',
        [name],
      );
    }
    if (result.rows.length === 0) return null;

    const members = await this.listTeamMembers(result.rows[0].id);
    return {
      ...teamRowToRecord(result.rows[0]),
      memberCount: members.length,
      members,
    };
  }

  async createTeam(data: { readonly name: string; readonly description: string; readonly orgId: string }): Promise<Team> {
    const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO teams (id, name, description, org_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, data.name, data.description, data.orgId, now],
    );

    const created = await this.getTeam(id);
    if (created === null) {
      throw new Error(`Failed to retrieve team after creation: ${id}`);
    }
    return created;
  }

  async updateTeam(id: string, data: { readonly name?: string; readonly description?: string }): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      params.push(data.name);
    }
    if (data.description !== undefined) {
      setClauses.push(`description = $${idx++}`);
      params.push(data.description);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    await this.pool.query(
      `UPDATE teams SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  async deleteTeam(id: string): Promise<void> {
    await this.pool.query('DELETE FROM teams WHERE id = $1', [id]);
  }

  async addTeamMember(teamId: string, userId: string, role = 'member'): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [teamId, userId, role],
    );
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId],
    );
  }

  async listTeamMembers(teamId: string): Promise<TeamMember[]> {
    const result = await this.pool.query<{ user_id: string; username: string | null; role: string }>(
      `SELECT tm.user_id, du.username, tm.role
       FROM team_members tm
       LEFT JOIN dashboard_users du ON du.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY du.username ASC`,
      [teamId],
    );
    return result.rows.map((r) => ({
      userId: r.user_id,
      username: r.username ?? r.user_id,
      role: r.role,
    }));
  }
}
