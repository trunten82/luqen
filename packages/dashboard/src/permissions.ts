/**
 * Permission definitions for the role-based access control system.
 *
 * Each permission has an id (dot-separated), a human-readable label, and a
 * group used to cluster related permissions in the management UI.
 */

export const ALL_PERMISSIONS = [
  { id: 'scans.create', label: 'Create scans', group: 'Scans' },
  { id: 'scans.schedule', label: 'Manage scan schedules', group: 'Scans' },
  { id: 'reports.view', label: 'View reports', group: 'Reports' },
  { id: 'reports.view_technical', label: 'View technical details (selectors, context)', group: 'Reports' },
  { id: 'reports.export', label: 'Export CSV and PDF', group: 'Reports' },
  { id: 'reports.vpat', label: 'Generate and export VPAT/ACR reports', group: 'Reports' },
  { id: 'reports.delete', label: 'Delete reports', group: 'Reports' },
  { id: 'reports.compare', label: 'Compare reports', group: 'Reports' },
  { id: 'issues.assign', label: 'Assign issues to team members', group: 'Issues' },
  { id: 'issues.fix', label: 'Propose and view fixes', group: 'Issues' },
  { id: 'manual_testing', label: 'Manual testing checklists', group: 'Testing' },
  { id: 'repos.manage', label: 'Connect repositories', group: 'Repositories' },
  { id: 'repos.credentials', label: 'Manage git credentials', group: 'Repositories' },
  { id: 'trends.view', label: 'View trends and analytics', group: 'Analytics' },
  { id: 'users.create', label: 'Create dashboard users', group: 'User Management' },
  { id: 'users.delete', label: 'Delete dashboard users', group: 'User Management' },
  { id: 'users.activate', label: 'Activate and deactivate users', group: 'User Management' },
  { id: 'users.reset_password', label: 'Reset user passwords', group: 'User Management' },
  { id: 'users.roles', label: 'Change user roles', group: 'User Management' },
  { id: 'admin.users', label: 'Manage compliance API users', group: 'Administration' },
  { id: 'admin.roles', label: 'Manage roles', group: 'Administration' },
  { id: 'admin.teams', label: 'Manage teams', group: 'Administration' },
  { id: 'admin.plugins', label: 'Manage plugins', group: 'Administration' },
  { id: 'admin.org', label: 'Manage organization settings', group: 'Administration' },
  { id: 'admin.system', label: 'System settings', group: 'Administration' },
  { id: 'audit.view', label: 'View audit log', group: 'Administration' },
  { id: 'compliance.view', label: 'View compliance data', group: 'Compliance' },
  { id: 'compliance.manage', label: 'Manage compliance items', group: 'Compliance' },
  { id: 'branding.view', label: 'View branding guidelines', group: 'Branding' },
  { id: 'branding.manage', label: 'Manage branding guidelines', group: 'Branding' },
  { id: 'llm.view', label: 'View LLM providers and configuration', group: 'LLM' },
  { id: 'llm.manage', label: 'Manage LLM providers, models, and capabilities', group: 'LLM' },
  // D-01/D-02 (31.2): per-org grant with admin.system bypass; evaluated via resolveEffectivePermissions on /oauth/authorize.
  { id: 'mcp.use', label: 'Connect via MCP', group: 'Administration' },
] as const;

export type PermissionId = typeof ALL_PERMISSIONS[number]['id'];

/** All permission id strings in a plain array. */
export const ALL_PERMISSION_IDS: readonly string[] = ALL_PERMISSIONS.map((p) => p.id);

/** Permission groups for the management UI. */
export function getPermissionGroups(): Array<{
  readonly group: string;
  readonly permissions: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}> {
  const groupMap = new Map<string, Array<{ id: string; label: string }>>();
  for (const p of ALL_PERMISSIONS) {
    const existing = groupMap.get(p.group);
    if (existing !== undefined) {
      existing.push({ id: p.id, label: p.label });
    } else {
      groupMap.set(p.group, [{ id: p.id, label: p.label }]);
    }
  }
  return [...groupMap.entries()].map(([group, permissions]) => ({
    group,
    permissions,
  }));
}

