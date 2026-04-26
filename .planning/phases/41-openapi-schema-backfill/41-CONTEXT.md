# Phase 41 — OpenAPI Schema Backfill — Context

## Why this phase

Plan 40-01 wired up `@fastify/swagger` and CI drift gates across all 5
service surfaces (compliance, branding, llm, dashboard, MCP) but
deferred Task 2: actually adding `schema:` blocks to each route.
Without per-route schemas the generated OpenAPI specs are skeletal:

- `mcp.json` ships with a single stub `/api/v1/mcp` POST entry — none
  of the 38 MCP tool schemas advertised by the RBAC matrix surface
- The other 4 service snapshots have route shells but empty body /
  response definitions
- The route-vs-spec coverage tests in `packages/*/tests/openapi/` are
  intentionally `describe.skip('[Phase 41 pending] ...')` so CI stays
  green; they will go RED until backfill lands

Phase 41 closes the gap. After this phase:

- Every Fastify route in compliance/branding/llm/dashboard declares
  `schema` (body where applicable + response) using TypeBox
- Every MCP tool exposes its input/output schema in the generated
  `mcp.json`
- The `route-vs-spec` `describe.skip` markers are removed and tests pass
- `npm run docs:openapi` regenerates byte-stable snapshots
- `openapi-drift` CI gate stays green

## Locked decisions

### D-01 — Schema definition library: **TypeBox**

Use `@fastify/type-provider-typebox` everywhere. Compact syntax,
compile-time TypeScript inference, runtime AJV validation. Adds ~400 KB
to the dep tree but is the Fastify-native idiomatic choice and gives
us TypeScript types for free.

**Rejected alternatives:**
- Zod + `zod-to-openapi` — would have reused some existing Zod schemas,
  but mixes two schema libs and leaves Zod's runtime cost on the
  request path.
- Raw JSON Schema literals — verbose, no type inference.

### D-02 — Schema location: **inline in route definition**

Schema sits in the route file next to the handler. Format:

```ts
import { Type } from '@sinclair/typebox';
import type { FastifyTypeBoxInstance } from '...';

export async function scanRoutes(app: FastifyTypeBoxInstance) {
  app.post('/scan', {
    schema: {
      body: ScanRequestBody,        // local consts at top of file
      response: { 200: LuqenResponse(ScanResultData) },
    },
  }, async (req, reply) => { /* ... */ });
}
```

Constants for shared shapes live at the top of each route file. Truly
cross-route shapes (e.g. `LuqenResponse`, `ErrorEnvelope`) live in a
shared helper module per service (D-04).

**Rejected:** central `schemas/` dir per service (more files, more
hops); per-route `.schemas.ts` siblings (file fan-out without offsetting
benefit).

### D-03 — MCP tool schemas: **convert existing Zod at runtime**

MCP tools already define Zod input schemas via the SDK pattern. Use
`zod-to-json-schema` (already a transitive dep of MCP SDK) inside the
MCP route registration so `app.swagger()` produces real
`/api/v1/mcp/tools/{tool}` entries with full input/output schema. No
duplicate hand-written schemas; tools remain the single source of
truth.

Implementation hook: when the MCP plugin registers, iterate the
registered tools and inject one OpenAPI operation per tool name into
the Fastify schema for `/api/v1/mcp` (or a virtual route prefix
`/api/v1/mcp/tools/<name>` if the snapshot consumer needs distinct
operation IDs). Confirm with the snapshot script that the resulting
`mcp.json` lists 38 operations.

**Rejected:** hand-written JSON Schemas (76 hand-maintained schemas,
drift risk); name-and-description-only stubs (misleading consumers).

### D-04 — Common response envelope: **one reusable TypeBox schema, $ref everywhere**

Luqen's API uses an envelope:

```ts
{ success: boolean, data: T | null, error: string | null,
  meta?: { total, page, limit } }
```

Defined **once per service** in `src/api/schemas/envelope.ts`:

```ts
export const LuqenResponse = <T extends TSchema>(data: T) => Type.Object({
  success: Type.Boolean(),
  data: Type.Union([data, Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  meta: Type.Optional(Type.Object({
    total: Type.Number(),
    page: Type.Number(),
    limit: Type.Number(),
  })),
}, { $id: 'LuqenResponse' });
```

**Per-service envelope variance (acknowledged):** dashboard and compliance handlers historically return the full `{ success, data, error, meta? }` envelope, while branding and llm handlers return `{ data, meta? }` only — pre-existing pre-v3 shape. Plans 41-02 / 41-03 keep the slimmer envelope (omit `success`/`error`) to avoid breaking existing consumers; D-05 tolerance permits it. Future phase can normalise across all services if needed.

