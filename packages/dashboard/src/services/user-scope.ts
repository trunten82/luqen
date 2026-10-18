/**
 * Org scoping for actions on dashboard users, and the last-active-admin rule.
 * Shared by the REST admin routes (routes/admin/dashboard-users.ts), the
 * GraphQL resolvers and the MCP user tools so every surface enforces one
 * predicate.
 */
import { bypassesOrgScope } from '../permissions.js';
import type { StorageAdapter } from '../db/index.js';

export interface UserScopeActor {
  readonly role?: string;
  readonly orgScopedApiKey?: boolean;
  readonly currentOrgId?: string;
}

/**
 * Can `actor` manage the target user? A global admin may manage anyone.
 * Anyone else (org owners/admins, org-scoped admin keys) may only manage users
 * who belong SOLELY to their current org: in at least one of its teams and in
 * no other org's team (product ruling RESTRICT, 2026-10-12: a user shared
 * with another org needs a global admin). Never unbound or global users, never
 * a global admin (even one who sits in one of their teams: that would let an
 * org owner reset an admin's password), and never anyone when their current
 * org is 'system'. A membership of a team that no longer exists counts for no
 * org.
 */
export async function canManageUser(
  storage: StorageAdapter,
  actor: UserScopeActor | undefined,
  targetUserId: string,
): Promise<boolean> {
  if (bypassesOrgScope(actor)) return true;
  const orgId = actor?.currentOrgId;
  if (!orgId || orgId === 'system') return false;
  const target = await storage.users.getUserById(targetUserId);
  if (target !== null && bypassesOrgScope(target)) return false;
  const memberships = await storage.teams.listTeamMembershipsForUser(targetUserId);
  let inActorOrg = false;
  for (const membership of memberships) {
    const team = await storage.teams.getTeam(membership.teamId);
    if (team === null) continue;
    if (team.orgId !== orgId) return false;
    inActorOrg = true;
  }
  return inActorOrg;
}

/**
 * Is `userId` the last active global admin? True when no OTHER user is both
 * active and role 'admin'. Demoting or deactivating that user is refused, so
 * the installation always keeps an active administrator.
 */
export async function isLastActiveAdmin(users: StorageAdapter, userId: string): Promise<boolean> {
  const userList = await users.users.listUsers();
  const activeAdmins = userList.filter(u => u.active && u.role === 'admin' && u.id !== userId);
  return activeAdmins.length === 0;
}
