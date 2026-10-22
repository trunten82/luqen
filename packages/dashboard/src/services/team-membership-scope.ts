/**
 * Who may be bound to a team. Team membership follows organization membership on every route that
 * adds a user to a team: the team page's Add Member (routes/admin/teams.ts), the organization
 * members page's "add to team" and "move team" (routes/admin/organizations.ts) and
 * POST /api/v1/teams/:teamId/members (routes/api/team-org-links.ts) all use this one rule.
 *
 * A caller who bypasses organization scope, or any caller on a `system` team, may bind every active
 * user. Anyone else may bind the active users of the team's organization: those in one of its teams,
 * and its direct members who are in no team at all. A teamless member who also belongs to another
 * organization is left out: binding a user to a team lets this organization manage that user
 * (canManageUser), so it is kept to the organization's own people; a global administrator adds that
 * person.
 */
import { bypassesOrgScope } from '../permissions.js';
import type { StorageAdapter } from '../db/index.js';

/** The refusal text every route sends when the user is outside the team's scope. */
export const TEAM_MEMBER_SCOPE_MESSAGE = 'This user cannot be added to this team';

export interface TeamScopeActor {
  readonly role?: string;
  readonly orgScopedApiKey?: boolean;
}

export type ScopedTeam = Pick<
  NonNullable<Awaited<ReturnType<StorageAdapter['teams']['getTeam']>>>,
  'orgId' | 'members'
>;
export type TeamScopeUser = Awaited<ReturnType<StorageAdapter['users']['listUsers']>>[number];

/** Every user the rule lets the actor bind to the team, current members included, each once. */
async function teamScopeUsers(
  storage: StorageAdapter,
  team: ScopedTeam,
  actor: TeamScopeActor | undefined,
): Promise<TeamScopeUser[]> {
  let candidates: TeamScopeUser[];
  if (bypassesOrgScope(actor) || team.orgId === 'system') {
    candidates = (await storage.users.listUsers()).filter((u) => u.active);
  } else {
    const teamed = (await storage.users.listUsersForOrg(team.orgId)).filter((u) => u.active);
    const teamedIds = new Set(teamed.map((u) => u.id));
    const teamless: TeamScopeUser[] = [];
    for (const direct of await storage.organizations.listMembers(team.orgId)) {
      if (teamedIds.has(direct.userId)) continue;
      const user = await storage.users.getUserById(direct.userId);
      if (user === null || !user.active) continue;
      if ((await storage.teams.listTeamMembershipsForUser(user.id)).length > 0) continue;
      const orgs = await storage.organizations.getUserOrgs(user.id);
      if (orgs.some((o) => o.id !== team.orgId)) continue;
      teamless.push(user);
    }
    candidates = [...teamed, ...teamless];
  }
  const seen = new Set<string>();
  return candidates.filter((u) => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });
}

/**
 * Who Add Member offers for the team: the users the rule allows, minus the team's current members,
 * ordered by user name. The team page lists exactly these users and its add-member request accepts
 * exactly these users.
 */
export async function addableTeamUsers(
  storage: StorageAdapter,
  team: ScopedTeam,
  actor: TeamScopeActor | undefined,
): Promise<TeamScopeUser[]> {
  const memberIds = new Set((team.members ?? []).map((m) => m.userId));
  return (await teamScopeUsers(storage, team, actor))
    .filter((u) => !memberIds.has(u.id))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * May the actor bind `userId` to the team? True exactly when the rule above allows that user,
 * whether or not the user is already a member (a route that re-binds or changes the role of a
 * current member decides that case itself). Every route that adds a user to a team calls this
 * before it writes anything.
 */
export async function mayBindUserToTeam(
  storage: StorageAdapter,
  team: ScopedTeam,
  actor: TeamScopeActor | undefined,
  userId: string,
): Promise<boolean> {
  if (userId === '') return false;
  return (await teamScopeUsers(storage, team, actor)).some((u) => u.id === userId);
}
