/**
 * Phase 41-03 — Shared TypeBox response envelope for the LLM service.
 *
 * Per Phase 41 D-04 (envelope) + D-05 (tolerant additionalProperties).
 *
 * Note: branding/llm services historically return a slimmer
 * `{ data, meta? }` envelope (no `success`/`error` flags) — preserved here
 * to avoid breaking existing consumers. Compliance/dashboard use the full
 * envelope. See 41-CONTEXT.md D-04 "Per-service envelope variance".
 */

import { Type, type TSchema } from '@sinclair/typebox';

export const ErrorEnvelope = Type.Object(
  {
    error: Type.String(),
    statusCode: Type.Optional(Type.Number()),
  },
  { $id: 'ErrorEnvelope', additionalProperties: true },
);

/**
 * Slim envelope: `{ data?, meta? }` + `additionalProperties: true`.
 *
 * `data` is OPTIONAL because LLM handlers historically return raw payloads
 * (e.g. `{ requirements, model, provider }` without an outer `data` key) —
 * those extras flow through via `additionalProperties: true`. Future
 * normalisation to the full envelope can flip `data` to required.
 */
export const LuqenResponse = <T extends TSchema>(data: T) =>
  Type.Object(
    {
      data: Type.Optional(Type.Union([data, Type.Null()])),
      meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
    },
    { additionalProperties: true },
  );
