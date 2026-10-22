/**
 * TypeBox schemas and JSON mappers for the issue-dismissal routes (Phase 87).
 *
 * Deliberately contains NO `server.METHOD(...)` call so the RBAC matrix
 * generator (which scans route sources for such calls) is unaffected.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type {
  IssueDismissal,
  IssueDismissalEvent,
} from '../../db/interfaces/issue-dismissal-repository.js';
import {
  DISMISSAL_CODE_MAX_LENGTH,
  DISMISSAL_COMMENT_MAX_LENGTH,
  DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH,
  DISMISSAL_REASON_MAX_LENGTH,
  DISMISSAL_SELECTOR_MAX_LENGTH,
} from '../../services/issue-dismissals/validate-input.js';
import { TECHNICAL_DETAILS_PERMISSION } from '../../services/technical-details.js';

export const ErrorResponse = Type.Object({ error: Type.String() });

export const ConflictResponse = Type.Object({
  error: Type.String(),
  existing_id: Type.String(),
});

const NullableString = Type.Union([Type.String(), Type.Null()]);

/**
 * The dismissal's fields in emitted order. `selector` is a parameter so the list response can make
 * it optional (D-10) without moving it: the serialiser writes declared properties in declared order.
 */
const LIST_SELECTOR_DESCRIPTION =
  `CSS selector of the dismissed element. Present only when the caller holds ${TECHNICAL_DETAILS_PERMISSION}; omitted otherwise.`;

function dismissalFields<S extends TSchema>(selector: S) {
  return {
    id: Type.String(),
    org_id: Type.String(),
    site_url: Type.String(),
    site_key: Type.String(),
    code: Type.String(),
    selector,
    reason: Type.String(),
    status: Type.String(),
    created_by: Type.String(),
    created_by_id: NullableString,
    created_at: Type.String(),
    revoked_by: NullableString,
    revoked_by_id: NullableString,
    revoked_at: NullableString,
    revoke_comment: NullableString,
  };
}

export const DismissalSchema = Type.Object(dismissalFields(Type.String()));

/**
 * The mark (201) and revoke (200) response: the dismissal plus the outcome of the same-request
 * recompute of the site's stored count columns (Phase 88, D-13/D-14). snake_case, matching this
 * route's contract. `recompute_complete` is false when any scan could not be recomputed or the
 * scan listing failed; the dismissal itself is committed either way.
 */
export const DismissalMutationResponse = Type.Composite([
  DismissalSchema,
  Type.Object({
    recomputed_scans: Type.Integer({ minimum: 0 }),
    failed_scans: Type.Integer({ minimum: 0 }),
    recompute_complete: Type.Boolean(),
  }),
]);

/**
 * The revoke (200) response (D-10): the mark response with `selector` optional. A revoke names the
 * dismissal by id, so the caller never supplied the selector; it is present only when the caller
 * holds the technical-details permission. The mark response keeps it required: that caller typed it.
 */
export const RevokeMutationResponse = Type.Object({
  ...dismissalFields(Type.Optional(Type.String({ description: LIST_SELECTOR_DESCRIPTION }))),
  recomputed_scans: Type.Integer({ minimum: 0 }),
  failed_scans: Type.Integer({ minimum: 0 }),
  recompute_complete: Type.Boolean(),
});

export const DismissalEventSchema = Type.Object({
  id: Type.String(),
  action: Type.String(),
  actor: Type.String(),
  actor_id: NullableString,
  at: Type.String(),
  text: NullableString,
});

/**
 * A dismissal in the LIST response (D-10). `selector` is optional here: it is present only when the
 * caller holds the technical-details permission, the rule the report page applies. The mark and
 * revoke responses keep the required selector (DismissalSchema): they answer a caller who named it.
 */


export const DismissalWithEventsSchema = Type.Object({
  ...dismissalFields(Type.Optional(Type.String({ description: LIST_SELECTOR_DESCRIPTION }))),
  events: Type.Array(DismissalEventSchema),
});

export const ListResponse = Type.Object({ dismissals: Type.Array(DismissalWithEventsSchema) });

