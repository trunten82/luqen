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
  { id: 'issues.dismiss', label: 'Mark findings as false positives', group: 'Issues' },
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

/**
 * DARK permissions (Phase 87, D-07, FP-17): ids that exist in the catalogue —
 * so a global admin (role 'admin' resolves ALL_PERMISSION_IDS) holds them — but
 * that NO other path may yield yet:
 *   1. no DEFAULT_ORG_ROLES entry / ORG_* set contains them (pinned by test);
 *   2. custom roles cannot carry them (routes/admin/roles.ts parsePermissions
 *      filters with isRoleGrantablePermission), and resolveEffectivePermissions
 *      strips them from every non-global-admin result;
 *   3. org-scoped admin API keys are capped at ORG_OWNER_PERMISSIONS (PR #102),
 *      so keeping that set dark-free keeps those keys dark-free;
 *   4. /login refuses org-scoped keys (PR #100).
 *
 * Phase 89 (FP-18, D-16) emptied this set on 2026-10-12: issues.dismiss joined
 * ORG_OWNER_PERMISSIONS and ORG_ADMIN_PERMISSIONS only, migration 091 seeded
 * existing orgs' Owner and Admin roles, custom org roles may carry it (D-15
 * Q3 = A), and org-scoped admin API keys hold it through the ORG_OWNER cap
 * (D-15 Q4 = accept). The mechanism stays for the next dark permission: add its
 * id here. With the set empty the filters below have nothing to filter, so each
 * of them takes an injectable dark set (defaulting to this one) and
 * tests/permissions/dark-permissions.test.ts pins every path through an
 * injected id.
 */
export const DARK_PERMISSIONS: ReadonlySet<PermissionId> = new Set<PermissionId>();

/** A new Set of `ids` without any dark permission. Never mutates its argument. */
export function withoutDarkPermissions(
  ids: Iterable<string>,
  dark: ReadonlySet<string> = DARK_PERMISSIONS,
): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!dark.has(id)) out.add(id);
  }
  return out;
}

/**
 * Quick 261013-dr7 (CR-01): the GLOBAL role vocabulary - every value dashboard_users.role may hold
 * (the REST/setup user-create allow-list). A user's global role resolves from org 'system' only;
 * no org role may take one of these names (nor the name of any other role in org 'system').
 * Matching is case-SENSITIVE on purpose: dashboard_users.role is compared BINARY, so the default
 * org roles 'Admin' and 'Executive' that every org has can never shadow 'admin' / 'executive'.
 * 'viewer' has no role row at all (its holders get their permissions from teams), so it is listed
 * here explicitly: an org role named 'viewer' was the shape that would have reached all of them.
 */
export const GLOBAL_ROLE_NAMES: readonly string[] = ['viewer', 'user', 'developer', 'admin', 'executive'];

/** Is `name` reserved for a global role? `systemRoleNames` = names of the roles in org 'system'. */
export function isReservedGlobalRoleName(name: string, systemRoleNames: Iterable<string> = []): boolean {
  if (GLOBAL_ROLE_NAMES.includes(name)) return true;
  for (const n of systemRoleNames) if (n === name) return true;
  return false;
}

/**
 * Global-only permissions: no ORG-scoped source may carry or confer them. admin.system (system
 * settings, across every organization) and admin.users (the platform's user accounts) are held
 * through a user's GLOBAL role only. Organization role writes refuse them, the organization role
 * form does not offer them, the repository's team-role loop drops them from team-derived grants, and
 * resolveEffectivePermissions removes them from every non-admin result, so a row written by any path
 * confers neither. users.* stays grantable to organization roles (migration 031).
 */
export const ORG_ROLE_FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set(['admin.system', 'admin.users']);

/** The forbidden ids present in `ids`, in catalogue order (empty when the set is allowed on an org role). */
export function forbiddenOrgRolePermissions(ids: Iterable<string>): string[] {
  const present = new Set(ids);
  return ALL_PERMISSION_IDS.filter((id) => ORG_ROLE_FORBIDDEN_PERMISSIONS.has(id) && present.has(id));
}

/** The catalogue label of a permission id (the id itself when it is not in the catalogue). */
export function permissionLabel(id: string): string {
  return ALL_PERMISSIONS.find((p) => p.id === id)?.label ?? id;
}

/**
 * Permissions no GLOBAL (org 'system') role may carry. issues.dismiss is a per-org decision: a
 * global role is held by users of every org, so it reaches orgs that never chose to grant it.
 * Org roles may carry it (the org Owner and Admin sets do).
 */
export const GLOBAL_ROLE_FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set(['issues.dismiss']);

