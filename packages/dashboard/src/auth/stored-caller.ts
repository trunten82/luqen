/**
 * The stored-caller rule: a bearer token names a user; every request is answered for that user's
 * STORED row, read on the request.
 */
import { resolveEffectivePermissions } from '../permissions.js';

/** Why the stored row refuses the caller. */
export type StoredCallerRefusal = 'unknown_user' | 'inactive_user';

export type StoredCaller =
  | { readonly ok: true; readonly role: string; readonly permissions: Set<string> }
  | { readonly ok: false; readonly refusal: StoredCallerRefusal };

/** The storage the rule reads: the user row and the role repository. */
export interface StoredCallerStorage {
  readonly users: {
    getUserById(id: string): Promise<{ readonly role: string; readonly active: boolean } | null>;
  };
  readonly roles: {
    getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>>;
  };
}

export async function resolveStoredCaller(
  storage: StoredCallerStorage,
  userId: string,
  orgId?: string,
): Promise<StoredCaller> {
  // Placeholder body; the rule lands with the endpoint change.
  const permissions = await resolveEffectivePermissions(storage.roles, userId, 'member', orgId);
  return { ok: true, role: 'member', permissions };
}
