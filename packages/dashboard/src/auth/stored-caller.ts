/**
 * The stored-caller rule: a bearer token names a user; every request is answered for that user's
 * STORED row, read on the request.
 *
 *   - no stored row               -> refused ('unknown_user')
 *   - stored row not active       -> refused ('inactive_user')
 *   - a stored role other than admin, and an organization other than none or 'system' that the
 *     user does not belong to (getUserOrgs: org_members plus the organizations of the user's
 *     teams, the predicate both org-switch routes use) -> refused ('not_member')
 *   - otherwise                   -> the stored global role, and the permissions
 *                                    resolveEffectivePermissions gives that role in `orgId`
 *
 * A role claim carried by a token is never read here: the stored role decides. A global admin is
 * served in every organization; a token without an organization answers from the global role.
 */
import { resolveEffectivePermissions } from '../permissions.js';

/** Why the stored row refuses the caller. */
export type StoredCallerRefusal = 'unknown_user' | 'inactive_user' | 'not_member';

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
  /** The organizations the user belongs to: org_members plus the organizations of the user's teams. */
  readonly organizations: {
    getUserOrgs(userId: string): Promise<ReadonlyArray<{ readonly id: string }>>;
  };
}

export async function resolveStoredCaller(
  storage: StoredCallerStorage,
  userId: string,
  orgId?: string,
): Promise<StoredCaller> {
  const user = await storage.users.getUserById(userId);
  if (user === null) return { ok: false, refusal: 'unknown_user' };
  if (user.active !== true) return { ok: false, refusal: 'inactive_user' };
  if (user.role !== 'admin' && orgId !== undefined && orgId !== '' && orgId !== 'system') {
    const orgs = await storage.organizations.getUserOrgs(userId);
    if (!orgs.some((org) => org.id === orgId)) return { ok: false, refusal: 'not_member' };
  }
  const permissions = await resolveEffectivePermissions(storage.roles, userId, user.role, orgId);
  return { ok: true, role: user.role, permissions };
}

/** Why the MCP rule refuses the caller: the stored-caller refusals, then the permission refusals. */
export type McpCallerRefusal = StoredCallerRefusal | 'no_permission' | 'no_mcp_use';

export type McpCaller =
  | { readonly ok: true; readonly role: string; readonly permissions: Set<string> }
  | { readonly ok: false; readonly refusal: McpCallerRefusal };

export async function resolveMcpCaller(
  storage: StoredCallerStorage,
  userId: string,
  orgId?: string,
): Promise<McpCaller> {
  const caller = await resolveStoredCaller(storage, userId, orgId);
  if (!caller.ok) return caller;
  if (caller.permissions.size === 0) return { ok: false, refusal: 'no_permission' };
  return caller;
}

/**
 * The permission set of the stored caller for in-process use (the agent bridge): the stored role's
 * permissions, or an EMPTY set when the stored-caller rule refuses the user.
 */
export async function storedPermissionsOrNone(
  storage: StoredCallerStorage,
  userId: string,
  orgId?: string,
): Promise<Set<string>> {
  const caller = await resolveStoredCaller(storage, userId, orgId);
  return caller.ok ? caller.permissions : new Set<string>();
}
