import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

export interface OrgMember {
  readonly orgId: string;
  readonly userId: string;
  readonly role: string;
  readonly joinedAt: string;
}

export class OrgDb {
  constructor(private readonly db: Database.Database) {}

  createOrg(data: { name: string; slug: string }): Organization {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, data.name, data.slug, createdAt);
    return { id, name: data.name, slug: data.slug, createdAt };
  }

  getOrg(id: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as
      | { id: string; name: string; slug: string; created_at: string }
      | undefined;
    return row != null ? { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at } : null;
  }

  getOrgBySlug(slug: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as
      | { id: string; name: string; slug: string; created_at: string }
      | undefined;
    return row != null ? { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at } : null;
  }

  listOrgs(): Organization[] {
    const rows = this.db.prepare('SELECT * FROM organizations ORDER BY created_at').all() as
      Array<{ id: string; name: string; slug: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.created_at }));
  }

  deleteOrg(id: string): void {
    this.db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
  }

  addMember(orgId: string, userId: string, role: string): OrgMember {
    const joinedAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).run(orgId, userId, role, joinedAt);
    return { orgId, userId, role, joinedAt };
  }

  removeMember(orgId: string, userId: string): void {
    this.db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
  }

  listMembers(orgId: string): OrgMember[] {
    const rows = this.db.prepare(
      'SELECT * FROM org_members WHERE org_id = ? ORDER BY joined_at',
    ).all(orgId) as Array<{ org_id: string; user_id: string; role: string; joined_at: string }>;
    return rows.map((r) => ({ orgId: r.org_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
  }

  getUserOrgs(userId: string): Organization[] {
    const rows = this.db.prepare(`
      SELECT o.* FROM organizations o
      JOIN org_members m ON o.id = m.org_id
      WHERE m.user_id = ?
      ORDER BY o.created_at
    `).all(userId) as Array<{ id: string; name: string; slug: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.created_at }));
  }
}
