/**
 * Phase 41-02 — Branding service shared response envelope schemas.
 *
 * Branding handlers return `{ data: ..., meta?: ... }` (no `success`/`error`
 * fields) — preserve that pre-v3 shape per Phase 41 D-04 acknowledgement.
 * ErrorEnvelope mirrors the `{ error, statusCode }` shape used across all
 * handler error paths in server.ts.
 *
 * D-05 — tolerant: `additionalProperties: true` everywhere so existing
 * superset payloads continue to validate.
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
      data: Type.Union([data, Type.Null()]),
      meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
    },
    { additionalProperties: true },
  );