/**
 * Helper to check permissions on a Fastify request.
 * The permissions Set is attached by the preHandler hook in server.ts.
 */
export function hasPermission(request: unknown, permission: string): boolean {
  const perms = (request as { permissions?: Set<string> }).permissions;
  return perms?.has(permission) === true;
}

/**
 * Resolve effective permissions for a user:
 *   effective = global_role.permissions UNION highest_org_role(user, org).permissions
 *
 * Admin users bypass org-level checks and always get all permissions.
 */
export async function resolveEffectivePermissions(
  roleRepository: { getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>> },
  userId: string,
  userRole: string,
  orgId?: string,
): Promise<Set<string>> {
  // Admin users get all permissions regardless of org context
  if (userRole === 'admin') {
    return new Set(ALL_PERMISSION_IDS);
  }

  return roleRepository.getEffectivePermissions(userId, orgId);
}

// ---------------------------------------------------------------------------
// Phase 62.1 — Multi-team RBAC overlay: effective role per org
// ---------------------------------------------------------------------------

/**
 * Role rank for MAX aggregation. Higher = more permissive. Executive sits above
 * Viewer and below Member: it is a read + reports/VPAT/export role with no scan,
 * manual-testing or admin capability. Inserting it keeps the relative order of
 * the original four roles (Viewer < Member < Admin < Owner).
 */
const ROLE_RANK: Record<string, number> = {
  Owner: 5,
  Admin: 4,
  Member: 3,
  Executive: 2,
  Viewer: 1,
};

export interface EffectiveRoleSource {
  readonly kind: 'org' | 'team';
  readonly teamId?: string;
  readonly role: string;
}

export interface EffectiveRoleForOrg {
  readonly orgId: string;
  readonly role: string;
  readonly sources: readonly EffectiveRoleSource[];
}

interface ResolveEffectiveRolesDeps {
  readonly organizations: {
    getUserOrgs(userId: string): Promise<readonly { id: string; name: string }[]>;
    listMembers(orgId: string): Promise<readonly { userId: string; role: string }[]>;
  };
  readonly teams: {
    listTeamMembershipsForUser(
      userId: string,
    ): Promise<readonly { teamId: string; role: string }[]>;
    getTeam(teamId: string): Promise<{ id: string; orgId: string; roleId: string | null } | null>;
  };
  readonly teamOrgLinks: {
    listLinksForTeam(
      teamId: string,
    ): Promise<readonly { teamId: string; orgId: string }[]>;
  };
  readonly roles: {
    getRole(roleId: string): Promise<{ id: string; name: string } | null>;
  };
}

/**
 * Compute the effective role each org grants this user. Aggregates via MAX
 * across:
 *  - the user's `org_members.role` for that org (the org-default),
 *  - every team they belong to whose scope covers that org (team's home org
 *    OR linked via team_org_links — Phase 62.1).
 *
 * Returns one entry per org the user has any role in; orgs the user has no
 * role at all in are omitted.
 */
