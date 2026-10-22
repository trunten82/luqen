/**
 * The ONE place that decides how a dismissal actor reads (Phase 95, ACT-01, D-06).
 *
 * Used by the report page's Dismissed section (through dismissals-view.ts), the Excel export's
 * Dismissed By column and, from plan 95-02, the Audit Log Actor column. A second copy of these rules
 * is how one surface ends up printing what another one hides.
 *
 * The rules (moved here unchanged from dismissals-view.ts; quick 261013-dr7 WR-04, 89-11, HARD-08):
 *   - Whether an actor is an API key is decided from the SERVER-SET actor id (`api-key` or
 *     `api-key:<row id>` for a key, a uuid for a user), never from the display string, which for a
 *     user is a chosen username. A null id falls back to the shape of the display string.
 *   - The stored `api-key:<row id>` is an identifier, not a name, and is never displayed.
 *   - A marking key is named from the snapshot stored with the dismissal (it outlives the key),
 *     then from the scan org's live key map; a revoking key from the live map only. Names appear
 *     only when the caller may show key names; otherwise every key reads as the generic label.
 *   - The legacy `api-key:session` and bare `api-key` actors name no key.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { StorageAdapter } from '../../db/index.js';
import type { IssueDismissal, DismissalKeySnapshot } from '../../db/interfaces/issue-dismissal-repository.js';
import type { AuthUser } from '../../auth/middleware.js';
import { t, type Locale } from '../../i18n/index.js';
import { mayTouchDismissalOrg } from './scan-access.js';

const API_KEY_ACTOR = 'api-key';
const API_KEY_PREFIX = `${API_KEY_ACTOR}:`;

/** One key row as the label needs it: label and creation time. Never the id's secret or hash. */
export interface ApiKeyInfo {
  readonly label: string;
  readonly createdAt: string;
}

/** Key row id -> label and creation time. Callers build it from ONE org's key rows (the scan's). */
export type ScanOrgKeys = ReadonlyMap<string, ApiKeyInfo>;

export type ActorDescription =
  | { readonly kind: 'user'; readonly name: string }
  | { readonly kind: 'apiKey'; readonly key: ApiKeyInfo | null };

export interface DescribeActorInput {
  readonly actor: string;
  readonly actorId: string | null;
  /** The marking key's stored snapshot; a revoker passes none. */
  readonly snapshot?: DismissalKeySnapshot | null;
  readonly keys: ScanOrgKeys;
  /** May this viewer read key names? Callers pass mayTouchDismissalOrg. */
  readonly showKeyNames: boolean;
}

/** Shape test on a SERVER-SET actor id: `api-key:<id>` (D-12) or the legacy bare `api-key`. */
function isApiKeyId(id: string): boolean {
  return id === API_KEY_ACTOR || id.startsWith(API_KEY_PREFIX);
}

/**
 * Was this actor an API key? Decided from the server-set actor id (`created_by_id` /
 * `revoked_by_id`), so a user who CHOSE the username `api-key` is still a user (WR-04).
 */
export function isApiKeyActor(actor: string, actorId: string | null = null): boolean {
  return isApiKeyId(actorId ?? actor);
}

/** True when at least one row was dismissed or revoked by an API key (the lookup gate). */
export function hasApiKeyActor(rows: readonly IssueDismissal[]): boolean {
  return rows.some(
    (r) => isApiKeyActor(r.createdBy, r.createdById) || (r.revokedBy !== null && isApiKeyActor(r.revokedBy, r.revokedById)),
  );
}

/** The key row id of `api-key:<id>`; null for a user, bare `api-key` and the legacy `api-key:session`. */
function keyIdOf(actor: string, actorId: string | null): string | null {
  const id = actorId ?? actor;
  if (!id.startsWith(API_KEY_PREFIX)) return null;
  const keyId = id.slice(API_KEY_PREFIX.length);
  return keyId === '' || keyId === 'session' ? null : keyId;
}

export function describeActor(input: DescribeActorInput): ActorDescription {
  if (!isApiKeyActor(input.actor, input.actorId)) return { kind: 'user', name: input.actor };
  if (!input.showKeyNames) return { kind: 'apiKey', key: null };
  const keyId = keyIdOf(input.actor, input.actorId);
  if (keyId === null) return { kind: 'apiKey', key: null };
  const snapshot = input.snapshot ?? null;
  if (snapshot !== null) return { kind: 'apiKey', key: { label: snapshot.label, createdAt: snapshot.keyCreatedAt } };
  return { kind: 'apiKey', key: input.keys.get(keyId) ?? null };
}

/**
 * The text a plain-text surface (the Excel export, the Audit Log) shows. The report page renders the
 * same words and order from its template: `API key: <label> (Created <time>)`, or `API key`.
 */
export function actorLabelText(description: ActorDescription, locale: Locale): string {
  if (description.kind === 'user') return description.name;
  const key = description.key;
  if (key === null) return t('issueDismissals.actor.apiKey', locale);
  const created = `${t('admin.apiKeys.created', locale)} ${new Date(key.createdAt).toLocaleString(locale)}`;
  return `${t('issueDismissals.actor.apiKeyNamed', locale, { name: key.label })} (${created})`;
}

/**
 * The label and creation time of each API key of ONE org that may be NAMED. Only that org's own
 * rows are kept, so a system key or another org's key is never named (it reads as the generic
 * label). Callers gate with hasApiKeyActor. A failed read degrades to generic labels and never
 * throws; the log carries the scan id and the error NAME only (driver messages can quote input).
 */
export async function orgKeyMap(
  storage: StorageAdapter,
  orgId: string,
  log: FastifyBaseLogger,
  scanId: string,
): Promise<ScanOrgKeys> {
  try {
    const keys = await storage.apiKeys.listKeys(orgId);
    return new Map(
      keys
        .filter((k) => k.orgId === orgId)
        .map((k) => [k.id, { label: k.label, createdAt: k.createdAt }] as const),
    );
  } catch (err) {
    log.warn(
      { scanId, errorName: err instanceof Error ? err.name : 'UnknownError' },
      'Dismissed section: API key labels not readable, generic labels shown',
    );
    return new Map();
  }
}

/**
 * A display copy of dismissal rows for OUTPUT surfaces only (never persisted): `createdBy` holds the
 * shared actor label. A set with no API-key actor is returned as it is, so it stays byte-identical
 * and no key row is read.
 */
export async function withDisplayedActors(
  storage: StorageAdapter,
  user: AuthUser | undefined,
  scan: { readonly id: string; readonly orgId: string },
  rows: readonly IssueDismissal[],
  locale: Locale,
  log: FastifyBaseLogger,
): Promise<readonly IssueDismissal[]> {
  if (!hasApiKeyActor(rows)) return rows;
  const showKeyNames = mayTouchDismissalOrg(user, scan.orgId);
  const keys = showKeyNames ? await orgKeyMap(storage, scan.orgId, log, scan.id) : new Map<string, ApiKeyInfo>();
  return rows.map((row) => ({
    ...row,
    createdBy: actorLabelText(
      describeActor({
        actor: row.createdBy,
        actorId: row.createdById,
        snapshot: row.createdByKeySnapshot ?? null,
        keys,
        showKeyNames,
      }),
      locale,
    ),
  }));
}
