import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { OrgRepository } from '../../interfaces/org-repository.js';
import type { Organization, OrgMember } from '../../types.js';
import { DEFAULT_ORG_ROLES } from '../../../permissions.js';

// ---------------------------------------------------------------------------
// Private row types
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  compliance_client_id: string | null;
  compliance_client_secret: string | null;
  branding_client_id: string | null;
  branding_client_secret: string | null;
  llm_client_id: string | null;
  llm_client_secret: string | null;
  branding_mode: string;
}

/**
 * Narrow the untyped `branding_mode` TEXT column to the typed literal union.
 *
 * The `organizations.branding_mode` column (migration 043) has no SQLite-level
 * CHECK constraint — unlike `brand_scores.mode` which does. TypeScript's
 * literal union `'embedded' | 'remote'` is the primary contract; this helper
 * is the runtime defense against schema drift (a future migration that adds
 * a third value without updating this helper, a plugin that writes an
 * unexpected string, or a direct SQL edit via a REPL).
 *
 * FAIL-FAST (LOCKED): this throws from every read path (rowToOrg, getBrandingMode).
 * A single corrupt row will make listOrgs / getOrg / getOrgBySlug / getUserOrgs
 * die loudly rather than silently degrade. Data-integrity violations MUST
 * surface, not be swallowed. See Plan 16-03 Task 2 Edit 2 for the full
 * rationale.
 */
function narrowBrandingMode(value: string): 'embedded' | 'remote' {
  if (value === 'embedded' || value === 'remote') {
    return value;
  }
  throw new Error(`organizations.branding_mode has unexpected value: ${value}`);
}

interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

function rowToOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    ...(row.compliance_client_id ? { complianceClientId: row.compliance_client_id } : {}),
    ...(row.compliance_client_secret ? { complianceClientSecret: row.compliance_client_secret } : {}),
    ...(row.branding_client_id ? { brandingClientId: row.branding_client_id } : {}),
    ...(row.branding_client_secret ? { brandingClientSecret: row.branding_client_secret } : {}),
    ...(row.llm_client_id ? { llmClientId: row.llm_client_id } : {}),
    ...(row.llm_client_secret ? { llmClientSecret: row.llm_client_secret } : {}),
    brandingMode: narrowBrandingMode(row.branding_mode),
  };
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

    const insertOrg = this.db.prepare(
      'INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
    );

    const insertRole = this.db.prepare(
      'INSERT INTO roles (id, name, description, is_system, org_id, created_at) VALUES (?, ?, ?, 0, ?, ?)',
    );

    const insertPerm = this.db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)',
    );

    this.db.transaction(() => {
      insertOrg.run(id, data.name, data.slug, createdAt);

      for (const roleDef of DEFAULT_ORG_ROLES) {
        const roleId = randomUUID();
        insertRole.run(roleId, roleDef.name, roleDef.description, id, createdAt);
        for (const perm of roleDef.permissions) {
          insertPerm.run(roleId, perm);
        }
      }
    })();

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

  async listAllMembers(orgId: string): Promise<OrgMember[]> {
    // Direct members
    const directRows = this.db.prepare(
      'SELECT * FROM org_members WHERE org_id = ? ORDER BY joined_at',
    ).all(orgId) as OrgMemberRow[];

    const directMembers: OrgMember[] = directRows.map((row) => ({
      ...rowToMember(row),
      source: 'direct' as const,
    }));

    // Team-inherited members: users in teams linked to this org
    const teamRows = this.db.prepare(`
      SELECT tm.user_id, tm.role AS team_role, t.name AS team_name
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE t.org_id = ?
    `).all(orgId) as Array<{ user_id: string; team_role: string; team_name: string }>;

    // Role hierarchy for precedence: owner > admin > member > viewer
    const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
    const directUserIds = new Set(directMembers.map((m) => m.userId));

    // Collect best team role per user (highest across all teams in this org)
    const teamMemberMap = new Map<string, { role: string; rank: number; teamName: string }>();
    for (const row of teamRows) {
      if (directUserIds.has(row.user_id)) continue; // skip users already direct members
      const rank = ROLE_RANK[row.team_role] ?? 0;
      const existing = teamMemberMap.get(row.user_id);
      if (existing === undefined || rank > existing.rank) {
        teamMemberMap.set(row.user_id, { role: row.team_role, rank, teamName: row.team_name });
      }
    }

    const inheritedMembers: OrgMember[] = Array.from(teamMemberMap.entries()).map(
      ([userId, info]) => ({
        orgId,
        userId,
        role: info.role,
        joinedAt: '',
        source: 'team' as const,
        teamName: info.teamName,
      }),
    );

    return [...directMembers, ...inheritedMembers];
  }

  async getOrgComplianceCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = this.db.prepare(
      'SELECT compliance_client_id, compliance_client_secret FROM organizations WHERE id = ?',
    ).get(orgId) as { compliance_client_id: string | null; compliance_client_secret: string | null } | undefined;

    if (row === undefined || !row.compliance_client_id || !row.compliance_client_secret) {
      return null;
    }

    return { clientId: row.compliance_client_id, clientSecret: row.compliance_client_secret };
  }

  async updateOrgComplianceClient(orgId: string, clientId: string, clientSecret: string): Promise<void> {
    this.db.prepare(
      'UPDATE organizations SET compliance_client_id = ?, compliance_client_secret = ? WHERE id = ?',
    ).run(clientId, clientSecret, orgId);
  }

  async getOrgBrandingCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = this.db.prepare(
      'SELECT branding_client_id, branding_client_secret FROM organizations WHERE id = ?',
    ).get(orgId) as { branding_client_id: string | null; branding_client_secret: string | null } | undefined;

    if (row === undefined || !row.branding_client_id || !row.branding_client_secret) {
      return null;
    }

    return { clientId: row.branding_client_id, clientSecret: row.branding_client_secret };
  }

  async updateOrgBrandingClient(orgId: string, clientId: string, clientSecret: string): Promise<void> {
    this.db.prepare(
      'UPDATE organizations SET branding_client_id = ?, branding_client_secret = ? WHERE id = ?',
    ).run(clientId, clientSecret, orgId);
  }

  async getOrgLLMCredentials(orgId: string): Promise<{ clientId: string; clientSecret: string } | null> {
    const row = this.db.prepare(
      'SELECT llm_client_id, llm_client_secret FROM organizations WHERE id = ?',
    ).get(orgId) as { llm_client_id: string | null; llm_client_secret: string | null } | undefined;

    if (row === undefined || !row.llm_client_id || !row.llm_client_secret) {
      return null;
    }

    return { clientId: row.llm_client_id, clientSecret: row.llm_client_secret };
  }

  async updateOrgLLMClient(orgId: string, clientId: string, clientSecret: string): Promise<void> {
    this.db.prepare(
      'UPDATE organizations SET llm_client_id = ?, llm_client_secret = ? WHERE id = ?',
    ).run(clientId, clientSecret, orgId);
  }

  async getBrandingMode(orgId: string): Promise<'embedded' | 'remote'> {
    const row = this.db
      .prepare('SELECT branding_mode FROM organizations WHERE id = ?')
      .get(orgId) as { branding_mode: string } | undefined;
    if (row === undefined) {
      throw new Error(`organization not found: ${orgId}`);
    }
    return narrowBrandingMode(row.branding_mode);
  }

  async setBrandingMode(orgId: string, mode: 'embedded' | 'remote'): Promise<void> {
    const result = this.db
      .prepare('UPDATE organizations SET branding_mode = ? WHERE id = ?')
      .run(mode, orgId);
    if (result.changes === 0) {
      throw new Error(`organization not found: ${orgId}`);
    }
  }

  async getUserOrgs(userId: string): Promise<Organization[]> {
    // Direct membership
    const directRows = this.db.prepare(`
      SELECT o.* FROM organizations o
      JOIN org_members m ON o.id = m.org_id
      WHERE m.user_id = ?
      ORDER BY o.created_at
    `).all(userId) as OrgRow[];

    // Team-inherited membership: orgs where user is in a linked team
    const teamRows = this.db.prepare(`
      SELECT DISTINCT o.* FROM organizations o
      JOIN teams t ON t.org_id = o.id
      JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ?
      ORDER BY o.created_at
    `).all(userId) as OrgRow[];

    // Merge, deduplicating by org id
    const seen = new Set<string>();
    const result: Organization[] = [];

    for (const row of [...directRows, ...teamRows]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        result.push(rowToOrg(row));
      }
    }

    return result;
  }
}