export async function resolveEffectiveRoles(
  deps: ResolveEffectiveRolesDeps,
  userId: string,
): Promise<readonly EffectiveRoleForOrg[]> {
  const accum = new Map<string, { role: string; sources: EffectiveRoleSource[] }>();

  function record(orgId: string, role: string, source: EffectiveRoleSource): void {
    const existing = accum.get(orgId);
    if (existing === undefined) {
      accum.set(orgId, { role, sources: [source] });
      return;
    }
    existing.sources.push(source);
    if ((ROLE_RANK[role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
      existing.role = role;
    }
  }

  // 1. Org-level memberships.
  const orgs = await deps.organizations.getUserOrgs(userId);
  for (const org of orgs) {
    const members = await deps.organizations.listMembers(org.id);
    const me = members.find((m) => m.userId === userId);
    if (me !== undefined && me.role !== '') {
      record(org.id, me.role, { kind: 'org', role: me.role });
    }
  }

  // 2. Team memberships → fan out to home org + linked orgs.
  const memberships = await deps.teams.listTeamMembershipsForUser(userId);
  for (const m of memberships) {
    const team = await deps.teams.getTeam(m.teamId);
    if (team === null || team.roleId === null) continue;
    const role = await deps.roles.getRole(team.roleId);
    if (role === null) continue;
    const scopedOrgs = new Set<string>();
    scopedOrgs.add(team.orgId);
    const links = await deps.teamOrgLinks.listLinksForTeam(m.teamId);
    for (const l of links) scopedOrgs.add(l.orgId);
    for (const orgId of scopedOrgs) {
      record(orgId, role.name, { kind: 'team', teamId: m.teamId, role: role.name });
    }
  }

  return Array.from(accum.entries()).map(([orgId, v]) => ({
    orgId,
    role: v.role,
    sources: v.sources,
  }));
}

// ---------------------------------------------------------------------------
// Org-scoped role definitions (default roles created when an org is created)
// ---------------------------------------------------------------------------

/** Permissions for the org-level "Owner" role (all org permissions). */
export const ORG_OWNER_PERMISSIONS: readonly string[] = [
  'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
  'reports.export', 'reports.vpat', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
  'manual_testing', 'repos.manage', 'repos.credentials', 'trends.view',
  'admin.roles', 'admin.teams', 'admin.org', 'admin.plugins',
  'users.create', 'users.delete', 'users.activate', 'users.reset_password',
  'compliance.view', 'compliance.manage', 'audit.view',
  'branding.view', 'branding.manage',
  'llm.view', 'llm.manage',
];

/** Permissions for the org-level "Admin" role. */
export const ORG_ADMIN_PERMISSIONS: readonly string[] = [
  'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
  'reports.export', 'reports.vpat', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
  'manual_testing', 'repos.manage', 'repos.credentials', 'trends.view',
  'admin.plugins', 'users.create', 'users.delete', 'users.activate', 'users.reset_password',
  'compliance.view', 'compliance.manage',
  'branding.view', 'branding.manage',
  'llm.view', 'llm.manage',
];

/** Permissions for the org-level "Member" role. */
export const ORG_MEMBER_PERMISSIONS: readonly string[] = [
  'scans.create', 'reports.view', 'reports.view_technical', 'reports.export', 'reports.vpat',
  'reports.compare', 'manual_testing', 'repos.credentials', 'trends.view', 'compliance.view',
  'branding.view',
  'llm.view',
];

/**
 * Permissions for the org-level "Executive" role: a read + reports/VPAT/export
 * role. Can view reports, trends, compliance and branding, and generate &
 * export the VPAT/ACR (and its evidence pack), but cannot run scans, edit the
 * manual-testing record, or administer the org/users/teams.
 */
export const ORG_EXECUTIVE_PERMISSIONS: readonly string[] = [
  'reports.view', 'reports.view_technical', 'reports.export', 'reports.vpat', 'reports.compare',
  'trends.view', 'compliance.view', 'branding.view', 'llm.view',
];

/** Permissions for the org-level "Viewer" role. */
export const ORG_VIEWER_PERMISSIONS: readonly string[] = [
  'reports.view', 'trends.view', 'compliance.view',
  'branding.view',
  'llm.view',
];

/**
 * Default org role definitions, created automatically when an org is created.
 * Each entry defines a role name, description, and set of permissions.
 */
export const DEFAULT_ORG_ROLES: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
}> = [
  { name: 'Owner', description: 'Full organization owner with all permissions', permissions: ORG_OWNER_PERMISSIONS },
  { name: 'Admin', description: 'Manage teams, run scans, view reports, configure plugins', permissions: ORG_ADMIN_PERMISSIONS },
  { name: 'Member', description: 'Run scans and view reports', permissions: ORG_MEMBER_PERMISSIONS },
  { name: 'Executive', description: 'View reports and generate/export VPAT/ACR reports (no scans or administration)', permissions: ORG_EXECUTIVE_PERMISSIONS },
  { name: 'Viewer', description: 'View reports only', permissions: ORG_VIEWER_PERMISSIONS },
];
