/**
 * The Dismissed section's view model (Phase 89 Plan 05, FP-15, D-07, UD-06/07/16).
 *
 * Pure: repository rows in, the plain object report-detail.hbs renders out. Everything the
 * template would otherwise have to decide is decided here, once:
 *   - rows are split by status (the repository returns created_at DESC; order is kept);
 *   - no rows at all -> undefined, so the route spreads NO `dismissals` key and the zero-
 *     dismissal render stays byte-identical (UD-06);
 *   - an API-key actor (D-12 `api-key:<id>`, or the legacy bare `api-key`) is flagged so the
 *     template shows the translated "API key" label. 89-11 (D-15 Q1 reverses the UD-16 title
 *     clause): the stored identifier is never rendered; when the caller's key-label map (built
 *     from the SCAN org's own key rows only) knows the id, the row carries that label so the
 *     template can say "API key: <label>". The template never inspects the actor string itself.
 *
 * Dates are pre-formatted with toLocaleString() exactly like the page's own createdAtDisplay
 * (the UI-SPEC says "user's locale"; no page implements that, so the server locale is used for
 * consistency - recorded deviation) and the ISO value is carried for <time datetime>.
 *
 * Reason, comment and selector are returned verbatim; escaping is the template's job
 * (double-brace output only).
 */
import type { IssueDismissal } from '../../db/interfaces/issue-dismissal-repository.js';

const API_KEY_ACTOR = 'api-key';
const API_KEY_PREFIX = `${API_KEY_ACTOR}:`;

/** Key row id -> key label. Callers build it from ONE org's key rows (the scan's). */
export type ApiKeyLabels = ReadonlyMap<string, string>;

const NO_LABELS: ApiKeyLabels = new Map();

export interface DismissalViewRow {
  readonly id: string;
  readonly code: string;
  readonly selector: string;
  readonly reason: string;
  readonly actor: string;
  readonly actorIsApiKey: boolean;
  /** The key's label when the actor is an API key known to the label map; '' otherwise. */
  readonly actorKeyName: string;
  readonly createdAtIso: string;
  readonly createdAtDisplay: string;
  readonly revokedBy: string;
  readonly revokedByIsApiKey: boolean;
  readonly revokedByKeyName: string;
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

/** `api-key:<id>` (D-12) or the legacy bare `api-key`. */
export function isApiKeyActor(actor: string): boolean {
  return actor === API_KEY_ACTOR || actor.startsWith(API_KEY_PREFIX);
}

/** True when at least one row was dismissed or revoked by an API key (the route's lookup gate). */
export function hasApiKeyActor(rows: readonly IssueDismissal[]): boolean {
  return rows.some((r) => isApiKeyActor(r.createdBy) || (r.revokedBy !== null && isApiKeyActor(r.revokedBy)));
}

/** The label of `api-key:<id>` when the map knows the id; '' for anything else. */
function keyNameOf(actor: string, labels: ApiKeyLabels): string {
  if (!actor.startsWith(API_KEY_PREFIX)) return '';
  return labels.get(actor.slice(API_KEY_PREFIX.length)) ?? '';
}

function display(iso: string | null): string {
  return iso === null ? '' : new Date(iso).toLocaleString();
}

function toViewRow(row: IssueDismissal, labels: ApiKeyLabels): DismissalViewRow {
  const revokedBy = row.revokedBy ?? '';
  return {
    id: row.id,
    code: row.code,
    selector: row.selector,
    reason: row.reason,
    actor: row.createdBy,
    actorIsApiKey: isApiKeyActor(row.createdBy),
    actorKeyName: keyNameOf(row.createdBy, labels),
    createdAtIso: row.createdAt,
    createdAtDisplay: display(row.createdAt),
    revokedBy,
    revokedByIsApiKey: isApiKeyActor(revokedBy),
    revokedByKeyName: keyNameOf(revokedBy, labels),
    revokedAtIso: row.revokedAt ?? '',
    revokedAtDisplay: display(row.revokedAt),
    revokeComment: row.revokeComment ?? '',
  };
}

/** Undefined when the site has no dismissal row at all (UD-06). */
export function buildDismissalsView(
  rows: readonly IssueDismissal[],
  keyLabels: ApiKeyLabels = NO_LABELS,
): DismissalsView | undefined {
  if (rows.length === 0) return undefined;
  const active = rows.filter((r) => r.status === 'active').map((r) => toViewRow(r, keyLabels));
  const revoked = rows.filter((r) => r.status === 'revoked').map((r) => toViewRow(r, keyLabels));
  return { activeCount: active.length, revokedCount: revoked.length, active, revoked };
}
