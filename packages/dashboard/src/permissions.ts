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
  { id: 'admin.system', label: 'System settings', group: 'Administration' },
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
 * Default role definitions used to seed the database on first migration.
 */
export const DEFAULT_ROLES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly permissions: readonly string[];
}> = [
  {
    id: 'admin',
    name: 'admin',
    description: 'Full system administrator with all permissions',
    isSystem: true,
    permissions: ALL_PERMISSION_IDS,
  },
  {
    id: 'developer',
    name: 'developer',
    description: 'Developer with technical access and fix capabilities',
    isSystem: true,
    permissions: [
      'scans.create',
      'reports.view',
      'reports.view_technical',
      'reports.export',
      'reports.delete',
      'reports.compare',
      'issues.assign',
      'issues.fix',
      'manual_testing',
      'repos.manage',
      'trends.view',
    ],
  },
  {
    id: 'user',
    name: 'user',
    description: 'Standard user with scanning and reporting access',
    isSystem: true,
    permissions: [
      'scans.create',
      'scans.schedule',
      'reports.view',
      'reports.export',
      'reports.delete',
      'reports.compare',
      'issues.assign',
      'manual_testing',
      'trends.view',
    ],
  },
  {
    id: 'executive',
    name: 'executive',
    description: 'Executive with read-only access to reports and trends',
    isSystem: true,
    permissions: [
      'reports.view',
      'reports.export',
      'trends.view',
    ],
  },
];

/**
 * Helper to check permissions on a Fastify request.
 * The permissions Set is attached by the preHandler hook in server.ts.
 */
export function hasPermission(request: unknown, permission: string): boolean {
  const perms = (request as { permissions?: Set<string> }).permissions;
  return perms?.has(permission) === true;
}
