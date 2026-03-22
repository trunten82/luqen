import type { Role } from '../types.js';

export interface RoleRepository {
  listRoles(orgId?: string): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  getRoleByName(name: string): Promise<Role | null>;
  getRolePermissions(roleId: string): Promise<string[]>;
  createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Promise<Role>;
  updateRole(id: string, data: {
    readonly name?: string;
    readonly description?: string;
    readonly permissions?: readonly string[];
  }): Promise<void>;
  deleteRole(id: string): Promise<void>;
  getUserPermissions(userId: string): Promise<Set<string>>;
}
