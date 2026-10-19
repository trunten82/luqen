/**
 * The Dismissed section's view model (Phase 89 Plan 05, FP-15, D-07, UD-06/07/16).
 *
 * Pure: repository rows in, the plain object report-detail.hbs renders out. Everything the
 * template would otherwise have to decide is decided here, once:
 *   - rows are split by status (the repository returns created_at DESC; order is kept);
 *   - no rows at all -> undefined, so the route spreads NO `dismissals` key and the zero-
 *     dismissal render stays byte-identical (UD-06);
 *   - an API-key actor (D-12 `api-key:<id>`, or the legacy bare `api-key`) is flagged so the
 *     (quick 261013-dr7, WR-04: decided from the server-set actor ID - `api-key[:<id>]` for a key,
 *     a uuid for a user - never from the display string, which for a user is a chosen username)
 *     template shows the translated "API key" label. 89-11 (D-15 Q1 reverses the UD-16 title
 *     clause): the stored identifier is never rendered. HARD-08 (D-91-10): a MARKING key is named
 *     from the snapshot stored with the dismissal (its label and its creation time), so the name
 *     survives the key's deletion, and falls back to the caller's live key map; a REVOKING key is
 *     named from the live key map only (built from the SCAN org's own key rows). Each name carries
 *     the key's creation time as a tag ("API key: <label> (Created <time>)"), which tells two keys
 *     with the same label apart. Names and tags appear only when the caller passes showKeyNames
 *     (the viewer may touch the scan's org); otherwise every key reads as the generic label. The
 *     legacy `api-key:session` and bare `api-key` actors name no key. The template never inspects
 *     the actor string itself.
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

/** One key row as the view needs it: label and creation time. Never the id's secret or hash. */
export interface ApiKeyInfo {
  readonly label: string;
  readonly createdAt: string;
}

/** Key row id -> label and creation time. Callers build it from ONE org's key rows (the scan's). */
export type ScanOrgKeys = ReadonlyMap<string, ApiKeyInfo>;

export interface DismissalsViewOptions {
  /** The scan org's live key rows (revokers, and markers written before the snapshot existed). */
  readonly keys?: ScanOrgKeys;
  /** May this viewer read key names? The route passes mayTouchDismissalOrg. Default: no. */
  readonly showKeyNames?: boolean;
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

/** Shape test on a SERVER-SET actor id: `api-key:<id>` (D-12) or the legacy bare `api-key`. */
function isApiKeyId(id: string): boolean {
  return id === API_KEY_ACTOR || id.startsWith(API_KEY_PREFIX);
}

/**
 * Was this actor an API key? Decided from the server-set actor id (`created_by_id` /
 * `revoked_by_id`): `api-key[:<id>]` for a key, `randomUUID()` for a user, so a user who CHOSE the
 * username `api-key` is still a user (WR-04). A null id (no current write path produces one; prod
 * 2026-10-13: 0 rows) falls back to the legacy shape of the display string.
 */
export function isApiKeyActor(actor: string, actorId: string | null = null): boolean {
  return isApiKeyId(actorId ?? actor);
}

/** True when at least one row was dismissed or revoked by an API key (the route's lookup gate). */
export function hasApiKeyActor(rows: readonly IssueDismissal[]): boolean {
  return rows.some(
    (r) => isApiKeyActor(r.createdBy, r.createdById) || (r.revokedBy !== null && isApiKeyActor(r.revokedBy, r.revokedById)),
  );
}

/**
 * The key row id of a key actor `api-key:<id>`; null for a user, the bare legacy `api-key` and the
 * legacy `api-key:session` (a session opened before the key id was stored names no key).
 */
function keyIdOf(actor: string, actorId: string | null): string | null {
  const id = actorId ?? actor;
  if (!id.startsWith(API_KEY_PREFIX)) return null;
  const keyId = id.slice(API_KEY_PREFIX.length);
  return keyId === '' || keyId === 'session' ? null : keyId;
}

function display(iso: string | null): string {
  return iso === null ? '' : new Date(iso).toLocaleString();
}

interface Ctx {
  readonly keys: ScanOrgKeys;
  readonly showKeyNames: boolean;
}

const UNNAMED = { name: '', createdIso: '', createdDisplay: '' } as const;

function named(key: ApiKeyInfo | null | undefined): { name: string; createdIso: string; createdDisplay: string } {
  if (key === null || key === undefined) return UNNAMED;
  return { name: key.label, createdIso: key.createdAt, createdDisplay: display(key.createdAt) };
}

/** The marking key: the stored snapshot first (it outlives the key), then the live key map. */
function markerKey(row: IssueDismissal, ctx: Ctx): ApiKeyInfo | null {
  if (!ctx.showKeyNames) return null;
  const keyId = keyIdOf(row.createdBy, row.createdById);
  if (keyId === null) return null;
  const snapshot = row.createdByKeySnapshot ?? null;
  if (snapshot !== null) return { label: snapshot.label, createdAt: snapshot.keyCreatedAt };
  return ctx.keys.get(keyId) ?? null;
}

/** The revoking key: the live key map only (a revoke stores no snapshot). */
function revokerKey(row: IssueDismissal, ctx: Ctx): ApiKeyInfo | null {
  if (!ctx.showKeyNames || row.revokedBy === null) return null;
  const keyId = keyIdOf(row.revokedBy, row.revokedById);
  return keyId === null ? null : ctx.keys.get(keyId) ?? null;
}

function toViewRow(row: IssueDismissal, ctx: Ctx): DismissalViewRow {
  const revokedBy = row.revokedBy ?? '';
  const marker = named(markerKey(row, ctx));
  const revoker = named(revokerKey(row, ctx));
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
    createdAtDisplay: display(row.createdAt),
    revokedBy,
    revokedByIsApiKey: revokedBy !== '' && isApiKeyActor(revokedBy, row.revokedById),
    revokedByKeyName: revoker.name,
    revokedByKeyCreatedIso: revoker.createdIso,
    revokedByKeyCreatedDisplay: revoker.createdDisplay,
    revokedAtIso: row.revokedAt ?? '',
    revokedAtDisplay: display(row.revokedAt),
    revokeComment: row.revokeComment ?? '',
  };
}

/** Undefined when the site has no dismissal row at all (UD-06). */
export function buildDismissalsView(
  rows: readonly IssueDismissal[],
  options: DismissalsViewOptions = {},
): DismissalsView | undefined {
  if (rows.length === 0) return undefined;
  const ctx: Ctx = { keys: options.keys ?? NO_KEYS, showKeyNames: options.showKeyNames === true };
  const active = rows.filter((r) => r.status === 'active').map((r) => toViewRow(r, ctx));
  const revoked = rows.filter((r) => r.status === 'revoked').map((r) => toViewRow(r, ctx));
  return { activeCount: active.length, revokedCount: revoked.length, active, revoked };
}
