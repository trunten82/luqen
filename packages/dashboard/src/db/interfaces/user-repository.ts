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
}
