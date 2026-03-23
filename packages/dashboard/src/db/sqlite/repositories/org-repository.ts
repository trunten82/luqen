import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { OrgRepository } from '../../interfaces/org-repository.js';
import type { Organization, OrgMember } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row types
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

function rowToOrg(row: OrgRow): Organization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at };
}

function rowToMember(row: OrgMemberRow): OrgMember {
  return { orgId: row.org_id, userId: row.user_id, role: row.role, joinedAt: row.joined_at };
}

// ---------------------------------------------------------------------------
// SqliteOrgRepository
// ---------------------------------------------------------------------------

export class SqliteOrgRepository implements OrgRepository {
  constructor(private readonly db: Database.Database) {}

  async createOrg(data: { name: string; slug: string }): Promise<Organization> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, data.name, data.slug, createdAt);
    return { id, name: data.name, slug: data.slug, createdAt };
  }

  async getOrg(id: string): Promise<Organization | null> {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as OrgRow | undefined;
    return row !== undefined ? rowToOrg(row) : null;
  }

  async getOrgBySlug(slug: string): Promise<Organization | null> {
    const row = this.db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as OrgRow | undefined;
    return row !== undefined ? rowToOrg(row) : null;
  }

  async listOrgs(): Promise<Organization[]> {
    const rows = this.db.prepare('SELECT * FROM organizations ORDER BY created_at').all() as OrgRow[];
    return rows.map(rowToOrg);
  }

  async deleteOrg(id: string): Promise<void> {
    this.db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
  }

  async addMember(orgId: string, userId: string, role: string): Promise<OrgMember> {
    const joinedAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).run(orgId, userId, role, joinedAt);
    return { orgId, userId, role, joinedAt };
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    this.db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const rows = this.db.prepare(
      'SELECT * FROM org_members WHERE org_id = ? ORDER BY joined_at',
    ).all(orgId) as OrgMemberRow[];
    return rows.map(rowToMember);
  }

  async getUserOrgs(userId: string): Promise<Organization[]> {
    const rows = this.db.prepare(`
      SELECT o.* FROM organizations o
      JOIN org_members m ON o.id = m.org_id
      WHERE m.user_id = ?
      ORDER BY o.created_at
    `).all(userId) as OrgRow[];
    return rows.map(rowToOrg);
  }
}
