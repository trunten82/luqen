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
 * `LuqenResponse(T)` — response shape helper for the LLM service.
 *
 * Per Phase 41 D-04 (per-service envelope variance): branding/llm services
 * historically return raw payloads (`T`), not the wrapped `{ data: T }`
 * envelope used by compliance/dashboard. To preserve existing consumers
 * AND keep the helper available as a single source of truth (so a future
 * normalisation phase can flip the wrapping in one place), this returns
 * the inner schema directly today.
 *
 * Future: when consumers are migrated, switch to the wrapped shape:
 * ```ts
 * Type.Object({ data: Type.Union([data, Type.Null()]),
 *               meta: Type.Optional(Type.Object({}, { additionalProperties: true })) },
 *             { additionalProperties: true });
 * ```
 */
export const LuqenResponse = <T extends TSchema>(data: T): T => data;
