/**
 * The Dismissed section's view model (Phase 89 Plan 05, FP-15, D-07, UD-06/07/16).
 *
 * Pure: repository rows in, the plain object report-detail.hbs renders out. Everything the
 * template would otherwise have to decide is decided here, once:
 *   - rows are split by status (the repository returns created_at DESC; order is kept);
 *   - no rows at all -> undefined, so the route spreads NO `dismissals` key and the zero-
 *     dismissal render stays byte-identical (UD-06);
 *   - an API-key actor (D-12 `api-key:<id>`, or the legacy bare `api-key`) is flagged so the
 *     template shows the translated "API key" label with the full stored value in `title`
 *     (UD-16). The template never inspects the actor string itself.
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

export interface DismissalViewRow {
  readonly id: string;
  readonly code: string;
  readonly selector: string;
  readonly reason: string;
  readonly actor: string;
  readonly actorIsApiKey: boolean;
  readonly createdAtIso: string;
  readonly createdAtDisplay: string;
  readonly revokedBy: string;
  readonly revokedByIsApiKey: boolean;
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
  return actor === API_KEY_ACTOR || actor.startsWith(`${API_KEY_ACTOR}:`);
}

function display(iso: string | null): string {
  return iso === null ? '' : new Date(iso).toLocaleString();
}

function toViewRow(row: IssueDismissal): DismissalViewRow {
  const revokedBy = row.revokedBy ?? '';
  return {
    id: row.id,
    code: row.code,
    selector: row.selector,
    reason: row.reason,
    actor: row.createdBy,
    actorIsApiKey: isApiKeyActor(row.createdBy),
    createdAtIso: row.createdAt,
    createdAtDisplay: display(row.createdAt),
    revokedBy,
    revokedByIsApiKey: isApiKeyActor(revokedBy),
    revokedAtIso: row.revokedAt ?? '',
    revokedAtDisplay: display(row.revokedAt),
    revokeComment: row.revokeComment ?? '',
  };
}

/** Undefined when the site has no dismissal row at all (UD-06). */
export function buildDismissalsView(rows: readonly IssueDismissal[]): DismissalsView | undefined {
  if (rows.length === 0) return undefined;
  const active = rows.filter((r) => r.status === 'active').map(toViewRow);
  const revoked = rows.filter((r) => r.status === 'revoked').map(toViewRow);
  return { activeCount: active.length, revokedCount: revoked.length, active, revoked };
}
