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
  { id: 'reports.delete', label: 'Delete reports', group: 'Reports' },
  { id: 'reports.compare', label: 'Compare reports', group: 'Reports' },
  { id: 'issues.assign', label: 'Assign issues to team members', group: 'Issues' },
  { id: 'issues.fix', label: 'Propose and view fixes', group: 'Issues' },
  { id: 'manual_testing', label: 'Manual testing checklists', group: 'Testing' },
  { id: 'repos.manage', label: 'Connect repositories', group: 'Repositories' },
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
// Org-scoped role definitions (default roles created when an org is created)
// ---------------------------------------------------------------------------

/** Permissions for the org-level "Owner" role (all org permissions). */
export const ORG_OWNER_PERMISSIONS: readonly string[] = [
  'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
  'reports.export', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
  'manual_testing', 'repos.manage', 'trends.view',
  'admin.roles', 'admin.teams', 'admin.org', 'admin.plugins',
  'users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles',
  'compliance.view', 'compliance.manage', 'audit.view',
];

/** Permissions for the org-level "Admin" role. */
export const ORG_ADMIN_PERMISSIONS: readonly string[] = [
  'scans.create', 'scans.schedule', 'reports.view', 'reports.view_technical',
  'reports.export', 'reports.delete', 'reports.compare', 'issues.assign', 'issues.fix',
  'manual_testing', 'repos.manage', 'trends.view',
  'admin.plugins', 'users.create', 'users.delete', 'users.activate', 'users.reset_password',
  'compliance.view', 'compliance.manage',
];

/** Permissions for the org-level "Member" role. */
export const ORG_MEMBER_PERMISSIONS: readonly string[] = [
  'scans.create', 'reports.view', 'reports.view_technical', 'reports.export',
  'reports.compare', 'manual_testing', 'trends.view', 'compliance.view',
];

/** Permissions for the org-level "Viewer" role. */
export const ORG_VIEWER_PERMISSIONS: readonly string[] = [
  'reports.view', 'trends.view', 'compliance.view',
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
  { name: 'Viewer', description: 'View reports only', permissions: ORG_VIEWER_PERMISSIONS },
];
