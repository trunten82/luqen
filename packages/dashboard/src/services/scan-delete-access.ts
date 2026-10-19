/**
 * Who may delete a scan: ONE rule for every path that deletes one.
 *
 * REST `DELETE /api/v1/scans/:id` (routes/api/data.ts), GraphQL `deleteScan` (graphql/resolvers.ts)
 * and the report page `DELETE /reports/:id` (routes/reports.ts) each load the scan, ask
 * {@link scanDeleteRefusal}, map its answer to their own status and message, and then delete through
 * {@link deleteScanAndFiles}, the one place that removes a scan row: it removes the scan's stored
 * report file as well, and only from the configured reports directory. A test over src/
 * (tests/integration/scan-delete-paths.test.ts) keeps every scan delete call on this rule and this
 * function.
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
import { lstat, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
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

/** The storage a scan delete writes to: the scan row. */
export interface ScanDeleteStorage {
  readonly scans: { deleteScan(id: string): Promise<void> };
}

/** Where a scan delete may remove files, and where it reports a file it did not remove. */
export interface ScanFileDeleteOptions {
  /**
   * The configured reports directory. A stored report file is removed only when its path resolves
   * inside this directory; without one, no file is removed and the scan is kept.
   */
  readonly reportsDir: string | undefined;
  /** Receives one warning per scan kept because of its report file: the scan id and why, never the path. */
  readonly log: { warn(fields: Record<string, unknown>, message: string): void };
}

/** The message a caller sees when a scan is kept because its report file was not removed. */
export const SCAN_NOT_DELETED_MESSAGE = 'The scan could not be deleted';

/** Thrown when a scan is kept because its stored report file was not removed. Carries no path. */
export class ScanNotDeletedError extends Error {
  constructor() {
    super(SCAN_NOT_DELETED_MESSAGE);
    this.name = 'ScanNotDeletedError';
  }
}

/** Does `path` resolve inside `dir` (not `dir` itself, and not a sibling whose name starts with it)? */
function isInside(path: string, dir: string): boolean {
  const root = resolve(dir);
  return resolve(path).startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Is nothing at `path`? Only "no such file" answers yes; any other failure to look counts as present. */
async function nothingAt(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

/**
 * Remove the stored report file at `path`, or say why it stays: `null` when the delete may go on
 * (removed, already gone, or nothing at an outside path), otherwise the warning fields (never the path).
 */
async function removeReportFile(path: string, reportsDir: string | undefined): Promise<Record<string, string> | null> {
  if (reportsDir === undefined || !isInside(path, reportsDir)) {
    return (await nothingAt(path)) ? null : { reason: 'outside-reports-dir' };
  }
  try {
    await unlink(path);
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' ? null : { code: code ?? 'unknown' };
  }
}

/**
 * Delete `scan` once the rule has admitted the caller: its stored report file first, then its row.
 *
 * A file that is already gone does not stop the delete. A stored path outside the reports directory
 * is never removed: when nothing exists there the row is deleted (a row copied from another install
 * keeps its old path), otherwise the row is kept. A file inside the directory that cannot be removed
 * is left in place and the row is kept. Whenever the row is kept, one warning is written and
 * {@link ScanNotDeletedError} is thrown, which every delete path answers as a server error, so the
 * delete can be retried once the file is dealt with. File first, then row: if the row delete fails
 * after the file is gone, a retry finds the file already removed and deletes the row.
 */
export async function deleteScanAndFiles(
  storage: ScanDeleteStorage,
  scan: { readonly id: string; readonly jsonReportPath?: string },
  options: ScanFileDeleteOptions,
): Promise<void> {
  const path = scan.jsonReportPath;
  if (path !== undefined && path !== '') {
    const kept = await removeReportFile(path, options.reportsDir);
    if (kept !== null) {
      options.log.warn({ scanId: scan.id, ...kept }, 'scan kept: its stored report file was not removed');
      throw new ScanNotDeletedError();
    }
  }
  await storage.scans.deleteScan(scan.id);
}
