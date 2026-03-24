import type { Team, TeamMember } from '../types.js';

export interface TeamRepository {
  listTeams(orgId?: string): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  getTeamByName(name: string, orgId?: string): Promise<Team | null>;
  createTeam(data: { readonly name: string; readonly description: string; readonly orgId: string }): Promise<Team>;
  updateTeam(id: string, data: { readonly name?: string; readonly description?: string; readonly orgId?: string }): Promise<void>;
  /** List all teams linked to a specific organization */
  listTeamsByOrgId(orgId: string): Promise<Team[]>;
  deleteTeam(id: string): Promise<void>;
  addTeamMember(teamId: string, userId: string, role?: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): Promise<void>;
  listTeamMembers(teamId: string): Promise<TeamMember[]>;
}
