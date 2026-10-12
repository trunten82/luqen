/**
 * TypeBox schemas and JSON mappers for the issue-dismissal routes (Phase 87).
 *
 * Deliberately contains NO `server.METHOD(...)` call so the RBAC matrix
 * generator (which scans route sources for such calls) is unaffected.
 */
import { Type, type Static } from '@sinclair/typebox';
import type {
  IssueDismissal,
  IssueDismissalEvent,
} from '../../db/interfaces/issue-dismissal-repository.js';
import {
  DISMISSAL_CODE_MAX_LENGTH,
  DISMISSAL_COMMENT_MAX_LENGTH,
  DISMISSAL_REASON_MAX_LENGTH,
  DISMISSAL_SELECTOR_MAX_LENGTH,
} from '../../services/issue-dismissals/validate-input.js';

export const ErrorResponse = Type.Object({ error: Type.String() });

export const ConflictResponse = Type.Object({
  error: Type.String(),
  existing_id: Type.String(),
});

const NullableString = Type.Union([Type.String(), Type.Null()]);

export const DismissalSchema = Type.Object({
  id: Type.String(),
  org_id: Type.String(),
  site_url: Type.String(),
  site_key: Type.String(),
  code: Type.String(),
  selector: Type.String(),
  reason: Type.String(),
  status: Type.String(),
  created_by: Type.String(),
  created_by_id: NullableString,
  created_at: Type.String(),
  revoked_by: NullableString,
  revoked_by_id: NullableString,
  revoked_at: NullableString,
  revoke_comment: NullableString,
});

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

export const DismissalEventSchema = Type.Object({
  id: Type.String(),
  action: Type.String(),
  actor: Type.String(),
  actor_id: NullableString,
  at: Type.String(),
  text: NullableString,
});

export const DismissalWithEventsSchema = Type.Composite([
  DismissalSchema,
  Type.Object({ events: Type.Array(DismissalEventSchema) }),
]);

export const ListResponse = Type.Object({ dismissals: Type.Array(DismissalWithEventsSchema) });

export const MarkBody = Type.Object(
  {
    code: Type.String({ maxLength: 300 }),
    selector: Type.String({ maxLength: 4000 }),
    reason: Type.String({ maxLength: 4000 }),
  },
  { additionalProperties: false },
);

export const RevokeBody = Type.Object(
  { comment: Type.Optional(Type.String({ maxLength: 4000 })) },
  { additionalProperties: false },
);

/**
 * Phase 89 (D-04): the read-only coverage preview behind the mark dialog. `refused` (with
 * `reason: 'selector'`) answers a selector that matches the whole page (FP-04); the UI translates it.
 */
export const PreviewQuery = Type.Object(
  {
    code: Type.String({ maxLength: DISMISSAL_CODE_MAX_LENGTH }),
    selector: Type.String({ maxLength: DISMISSAL_SELECTOR_MAX_LENGTH }),
  },
  { additionalProperties: false },
);

export const PreviewResponse = Type.Object({
  occurrences: Type.Integer({ minimum: 0 }),
  pages: Type.Integer({ minimum: 0 }),
  refused: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.Literal('selector')),
});

export const ScanParams = Type.Object({ scanId: Type.String() });
export const IdParams = Type.Object({ id: Type.String() });

export type MarkPayload = Static<typeof MarkBody>;
export type RevokePayload = Static<typeof RevokeBody>;
export type PreviewQueryPayload = Static<typeof PreviewQuery>;
export type PreviewResponsePayload = Static<typeof PreviewResponse>;

export const RATE_LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } } as const;

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
