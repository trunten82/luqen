/**
 * The Actor label of audit rows, for every surface that reads them: the Audit Log page
 * (routes/admin/audit.ts) and the GraphQL `auditLog` query (graphql/resolvers.ts). Both go through
 * the shared actor label (actor-label.ts), so an API key reads the same on each and the stored
 * `api-key:<row id>` reaches neither.
 */
import type { StorageAdapter } from '../../db/index.js';
import type { AuditEntry } from '../../db/types.js';
import type { AuthUser } from '../../auth/middleware.js';
import { ISSUE_DISMISSAL_AUDIT_ACTIONS, type DismissalKeySnapshot } from '../../db/interfaces/issue-dismissal-repository.js';
import type { Locale } from '../../i18n/index.js';
import {
  actorLabelText,
  describeActor,
  isApiKeyActor,
  orgKeyMap,
  type ActorLabelLog,
  type ScanOrgKeys,
} from './actor-label.js';
import { mayTouchDismissalOrg } from './scan-access.js';

/** An audit row as the page prints it: the entry plus the Actor label (ACT-02). */
export type DisplayedAuditEntry = AuditEntry & { readonly actorLabel: string };

/**
 * The marking key's stored snapshot, only when this audit row is the mark row of that very dismissal:
 * same organization and same server-set actor id. A failed read leaves the snapshot out (the error
 * NAME only is logged; driver messages can quote input) and never fails the page.
 */
async function snapshotFor(
  storage: StorageAdapter,
  entry: AuditEntry,
  log: ActorLabelLog,
): Promise<DismissalKeySnapshot | null> {
  if (entry.action !== ISSUE_DISMISSAL_AUDIT_ACTIONS.mark || entry.resourceId === null) return null;
  try {
    const dismissal = await storage.issueDismissals?.getById(entry.resourceId);
    if (dismissal === undefined || dismissal === null) return null;
    if (dismissal.orgId !== entry.orgId || dismissal.createdById !== entry.actorId) return null;
    return dismissal.createdByKeySnapshot ?? null;
  } catch (err) {
    log.warn({ errorName: err instanceof Error ? err.name : 'UnknownError' }, 'Audit Log: dismissal snapshot not readable, generic key label shown');
    return null;
  }
}

/**
 * New display rows (the query result is never mutated). The Actor label comes from the shared actor
 * label, so an API key reads as it does on the report page and in the Excel export and the stored
 * `api-key:<row id>` never reaches the page. Key names are read only for organizations the viewer may
 * touch, from that organization's own key rows.
 */
export async function withActorLabels(
  storage: StorageAdapter,
  user: AuthUser | undefined,
  entries: readonly AuditEntry[],
  locale: Locale,
  log: ActorLabelLog,
): Promise<readonly DisplayedAuditEntry[]> {
  const keyActorOrgs = new Set(
    entries.filter((e) => isApiKeyActor(e.actor, e.actorId) && e.orgId !== null).map((e) => e.orgId as string),
  );
  const keysByOrg = new Map<string, ScanOrgKeys>();
  for (const orgId of keyActorOrgs) {
    if (mayTouchDismissalOrg(user, orgId)) keysByOrg.set(orgId, await orgKeyMap(storage, orgId, log, '-'));
  }
  const rows: DisplayedAuditEntry[] = [];
  for (const entry of entries) {
    const keyActor = isApiKeyActor(entry.actor, entry.actorId);
    const orgKeys = entry.orgId === null ? undefined : keysByOrg.get(entry.orgId);
    const snapshot = keyActor && orgKeys !== undefined ? await snapshotFor(storage, entry, log) : null;
    const description = describeActor({
      actor: entry.actor,
      actorId: entry.actorId,
      snapshot,
      keys: orgKeys ?? new Map(),
      showKeyNames: orgKeys !== undefined,
    });
    rows.push({ ...entry, actorLabel: actorLabelText(description, locale) });
  }
  return rows;
}
