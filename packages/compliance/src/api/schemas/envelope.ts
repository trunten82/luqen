/**
 * Phase 41-01 — Shared OpenAPI envelope schemas for the compliance service.
 *
 * Per Phase 41 D-04: every service ships an identical-shape envelope helper.
 * Per D-05: TypeBox objects use `additionalProperties: true` so existing
 * callers that send superset fields keep working.
 */

import { Type, type TSchema } from '@sinclair/typebox';

export const ErrorEnvelope = Type.Object(
  {
    error: Type.String(),
    statusCode: Type.Optional(Type.Number()),
  },
  { $id: 'ErrorEnvelope', additionalProperties: true },
);

export const LuqenResponse = <T extends TSchema>(data: T) =>
  Type.Object(
    {
      success: Type.Optional(Type.Boolean()),
      data: Type.Union([data, Type.Null()]),
      error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      meta: Type.Optional(
        Type.Object(
          {
            total: Type.Optional(Type.Number()),
            page: Type.Optional(Type.Number()),
            limit: Type.Optional(Type.Number()),
          },
          { additionalProperties: true },
        ),
      ),
    },
    { additionalProperties: true },
  );
