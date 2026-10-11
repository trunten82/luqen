/**
 * Org scoping for actions on dashboard users. Shared by the REST admin routes
 * (routes/admin/dashboard-users.ts) and the GraphQL resolvers so both enforce
 * one predicate.
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
 * who are members of a team belonging to their current org — never unbound
 * or global users, never a global admin (even one who sits in one of their
 * teams: that would let an org owner reset an admin's password), and never
 * anyone when their current org is 'system'.
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
  const orgTeams = await storage.teams.listTeamsByOrgId(orgId);
  for (const team of orgTeams) {
    const detail = await storage.teams.getTeam(team.id);
    if (detail?.members?.some((m) => m.userId === targetUserId)) return true;
  }
  return false;
}
