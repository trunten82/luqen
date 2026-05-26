import type { Team, TeamMember } from '../types.js';

export interface TeamRepository {
  listTeams(orgId?: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  getTeamByName(name: string, orgId?: string): Promise<Team | null>;
  createTeam(data: { readonly name: string; readonly description: string; readonly orgId: string; readonly roleId?: string }): Promise<Team>;
  updateTeam(id: string, data: { readonly name?: string; readonly description?: string; readonly orgId?: string; readonly roleId?: string | null }): Promise<void>;
  /** List all teams linked to a specific organization */
  listTeamsByOrgId(orgId: string): Promise<Team[]>;
  deleteTeam(id: string): Promise<void>;
  addTeamMember(teamId: string, userId: string, role?: string): Promise<void>;
  /**
   * Upsert: insert (teamId, userId) at the given role, or update an existing
   * row's role to `role`. Used by the per-team role overlay (Phase 62.1)
   * where the same user can transition between roles inside a team without
   * being removed first. `addTeamMember` is INSERT-OR-IGNORE and won't move
   * a stale role; new callers should prefer `setTeamMemberRole`.
   */
  setTeamMemberRole(teamId: string, userId: string, role: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  listTeamMembers(teamId: string): Promise<TeamMember[]>;
  /**
   * All team memberships for a user across all teams. Powers
   * `resolveEffectiveRoles()` (Phase 62.1) — returns the raw rows so the
   * resolver can join them against team_org_links + teams.org_id to compute
   * effective roles per org.
   */
  listTeamMembershipsForUser(userId: string): Promise<readonly { teamId: string; role: string }[]>;
}
