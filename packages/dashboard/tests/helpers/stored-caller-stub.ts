/**
 * One stub for MCP test fixtures: the bearer token's subject is an active STORED user with the given
 * global role. The MCP endpoint answers every request for the stored user of the token, so a stub
 * storage that serves /api/v1/mcp needs `users.getUserById` for its token subject.
 */
import type { DashboardUser } from '../../src/db/types.js';

export interface StoredCallerUsersStub {
  getUserById(id: string): Promise<DashboardUser | null>;
}

/** An active stored user for ANY id, with `role` as its stored global role. */
export function storedCallerUsers(role: string = 'user'): StoredCallerUsersStub {
  return {
    getUserById: async (id: string): Promise<DashboardUser | null> => ({
      id,
      username: id,
      role: role as DashboardUser['role'],
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      activeOrgId: null,
    }),
  };
}
