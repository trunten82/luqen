/**
 * Phase 41-04 — Dashboard OpenAPI envelope helpers.
 *
 * Provides the canonical TypeBox shapes used across dashboard route schemas:
 *   - LuqenResponse(T) — standard success envelope ({ success, data, error, meta })
 *   - ErrorEnvelope    — standard error response shape
 *   - NoContent        — explicit empty body marker for 204 responses
 *   - HtmlPageSchema   — boilerplate schema for Handlebars-rendered routes
 *
 * Per Phase 41 D-04, the envelope sits in `src/api/schemas/envelope.ts` to
 * mirror the (planned) compliance/branding/llm convention even though the
 * dashboard's routes themselves live under `src/routes/`.
 *
 * Per D-05, all object shapes here use `additionalProperties: true` so
 * existing callers that send superset fields are not broken.
 */

import { Type, type TSchema } from '@sinclair/typebox';

export const ErrorEnvelope = Type.Object(
  {
    error: Type.String(),
    statusCode: Type.Optional(Type.Number()),
    message: Type.Optional(Type.String()),
  },
  { $id: 'ErrorEnvelope', additionalProperties: true },
);

export const LuqenResponse = <T extends TSchema>(data: T) =>
  Type.Object(
    {
      success: Type.Optional(Type.Boolean()),
      data: Type.Union([data, Type.Null()]),
      error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
    },
    { additionalProperties: true },
  );

/** Explicit empty body for 204 responses. */
export const NoContent = Type.Null();

/**
 * Boilerplate schema for Handlebars-rendered (HTML) page routes.
 *
 * Per Phase 41 D-05 + the route-coverage gate: HTML routes must appear in
 * the OpenAPI spec (NOT hide:true), so we declare a real String response
 * with `produces: ['text/html']` and a shared `html-page` tag.
 */
export const HtmlPageSchema = {
  tags: ['html-page'],
  response: { 200: Type.String() },
  produces: ['text/html'],
} as const;
