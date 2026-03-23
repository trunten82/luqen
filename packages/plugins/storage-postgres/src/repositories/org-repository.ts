import type pg from 'pg';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

interface OrgMember {
  readonly orgId: string;
  readonly userId: string;
  readonly role: string;
  readonly joinedAt: string;
}

interface OrgRepository {
  createOrg(data: { name: string; slug: string }): Promise<Organization>;
  getOrg(id: string): Promise<Organization | null>;
  getOrgBySlug(slug: string): Promise<Organization | null>;
  listOrgs(): Promise<Organization[]>;
  deleteOrg(id: string): Promise<void>;
  addMember(orgId: string, userId: string, role: string): Promise<OrgMember>;
  removeMember(orgId: string, userId: string): Promise<void>;
  listMembers(orgId: string): Promise<OrgMember[]>;
  getUserOrgs(userId: string): Promise<Organization[]>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string | Date;
}

interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: string;
  joined_at: string | Date;
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}

function rowToOrg(row: OrgRow): Organization {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: toIso(row.created_at) };
}

function rowToMember(row: OrgMemberRow): OrgMember {
  return { orgId: row.org_id, userId: row.user_id, role: row.role, joinedAt: toIso(row.joined_at) };
}

// ---------------------------------------------------------------------------
// PgOrgRepository
// ---------------------------------------------------------------------------

export class PgOrgRepository implements OrgRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createOrg(data: { name: string; slug: string }): Promise<Organization> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.pool.query(
      'INSERT INTO organizations (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      [id, data.name, data.slug, createdAt],
    );
    return { id, name: data.name, slug: data.slug, createdAt };
  }

  async getOrg(id: string): Promise<Organization | null> {
    const result = await this.pool.query<OrgRow>('SELECT * FROM organizations WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToOrg(result.rows[0]) : null;
  }

  async getOrgBySlug(slug: string): Promise<Organization | null> {
    const result = await this.pool.query<OrgRow>('SELECT * FROM organizations WHERE slug = $1', [slug]);
    return result.rows.length > 0 ? rowToOrg(result.rows[0]) : null;
  }

  async listOrgs(): Promise<Organization[]> {
    const result = await this.pool.query<OrgRow>('SELECT * FROM organizations ORDER BY created_at');
    return result.rows.map(rowToOrg);
  }

  async deleteOrg(id: string): Promise<void> {
    await this.pool.query('DELETE FROM organizations WHERE id = $1', [id]);
  }

  async addMember(orgId: string, userId: string, role: string): Promise<OrgMember> {
    const joinedAt = new Date().toISOString();
    await this.pool.query(
      'INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)',
      [orgId, userId, role, joinedAt],
    );
    return { orgId, userId, role, joinedAt };
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.pool.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const result = await this.pool.query<OrgMemberRow>(
      'SELECT * FROM org_members WHERE org_id = $1 ORDER BY joined_at',
      [orgId],
    );
    return result.rows.map(rowToMember);
  }

  async getUserOrgs(userId: string): Promise<Organization[]> {
    const result = await this.pool.query<OrgRow>(
      `SELECT o.* FROM organizations o
       JOIN org_members m ON o.id = m.org_id
       WHERE m.user_id = $1
       ORDER BY o.created_at`,
      [userId],
    );
    return result.rows.map(rowToOrg);
  }
}