/**
 * Length limits come from validate-input.ts (D-13 / IN-04): one source of truth. The schema caps the
 * RAW string and the validator trims first, so a limit-length value padded with spaces is refused
 * here with a generic 400 (browsers trim before sending).
 */
export const MarkBody = Type.Object(
  {
    code: Type.String({ maxLength: DISMISSAL_CODE_MAX_LENGTH }),
    selector: Type.String({ maxLength: DISMISSAL_SELECTOR_MAX_LENGTH }),
    reason: Type.String({ maxLength: DISMISSAL_REASON_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const RevokeBody = Type.Object(
  { comment: Type.Optional(Type.String({ maxLength: DISMISSAL_COMMENT_MAX_LENGTH })) },
  { additionalProperties: false },
);

/**
 * Phase 89 (D-04): the read-only coverage preview behind the mark dialog. `refused` answers a
 * selector the mark route would refuse, with its `reason`: 'selector' for a selector that matches
 * the whole page or names no element (FP-04), 'selector-too-long' for one over
 * DISMISSAL_SELECTOR_MAX_LENGTH (HARD-01). The UI translates the reason. The schema bounds the
 * request at DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH (8192 characters, a 400 above it), above the
 * refusal limit, so a selector between the two limits is answered with its reason. The selector is
 * part of the URL: a request whose URL is over the server's 16 KiB header limit after encoding is
 * refused with 431 before this schema runs.
 */
export const PreviewQuery = Type.Object(
  {
    code: Type.String({ maxLength: DISMISSAL_CODE_MAX_LENGTH }),
    selector: Type.String({ maxLength: DISMISSAL_PREVIEW_SELECTOR_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const PreviewResponse = Type.Object({
  occurrences: Type.Integer({ minimum: 0 }),
  pages: Type.Integer({ minimum: 0 }),
  refused: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.Union([Type.Literal('selector'), Type.Literal('selector-too-long')])),
  /** Present (true) only when this rule + element is ALREADY actively dismissed for the site. */
  alreadyDismissed: Type.Optional(Type.Boolean()),
});

export const ScanParams = Type.Object({ scanId: Type.String() });
export const IdParams = Type.Object({ id: Type.String() });

export type MarkPayload = Static<typeof MarkBody>;
export type RevokePayload = Static<typeof RevokeBody>;
export type PreviewQueryPayload = Static<typeof PreviewQuery>;
export type PreviewResponsePayload = Static<typeof PreviewResponse>;

export const RATE_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } } as const;

/**
 * Route config for the MUTATING dismissal routes (mark, revoke): the shared rate limit. The CSRF
 * token is required for cookie sessions by the global hook in server.ts (requiresCookieCsrf), as on
 * every /api write; the report page's client sends X-CSRF-Token.
 */
export const MUTATION_CONFIG = { ...RATE_LIMIT } as const;

export function dismissalToJson(d: IssueDismissal): Static<typeof DismissalSchema> {
  return {
    id: d.id,
    org_id: d.orgId,
    site_url: d.siteUrl,
    site_key: d.siteKey,
    code: d.code,
    selector: d.selector,
    reason: d.reason,
    status: d.status,
    created_by: d.createdBy,
    created_by_id: d.createdById,
    created_at: d.createdAt,
    revoked_by: d.revokedBy,
    revoked_by_id: d.revokedById,
    revoked_at: d.revokedAt,
    revoke_comment: d.revokeComment,
  };
}

export function mutationToJson(
  d: IssueDismissal,
  r: { readonly recomputedScans: number; readonly failedScans: number; readonly listed: boolean },
): Static<typeof DismissalMutationResponse> {
  return {
    ...dismissalToJson(d),
    recomputed_scans: r.recomputedScans,
    failed_scans: r.failedScans,
    recompute_complete: r.listed && r.failedScans === 0,
  };
}

export function eventToJson(e: IssueDismissalEvent): Static<typeof DismissalEventSchema> {
  return { id: e.id, action: e.action, actor: e.actor, actor_id: e.actorId, at: e.at, text: e.text };
}