/** The forbidden ids present in `ids` (empty when the set is allowed on a global role). */
export function forbiddenGlobalRolePermissions(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter((id) => GLOBAL_ROLE_FORBIDDEN_PERMISSIONS.has(id));
}

/** May a role row carry this permission id? In the catalogue and not dark. */
export function isRoleGrantablePermission(id: string, dark: ReadonlySet<string> = DARK_PERMISSIONS): boolean {
  return ALL_PERMISSION_IDS.includes(id) && !dark.has(id);
}

/**
 * Permission groups for the management UI (dark ids are not listed; `forGlobalRole` also hides the
 * ids a global role may not carry, `forOrgRole` the ids an organization role may not carry).
 */
export function getPermissionGroups(
  opts: { readonly dark?: ReadonlySet<string>; readonly forGlobalRole?: boolean; readonly forOrgRole?: boolean } = {},
): Array<{
  readonly group: string;
  readonly permissions: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}> {
  const dark: ReadonlySet<string> = opts.dark ?? DARK_PERMISSIONS;
  const groupMap = new Map<string, Array<{ id: string; label: string }>>();
  for (const p of ALL_PERMISSIONS) {
    if (dark.has(p.id)) continue;
    if (opts.forGlobalRole === true && GLOBAL_ROLE_FORBIDDEN_PERMISSIONS.has(p.id)) continue;
    if (opts.forOrgRole === true && ORG_ROLE_FORBIDDEN_PERMISSIONS.has(p.id)) continue;
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

/** The id the auth layer gives every API key principal (see enforceApiKeyRole). */
const API_KEY_USER_ID = 'api-key';

/**
 * Permissions an API key resolves to for the non-admin key roles. `reports.view_technical` keeps
 * element selectors and markup in the REST and GraphQL responses for these keys, as before the
 * technical-details rule; the key role guard (enforceApiKeyRole) still limits what a key may call.
 * Admin keys resolve through the admin branches above.
 */
const API_KEY_ROLE_PERMISSIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  'read-only': new Set(['reports.view_technical']),
  'scan-only': new Set(['reports.view_technical']),
};

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
  opts: { readonly orgScopedApiKey?: boolean; readonly darkPermissions?: ReadonlySet<string> } = {},
): Promise<Set<string>> {
  // ORG-KEY-CONTAINMENT-1: an org-scoped key with role 'admin' administers ITS
  // org, so it holds at most what an org Owner holds — never the global
  // permissions (admin.system, ...).
  if (userRole === 'admin' && opts.orgScopedApiKey === true) {
    return withoutDarkPermissions(ORG_OWNER_PERMISSIONS, opts.darkPermissions);
  }
  // Admin users get all permissions regardless of org context
  if (userRole === 'admin') {
    return new Set(ALL_PERMISSION_IDS);
  }

  // An API key is not a stored user, so no role row resolves for it. The read-only and scan-only
  // roles hold exactly the permissions pinned in API_KEY_ROLE_PERMISSIONS (API contract decision:
  // they keep element selectors and markup, as before; only user sessions without the permission
  // are stripped).
  if (userId === API_KEY_USER_ID) {
    const keyPermissions = API_KEY_ROLE_PERMISSIONS[userRole];
    if (keyPermissions !== undefined) return withoutDarkPermissions(keyPermissions, opts.darkPermissions);
  }

  // D-07: dark ids are filtered where permissions are RESOLVED, not only where
  // a role form is parsed, so a role row written by any other path stays dark.
  const resolved = withoutDarkPermissions(await roleRepository.getEffectivePermissions(userId, orgId), opts.darkPermissions);
  // The global-only ids (admin.system, admin.users) come from the stored global 'admin' role only:
  // for every other role value the result never carries them, whichever role row or storage adapter
  // produced it. Every caller passes the stored role (the stored user's, or the API key's), so a
  // global admin always arrives here as 'admin'.
  return withoutGlobalOnlyPermissions(resolved);
}

/** A new Set of `ids` without ORG_ROLE_FORBIDDEN_PERMISSIONS (the global-only ids). Never mutates its argument. */
function withoutGlobalOnlyPermissions(ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!ORG_ROLE_FORBIDDEN_PERMISSIONS.has(id)) out.add(id);
  }
  return out;
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
  'issues.dismiss',
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
  'issues.dismiss',
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

/**
 * ORG-KEY-CONTAINMENT-1: may this caller bypass org isolation (read any org's
 * scan)? Only a GLOBAL admin may — role 'admin' alone is not enough, because an
 * org-scoped admin API key also carries role 'admin'.
 */
export function bypassesOrgScope(
  user: { readonly role?: string; readonly orgScopedApiKey?: boolean } | undefined,
): boolean {
  return user?.role === 'admin' && user.orgScopedApiKey !== true;
}
