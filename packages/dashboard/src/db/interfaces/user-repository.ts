import type { DashboardUser } from '../types.js';

export interface UserRepository {
  createUser(username: string, password: string, role: string): Promise<DashboardUser>;
  getUserByUsername(username: string): Promise<DashboardUser | null>;
  getUserById(id: string): Promise<DashboardUser | null>;
  verifyPassword(username: string, password: string): Promise<boolean>;
  listUsers(): Promise<DashboardUser[]>;
  listUsersForOrg(orgId: string): Promise<DashboardUser[]>;
  updateUserRole(id: string, role: string): Promise<void>;
  deactivateUser(id: string): Promise<void>;
  activateUser(id: string): Promise<void>;
  updatePassword(id: string, newPassword: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
  countUsers(): Promise<number>;
  /**
   * Phase 38 Plan 01 (AORG-03). Set or clear the user's active org id.
   * Pass `null` to clear. Returns `true` if a row was updated, `false` if
   * the user does not exist. Repo does not validate org existence or
   * caller permissions — that is the route's job (admin.system gate +
   * org-membership check live in routes/agent.ts per Plan 38-03).
   */
  setActiveOrgId(userId: string, orgId: string | null): Promise<boolean>;
}
