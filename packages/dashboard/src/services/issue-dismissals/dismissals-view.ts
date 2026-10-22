/**
 * The Dismissed section's view model (Phase 89 Plan 05, FP-15, D-07, UD-06/07/16).
 *
 * Pure: repository rows in, the plain object report-detail.hbs renders out. Everything the
 * template would otherwise have to decide is decided here, once:
 *   - rows are split by status (the repository returns created_at DESC; order is kept);
 *   - no rows at all -> undefined, so the route spreads NO `dismissals` key and the zero-
 *     dismissal render stays byte-identical (UD-06);
 *   - an API-key actor is flagged and, when it may be named, carries its label and creation time,
 *     so the template shows "API key: <label> (Created <time>)" or the generic "API key". The
 *     actor rules (decided from the server-set actor id, never the display string; a marking key
 *     named from its stored snapshot first; a revoking key from the live key map only; names only
 *     when the caller passes showKeyNames; the stored identifier never rendered) live in
 *     actor-label.ts, the ONE place that decides how an actor reads (Phase 95, ACT-01, D-06): the
 *     Excel export and the Audit Log use it too. The template never inspects the actor string.
 *
 * Dates (dismissed, revoked, and a named key's creation time) are pre-formatted with
 * toLocaleString(locale), where the route passes the viewer's session UI language (HARD-05); no
 * locale keeps the server default. The ISO value is carried for <time datetime>. The time zone is
 * the server's; the page's own scan dates are not part of this section.
 *
 * Reason, comment and selector are returned verbatim; escaping is the template's job
 * (double-brace output only).
 */
import type { IssueDismissal } from '../../db/interfaces/issue-dismissal-repository.js';
import { describeActor, isApiKeyActor, type ApiKeyInfo, type ScanOrgKeys } from './actor-label.js';

// Kept importable from here for the callers that already import them from this module.
export { hasApiKeyActor, isApiKeyActor } from './actor-label.js';
export type { ApiKeyInfo, ScanOrgKeys } from './actor-label.js';

export interface DismissalsViewOptions {
  /** The scan org's live key rows (revokers, and markers written before the snapshot existed). */
  readonly keys?: ScanOrgKeys;
  /** May this viewer read key names? The route passes mayTouchDismissalOrg. Default: no. */
  readonly showKeyNames?: boolean;
  /** The viewer's UI language for every date in the section (HARD-05); undefined = server default. */
  readonly locale?: string;
}

const NO_KEYS: ScanOrgKeys = new Map();

export interface DismissalViewRow {
  readonly id: string;
  readonly code: string;
  readonly selector: string;
  readonly reason: string;
  readonly actor: string;
  readonly actorIsApiKey: boolean;
  /** The marking key's label (snapshot first, then the live key map); '' when not named. */
  readonly actorKeyName: string;
  /** The marking key's creation time (ISO, for <time datetime>) and its display text; '' when not named. */
  readonly actorKeyCreatedIso: string;
  readonly actorKeyCreatedDisplay: string;
  readonly createdAtIso: string;
  readonly createdAtDisplay: string;
  readonly revokedBy: string;
  readonly revokedByIsApiKey: boolean;
  readonly revokedByKeyName: string;
  readonly revokedByKeyCreatedIso: string;
  readonly revokedByKeyCreatedDisplay: string;
  readonly revokedAtIso: string;
  readonly revokedAtDisplay: string;
  readonly revokeComment: string;
}

export interface DismissalsView {
  readonly activeCount: number;
  readonly revokedCount: number;
  readonly active: readonly DismissalViewRow[];
  readonly revoked: readonly DismissalViewRow[];
}

function display(iso: string | null, locale: string | undefined): string {
  return iso === null ? '' : new Date(iso).toLocaleString(locale);
}

interface Ctx {
  readonly keys: ScanOrgKeys;
  readonly showKeyNames: boolean;
  readonly locale: string | undefined;
}

const UNNAMED = { name: '', createdIso: '', createdDisplay: '' } as const;

function named(
  key: ApiKeyInfo | null | undefined,
  locale: string | undefined,
): { name: string; createdIso: string; createdDisplay: string } {
  if (key === null || key === undefined) return UNNAMED;
  return { name: key.label, createdIso: key.createdAt, createdDisplay: display(key.createdAt, locale) };
}

function toViewRow(row: IssueDismissal, ctx: Ctx): DismissalViewRow {
  const revokedBy = row.revokedBy ?? '';
  const markerActor = describeActor({
    actor: row.createdBy,
    actorId: row.createdById,
    snapshot: row.createdByKeySnapshot ?? null,
    keys: ctx.keys,
    showKeyNames: ctx.showKeyNames,
  });
  const marker = named(markerActor.kind === 'apiKey' ? markerActor.key : null, ctx.locale);
  const revokerActor =
    row.revokedBy === null
      ? null
      : describeActor({ actor: row.revokedBy, actorId: row.revokedById, keys: ctx.keys, showKeyNames: ctx.showKeyNames });
  const revoker = named(revokerActor !== null && revokerActor.kind === 'apiKey' ? revokerActor.key : null, ctx.locale);
  return {
    id: row.id,
    code: row.code,
    selector: row.selector,
    reason: row.reason,
    actor: row.createdBy,
    actorIsApiKey: isApiKeyActor(row.createdBy, row.createdById),
    actorKeyName: marker.name,
    actorKeyCreatedIso: marker.createdIso,
    actorKeyCreatedDisplay: marker.createdDisplay,
    createdAtIso: row.createdAt,
    createdAtDisplay: display(row.createdAt, ctx.locale),
    revokedBy,
    revokedByIsApiKey: revokedBy !== '' && isApiKeyActor(revokedBy, row.revokedById),
    revokedByKeyName: revoker.name,
    revokedByKeyCreatedIso: revoker.createdIso,
    revokedByKeyCreatedDisplay: revoker.createdDisplay,
    revokedAtIso: row.revokedAt ?? '',
    revokedAtDisplay: display(row.revokedAt, ctx.locale),
    revokeComment: row.revokeComment ?? '',
  };
}

/** Undefined when the site has no dismissal row at all (UD-06). */
export function buildDismissalsView(
  rows: readonly IssueDismissal[],
  options: DismissalsViewOptions = {},
): DismissalsView | undefined {
  if (rows.length === 0) return undefined;
  const ctx: Ctx = {
    keys: options.keys ?? NO_KEYS,
    showKeyNames: options.showKeyNames === true,
    locale: options.locale,
  };
  const active = rows.filter((r) => r.status === 'active').map((r) => toViewRow(r, ctx));
  const revoked = rows.filter((r) => r.status === 'revoked').map((r) => toViewRow(r, ctx));
  return { activeCount: active.length, revokedCount: revoked.length, active, revoked };
}
