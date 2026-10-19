/**
 * One stub for MCP test fixtures: the bearer token's subject is an active STORED user with the given
 * global role. The MCP endpoint answers every request for the stored user of the token, so a stub
 * storage that serves /api/v1/mcp needs `users.getUserById` for its token subject.
 */
import type { DashboardUser, Organization } from '../../src/db/types.js';

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

/**
 * `users` whose getUserById answers an active stored user with `role` for `subject`; every other id
 * goes to `users` itself (unchanged). Works for a plain stub object and for a repository instance.
 */
export function withStoredCaller<U extends object>(users: U, subject: string, role: string = 'user'): U {
  const stub = storedCallerUsers(role);
  return new Proxy(users, {
    get(target, prop) {
      if (prop === 'getUserById') {
        const own = Reflect.get(target, prop, target) as ((id: string) => Promise<unknown>) | undefined;
        return async (id: string): Promise<unknown> =>
          id === subject ? await stub.getUserById(id) : own === undefined ? null : await own.call(target, id);
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** `storage` with its `users` wrapped by withStoredCaller; nothing is written to the store. */
export function withStoredCallerStorage<S extends { readonly users: object }>(storage: S, subject: string, role: string = 'user'): S {
  const users = withStoredCaller(storage.users, subject, role);
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === 'users') return users;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export interface StoredCallerOrgsStub {
  getUserOrgs(userId: string): Promise<Organization[]>;
}

/**
 * `organizations.getUserOrgs` for a stub storage: every user belongs to exactly `orgIds`. The
 * stored-caller rule reads it for a non-admin user whose token names an organization.
 */
export function storedCallerOrgs(...orgIds: readonly string[]): StoredCallerOrgsStub {
  return {
    getUserOrgs: async (): Promise<Organization[]> =>
      orgIds.map((id) => ({ id, name: id, slug: id, createdAt: '2026-01-01T00:00:00.000Z' })),
  };
}
