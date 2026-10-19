/**
 * The ONE scan-access predicate of the issue-dismissal feature (Phase 87 D-10, Phase 89 D-04).
 *
 * Mark, revoke and preview (the write side) gate on `mayTouchDismissalOrg`, and the report page
 * reuses it for the mark controls and for the key labels in the Dismissed section. The READ side
 * (the report page's Dismissed section and the list API) gates on `mayViewScanReport`. A second
 * copy of either is how a second path ends up allowing what the first refuses.
 *
 * It differs from the shared guard (`!bypassesOrgScope && orgId !== scan.orgId && scan.orgId
 * !== 'system'`) in ONE deliberate way: org users get no 'system'-org exception. A dismissal
 * on a 'system' scan would be stored under org 'system', which is a write into another tenant,
 * and a preview of one would read it. The global-admin half is the shared `bypassesOrgScope`
 * (PR #102) — never an org-scoped key.
 */
import { bypassesOrgScope } from '../../permissions.js';
import type { AuthUser } from '../../auth/middleware.js';

/**
 * May this caller OPEN a report whose scan belongs to `scanOrgId`? The report page's shared guard,
 * as one function: a global admin, the scan's own org, or a 'system' scan for anyone signed in.
 *
 * Quick 261013-dr7 (CR-02, owner ruling SC2 option B): the READ-ONLY dismissal disclosure on the
 * report page (the Dismissed section) follows this predicate, because dismissals are applied for
 * every viewer it admits; the write-side `mayTouchDismissalOrg` below stays for mark/revoke only.
 */
export function mayViewScanReport(user: AuthUser | undefined, scanOrgId: string): boolean {
  // Unreachable behind requirePermission, but fail closed: no caller, no report.
  if (user === undefined) return false;
  if (bypassesOrgScope(user)) return true;
  return scanOrgId === (user?.currentOrgId ?? 'system') || scanOrgId === 'system';
}

/** May this caller touch dismissal data that belongs to `orgId`? */
export function mayTouchDismissalOrg(user: AuthUser | undefined, orgId: string): boolean {
  if (bypassesOrgScope(user)) return true;
  const current = user?.currentOrgId ?? '';
  return current !== '' && current === orgId;
}
