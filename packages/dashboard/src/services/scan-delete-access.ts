/**
 * Who may delete a scan: ONE rule for every path that deletes one.
 *
 * REST `DELETE /api/v1/scans/:id` (routes/api/data.ts), GraphQL `deleteScan` (graphql/resolvers.ts)
 * and the report page `DELETE /reports/:id` (routes/reports.ts) each load the scan, ask
 * {@link scanDeleteRefusal}, and map its answer to their own status and message. A test over src/
 * (tests/integration/scan-delete-paths.test.ts) keeps every scan delete call on this rule.
 *
 * The rule, in order:
 * 1. Organization: a global administrator may delete a scan of any organization. Everyone else may
 *    delete only a scan of their current organization; a caller outside every organization works in
 *    'system'. A 'system' scan is shown to every organization, so an organization user may not
 *    delete it.
 * 2. Permission: the caller holds {@link SCAN_DELETE_PERMISSION}, or is the signed-in user who
 *    started the scan. An API key is never the user who started a scan: every key signs in under
 *    the same user name.
 */
import { bypassesOrgScope } from '../permissions.js';

/** Permission that lets a caller delete any scan it may reach. */
export const SCAN_DELETE_PERMISSION = 'reports.delete';

/** Which clause of the rule refused: the scan's organization, or the caller's permission. */
export type ScanDeleteRefusal = 'org' | 'permission';

/** The signed-in principal, as the auth layer resolves it (session user or API key). */
export interface ScanDeleteUser {
  readonly id: string;
  readonly username: string;
  readonly role?: string;
  readonly currentOrgId?: string;
  readonly orgScopedApiKey?: boolean;
}

/** Who is asking: the principal and its resolved permission set. */
export interface ScanDeleteCaller {
  readonly user: ScanDeleteUser | undefined;
  readonly permissions: ReadonlySet<string>;
}

/** The fields of a scan the rule reads. */
export interface ScanDeleteTarget {
  readonly orgId: string;
  readonly createdBy?: string;
}

/** The user id every API key authenticates as (auth/auth-service.ts). */
const API_KEY_USER_ID = 'api-key';

/** May `caller` delete `scan`? `null` = yes; otherwise the clause that refused. */
export function scanDeleteRefusal(caller: ScanDeleteCaller, scan: ScanDeleteTarget): ScanDeleteRefusal | null {
  const { user, permissions } = caller;
  if (user === undefined) return 'org';
  if (!bypassesOrgScope(user) && scan.orgId !== (user.currentOrgId ?? 'system')) return 'org';
  if (permissions.has(SCAN_DELETE_PERMISSION)) return null;
  return startedTheScan(user, scan) ? null : 'permission';
}

/** Is `user` the signed-in dashboard user who started `scan`? Never true for an API key. */
function startedTheScan(user: ScanDeleteUser, scan: ScanDeleteTarget): boolean {
  if (user.id === API_KEY_USER_ID) return false;
  return user.username !== '' && scan.createdBy === user.username;
}
