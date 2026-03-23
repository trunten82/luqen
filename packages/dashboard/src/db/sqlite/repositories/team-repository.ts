import type Database from 'better-sqlite3';
import type { TeamRepository } from '../../interfaces/team-repository.js';
import type { Team, TeamMember } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
// ---------------------------------------------------------------------------

interface TeamRow {
  id: string;
  name: string;
  description: string;
  org_id: string;
  created_at: string;
  member_count?: number;
}

function teamRowToRecord(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    orgId: row.org_id,
    createdAt: row.created_at,
    ...(row.member_count !== undefined ? { memberCount: row.member_count } : {}),
  };
}

// ---------------------------------------------------------------------------
// SqliteTeamRepository
// ---------------------------------------------------------------------------

export class SqliteTeamRepository implements TeamRepository {
  constructor(private readonly db: Database.Database) {}

  async listTeams(orgId?: string): Promise<Team[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (orgId !== undefined) {
      conditions.push("(t.org_id = @orgId OR t.org_id = 'system')");
      params['orgId'] = orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT t.*, COUNT(tm.user_id) as member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      ${where}
      GROUP BY t.id
      ORDER BY t.name ASC
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as TeamRow[];
    return rows.map(teamRowToRecord);
  }

  async getTeam(id: string): Promise<Team | null> {
    const stmt = this.db.prepare('SELECT * FROM teams WHERE id = ?');
    const row = stmt.get(id) as TeamRow | undefined;
    if (row === undefined) return null;

    const members = await this.listTeamMembers(id);
    return {
      ...teamRowToRecord(row),
      memberCount: members.length,
      members,
    };
  }

  async getTeamByName(name: string, orgId?: string): Promise<Team | null> {
    const sql = orgId !== undefined
      ? 'SELECT * FROM teams WHERE name = ? AND org_id = ?'
      : 'SELECT * FROM teams WHERE name = ?';
    const params = orgId !== undefined ? [name, orgId] : [name];
    const row = this.db.prepare(sql).get(...params) as TeamRow | undefined;
    if (row === undefined) return null;

    const members = await this.listTeamMembers(row.id);
    return {
      ...teamRowToRecord(row),
      memberCount: members.length,
      members,
    };
  }

  async createTeam(data: { readonly name: string; readonly description: string; readonly orgId: string }): Promise<Team> {
    const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO teams (id, name, description, org_id, created_at)
      VALUES (@id, @name, @description, @orgId, @createdAt)
    `);

    stmt.run({
      id,
      name: data.name,
      description: data.description,
      orgId: data.orgId,
      createdAt: now,
    });

    const created = await this.getTeam(id);
    if (created === null) {
      throw new Error(`Failed to retrieve team after creation: ${id}`);
    }
    return created;
  }

  async updateTeam(id: string, data: { readonly name?: string; readonly description?: string }): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (data.name !== undefined) {
      setClauses.push('name = @name');
      params['name'] = data.name;
    }
    if (data.description !== undefined) {
      setClauses.push('description = @description');
      params['description'] = data.description;
    }

    if (setClauses.length === 0) return;

    const stmt = this.db.prepare(
      `UPDATE teams SET ${setClauses.join(', ')} WHERE id = @id`,
    );
    stmt.run(params);
  }

  async deleteTeam(id: string): Promise<void> {
    this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  async addTeamMember(teamId: string, userId: string, role = 'member'): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO team_members (team_id, user_id, role)
      VALUES (@teamId, @userId, @role)
    `);
    stmt.run({ teamId, userId, role });
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM team_members WHERE team_id = @teamId AND user_id = @userId',
    ).run({ teamId, userId });
  }

  async listTeamMembers(teamId: string): Promise<TeamMember[]> {
    const stmt = this.db.prepare(`
      SELECT tm.user_id, du.username, tm.role
      FROM team_members tm
      LEFT JOIN dashboard_users du ON du.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY du.username ASC
    `);
    const rows = stmt.all(teamId) as Array<{ user_id: string; username: string | null; role: string }>;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username ?? r.user_id,
      role: r.role,
    }));
  }
}
