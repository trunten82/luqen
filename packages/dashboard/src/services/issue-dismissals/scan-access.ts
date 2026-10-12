/**
 * The ONE scan-access predicate of the issue-dismissal feature (Phase 87 D-10, Phase 89 D-04).
 *
 * Mark, revoke, list and preview all gate on this function, and the report page reuses it
 * for the Dismissed section and the mark controls. A second copy is how a second path
 * ends up allowing what the first refuses.
 *
 * It differs from the shared guard (`!bypassesOrgScope && orgId !== scan.orgId && scan.orgId
 * !== 'system'`) in ONE deliberate way: org users get no 'system'-org exception. A dismissal
 * on a 'system' scan would be stored under org 'system', which is a write into another tenant,
 * and a preview of one would read it. The global-admin half is the shared `bypassesOrgScope`
 * (PR #102) — never an org-scoped key.
 */
import { bypassesOrgScope } from '../../permissions.js';
import type { AuthUser } from '../../auth/middleware.js';

/** May this caller touch dismissal data that belongs to `orgId`? */
export function mayTouchDismissalOrg(user: AuthUser | undefined, orgId: string): boolean {
  if (bypassesOrgScope(user)) return true;
  const current = user?.currentOrgId ?? '';
  return current !== '' && current === orgId;
}