Routes `$ref` it via `LuqenResponse(MySpecificData)`. Single source of
truth, DRY spec output, easy to evolve (e.g. adding a `requestId`
field) in one place.

**Rejected:** inline per route (verbose); skip envelope (misleading
spec output that doesn't match runtime).

### D-05 — Strictness: **`additionalProperties: true` (tolerant)**

Schemas accept extra fields silently. Backwards-compatible with
existing clients (Phase 39 verification confirmed many internal
callers send superset fields by accident, never broken because no
schema rejected them). Adopt the strict default later, per-route, if
specific endpoints need it.

**Rejected:** `additionalProperties: false` globally (would break
Phase 38's internal admin clients in subtle ways); per-route
case-by-case (more decisions per route, no clear win at this stage).

### D-06 — Existing Zod request validators: **migrate to TypeBox**

Some routes (notably in dashboard `/api/v1/scans/*` and
`compliance/api/v1/regulations/*`) already use Zod for request body
validation via custom middleware. As part of each plan:

1. Replace `zodSchema.parse(req.body)` with `schema.body` declared on
   the route (TypeBox-typed) — Fastify's AJV runs at the same lifecycle
   point.
2. Keep behavioural parity: ensure the new TypeBox schema matches
   the Zod schema's `.parse()` output shape for all callers.
3. Remove the Zod import + manual middleware.

This delivers single-source-of-truth schemas (no Zod-vs-TypeBox drift),
removes Zod from the request path, and makes the OpenAPI spec match
runtime behaviour by construction.

**Rejected:** keep Zod alongside TypeBox (two sources of truth, drift
risk); generate JSON Schema from Zod via zod-to-openapi (mixed
conventions across services).

### D-07 — Plan breakdown: **one plan per service (5 plans)**

| Plan | Scope | Estimate |
|---|---|---|
| 41-01 | Compliance service schemas (~22 routes) | M |
| 41-02 | Branding service schemas (~10 routes) | S |
| 41-03 | LLM service schemas (~15 routes) | M |
| 41-04 | Dashboard non-MCP schemas (~30 routes) | L |
| 41-05 | Dashboard MCP tool schemas (38 tools, Zod conversion) | M |

Plans are largely independent (different files, different services)
and can run in one wave per the same parallel-execute pattern Phase 40
used. Plan 41-05 may wait for 41-04 if MCP plugin hooks share files
with the dashboard route registration — researcher will confirm.

**Rejected:** finer per-route-group plans (over-orchestration);
single mega-plan (no parallelism, single huge diff).

## Open items for the researcher

- **Plan 41-05 dependency on 41-04:** Does the MCP plugin's
  registration code share files with the dashboard's main route
  registry? If yes, wave-2 sequencing required.
- **Existing TypeBox usage:** any service already partially migrated?
  Audit for existing `Type.Object` imports — those routes are already
  half-done.
- **Plugin route schemas:** plugins (auth, notify, storage) register
  routes too. Are their routes part of Phase 41 scope, or does the
  plugin manifest hand the spec separately? Default: in scope unless
  research surfaces a reason to defer.
- **`/admin/internal/*` debug routes:** Should these be flagged
  `hide: true` in the swagger schema (excluded from public spec)?
  Default: yes, hide them, but confirm before rolling out.
- **Versioning:** bump `openapi.info.version` per service when this
  phase ships? Default: bump to match the next package version when
  v3.1.0 ships, but verify there isn't a CI gate keying on it.

## Validation gates

- `route-vs-spec` tests in all 5 service test suites flip from
  `describe.skip` back to `describe` and pass.
- `npm run docs:openapi` regenerates snapshots; `git diff
  docs/reference/openapi/` matches the new schemas exactly.
- `openapi-drift` CI workflow stays green.
- `npm test` per service shows no regression in existing tests
  (especially Zod-replaced routes — their existing test fixtures must
  still pass against TypeBox-validated handlers).
- A representative `curl` against each service's `/docs/json` returns
  a substantive document with body + response schemas for at least one
  POST and one GET route.

## Out of scope

- Adding new routes to any service.
- Schema-driven client SDK generation (could be a future phase).
- API versioning headers (`X-API-Version`, etc.).
- Breaking changes to existing response shapes — preserved by D-04 +
  D-05.
- Per-tool MCP rate limits — out of scope, separate concern.

## References

- Plan 40-01 SUMMARY.md (in `40-documentation-sweep/`) — what was
  shipped vs deferred
- `packages/*/tests/openapi/*.ts` — the route-vs-spec gates we need
  to flip green
- `scripts/snapshot-openapi.ts` — already produces deterministic
  snapshots; just needs real schemas to render
- `docs/reference/openapi/*.json` — current (skeletal) snapshots
- `40-VERIFICATION.md` — DOC-02 PARTIAL writeup that drove this phase
