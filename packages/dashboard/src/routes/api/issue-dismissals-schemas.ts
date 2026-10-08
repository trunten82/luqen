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

export const ScanParams = Type.Object({ scanId: Type.String() });
export const IdParams = Type.Object({ id: Type.String() });

export type MarkPayload = Static<typeof MarkBody>;
export type RevokePayload = Static<typeof RevokeBody>;

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

export function eventToJson(e: IssueDismissalEvent): Static<typeof DismissalEventSchema> {
  return { id: e.id, action: e.action, actor: e.actor, actor_id: e.actorId, at: e.at, text: e.text };
}
