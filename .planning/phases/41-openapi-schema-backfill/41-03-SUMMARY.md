---
phase: 41-openapi-schema-backfill
plan: 03
subsystem: llm
tags: [openapi, schemas, typebox, llm]
requires:
  - "@fastify/type-provider-typebox"
  - "@sinclair/typebox"
provides:
  - "src/api/schemas/envelope.ts (LuqenResponse, ErrorEnvelope) for llm"
  - "TypeBox schemas on 33 LLM Fastify routes"
  - "Active route-vs-spec coverage gate for LLM service"
  - "docs/reference/openapi/llm.json grown from 1131 → 3757 lines"
affects:
  - packages/core/src/mcp/http-plugin.ts (additive routeSchema option)
tech_stack:
  added:
    - "@fastify/type-provider-typebox ^6.1.0"
    - "@sinclair/typebox ^0.34.49"
  patterns:
    - "Inline TypeBox schema constants per route file (D-02)"
    - "LuqenResponse helper as no-op pass-through (D-04 LLM envelope variance)"
    - "additionalProperties: true throughout (D-05 tolerant)"
key_files:
  created:
    - packages/llm/src/api/schemas/envelope.ts
  modified:
    - packages/llm/package.json
    - packages/llm/src/api/server.ts
    - packages/llm/src/api/routes/health.ts
    - packages/llm/src/api/routes/well-known.ts
    - packages/llm/src/api/routes/oauth.ts
    - packages/llm/src/api/routes/clients.ts
    - packages/llm/src/api/routes/providers.ts
    - packages/llm/src/api/routes/models.ts
    - packages/llm/src/api/routes/capabilities.ts
    - packages/llm/src/api/routes/capabilities-exec.ts
    - packages/llm/src/api/routes/prompts.ts
    - packages/llm/src/api/routes/mcp.ts
    - packages/llm/tests/openapi/route-coverage.test.ts
    - packages/core/src/mcp/http-plugin.ts
    - docs/reference/openapi/llm.json
    - package-lock.json
decisions:
  - "Drop legacy components.schemas.ErrorResponse (no $ref consumers) — routes use ErrorEnvelope inline"
  - "LuqenResponse(T) returns inner T as a no-op for the LLM service per D-04 envelope variance — preserves existing raw-payload consumers (dashboard llm-client)"
  - "Body field schemas declared Optional so handlers' per-field 400 messages still surface (existing tests rely on per-field error text)"
  - "Extend @luqen/core mcp/http-plugin.ts with optional routeSchema option (additive, backwards-compatible) instead of duplicating MCP route registration in each service"
metrics:
  tasks_completed: 3
  duration_minutes: 22
  test_files_passing: 36
  tests_passing: 328
  llm_json_lines_before: 1131
  llm_json_lines_after: 3757
  routes_with_schemas: 33
  luqen_response_calls: 28
completed: 2026-04-26
---

# Phase 41 Plan 03: LLM OpenAPI Schema Backfill Summary

TypeBox-backed Fastify schemas on every LLM route, route-coverage CI gate flipped green, and `docs/reference/openapi/llm.json` regenerated from a 1131-line skeleton into a 3757-line spec covering 25 paths (33 method+path combinations) with body/response shapes for every endpoint — including precise contracts on the four highest-value capability-exec routes (extract-requirements, generate-fix, analyse-report, discover-branding).

## What Shipped

### Task 1 — TypeBox + envelope wiring (commit `b1a9445`)

- Added `@fastify/type-provider-typebox` ^6.1.0 and `@sinclair/typebox` ^0.34.49 to `packages/llm/package.json`.
- Created `packages/llm/src/api/schemas/envelope.ts` exporting `LuqenResponse(T)` and `ErrorEnvelope`.
- Wired `withTypeProvider<TypeBoxTypeProvider>()` into `createServer` so route schema types flow through Fastify.
- Removed legacy `components.schemas.ErrorResponse` from the swagger options — routes use the new TypeBox `ErrorEnvelope` inline.

### Task 2 — Schema backfill on all 11 route files (commit `934a8af`)

- All 11 LLM route files declare `schema:` blocks (10 directly; `mcp.ts` via the new `routeSchema` plugin option, see Decisions).
- 28 `LuqenResponse(...)` call sites across the route files.
- Capability-exec body + response shapes match handler return types:
  - `POST /api/v1/extract-requirements` — body `ExtractRequirementsBody`, response includes both legacy `requirements[]` shape and the actual `wcagVersion / wcagLevel / criteria / confidence` shape that handlers spread.
  - `POST /api/v1/generate-fix` — body `GenerateFixBody`, response uses precise `Type.Union([Literal('llm'), Literal('hardcoded'), Literal('cache')])` for `source`, plus `effort` enum.
  - `POST /api/v1/analyse-report` — body `AnalyseReportBody`, response includes `summary / keyFindings / priorities / patterns / executiveSummary` (handler keys).
  - `POST /api/v1/discover-branding` — body `DiscoverBrandingBody`, response shapes `colors[]` / `fonts[]` / `logo` / `logoUrl` / `brandName` / `description`.
- Extended `packages/core/src/mcp/http-plugin.ts` with an additive `routeSchema?` option so `/api/v1/mcp` registers a Fastify schema (JSON-RPC envelope body + permissive 200 + ErrorEnvelope error responses).
- All 327 pre-existing LLM tests still pass; `tsc --noEmit` clean across both packages.

### Task 3 — Coverage gate active + snapshot regenerated (commit `f22e49b`)

- Removed `describe.skip('[Phase 41 pending] ...')` marker; gate now runs on every CI invocation.
- Rewrote `parseRouteTree()` in `route-coverage.test.ts` to reconstruct full paths from Fastify's nested `printRoutes({ commonPrefix: false })` tree. Previous parser only saw leaf segments (e.g. `/:id` instead of `/api/v1/clients/:id`) and produced false positives.
- Filtered swagger UI internals (`/docs/*`) and `OPTIONS *` from the gate — these are infrastructure, not API surface.
- Regenerated `docs/reference/openapi/llm.json` via `npm run docs:openapi`. Confirmed deterministic (md5sum identical across two consecutive regeneration runs).

## Verification

- `cd packages/llm && npx tsc --noEmit` — clean.
- `cd packages/llm && npx vitest run` — **36 test files, 328 tests, all pass** (including the newly active route-coverage gate).
- `grep -L 'schema:' packages/llm/src/api/routes/*.ts` — empty (every route file declares schema).
- `grep -c 'LuqenResponse(' packages/llm/src/api/routes/*.ts | awk -F: '{s+=$2} END {print s}'` — **28** (see Deviations §1).
- `grep -q "Literal('llm')" packages/llm/src/api/routes/capabilities-exec.ts` — present.
- `wc -l docs/reference/openapi/llm.json` — **3757** (target was >2500 ✓).
- `npm run docs:openapi && git diff --exit-code docs/reference/openapi/llm.json` — exits 0 (deterministic).

## Decisions Made

| Decision | Rationale |
|---|---|
| Drop legacy `ErrorResponse` component | No `$ref` consumers existed; routes now use the TypeBox `ErrorEnvelope` inline. Cleaner spec. |
| `LuqenResponse(T)` returns the inner `T` directly (no `{data, meta?}` wrap) | Per Phase 41 D-04 LLM/branding envelope variance — handlers and consumers (dashboard `llm-client.ts`) speak raw payloads today. Wrapping would have broken `Array.isArray(providers)` and `body.criterion` style access in 22 existing tests + the live dashboard. The helper stays as a single seam to flip in a future normalisation phase (Plans 41-04/05+). |
| All POST/PUT body fields declared `Type.Optional(...)` | Handlers do their own per-field validation (`if (!body.x) return 400 'x is required'`) and 13 existing tests assert the field name in the 400 response text. AJV's pre-validation otherwise returns generic "Bad Request". |
| Extend `@luqen/core` mcp/http-plugin.ts with `routeSchema?` instead of registering route in each service | Additive, backwards-compatible. Keeps the single MCP route registration site authoritative; alternative would have been to skip MCP from the gate (loses coverage) or duplicate the plugin (drift risk). |
| `additionalProperties: true` on every entity schema | Per D-05 — handlers spread upstream payloads with extra fields (`...capResult.data`) and consumers expect them to flow through. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] LuqenResponse `{data, meta}` envelope broke existing handlers + 22 tests**

- **Found during:** Task 2 first test run.
- **Issue:** Plan's snippet declared `LuqenResponse(T) = { data: Union([T, Null]), meta?: ... }`. The LLM service handlers (and the dashboard consumers) speak raw payloads — when wrapped, fast-json-stringify either dropped the response (handler returned an array; schema required object) or stripped extra keys, causing 22 LLM tests to fail (`expect(Array.isArray(providers)).toBe(true)` returning `false`, etc.).
- **Fix:** Made `LuqenResponse(T)` a pass-through (returns `T` directly). The plan acknowledges this variance in D-04 ("Plans 41-02/03 keep the slimmer envelope ... to avoid breaking existing consumers"). The helper is preserved as the single migration seam — when consumers are ready, flip its body to wrap and that's the only file to change.
- **Files modified:** `packages/llm/src/api/schemas/envelope.ts`.
- **Commit:** `b1a9445` (amended after first test run).

**2. [Rule 1 — Bug] AJV-required body fields blocked handlers' per-field 400 messages**

- **Found during:** Task 2 second test run.
- **Issue:** With body fields declared as required `Type.String()`, AJV pre-validation returns generic `"Bad Request"` before the handler runs — but 13 existing tests assert the 400 response error text matches the missing field name (e.g. `expect(res.json().error).toMatch(/wcagCriterion/)`).
- **Fix:** Declared body fields `Type.Optional(...)`. Handlers' existing per-field validation runs and returns the per-field 400 messages tests expect. OpenAPI consumers still see the documented body shape.
- **Files modified:** `packages/llm/src/api/routes/capabilities-exec.ts`, `capabilities.ts`, `clients.ts`, `models.ts`, `prompts.ts`, `providers.ts`.
- **Commit:** `934a8af`.

**3. [Rule 3 — Blocking] MCP route had no schema; shared core plugin registered the route directly**

- **Found during:** Task 2 / Task 3 gate planning.
- **Issue:** `/api/v1/mcp` is registered by the shared `@luqen/core/mcp` plugin via `app.post(path, handler)` with no schema, so the swagger spec carried no entry for it. The route-coverage gate would fail.
- **Fix:** Extended `McpHttpPluginOptions` with an optional `routeSchema?: Record<string, unknown>` field. When set, the plugin passes it as `app.post(path, { schema: routeSchema }, handler)`. Behaviour with the option omitted is unchanged (Phase 28/29 backwards-compat). LLM `routes/mcp.ts` now passes a JSON-RPC envelope schema that documents the transport.
- **Files modified:** `packages/core/src/mcp/http-plugin.ts`, `packages/llm/src/api/routes/mcp.ts`.
- **Commit:** `934a8af`.

**4. [Rule 1 — Bug] route-coverage parser dropped parent prefixes from nested route entries**

- **Found during:** Task 3 first gate run.
- **Issue:** The original `parseRouteLine()` parsed each `printRoutes()` line independently, so nested routes like `/:id` under `/api/v1/clients` registered as bare `/:id` and never matched the spec's `/api/v1/clients/{id}`. The gate would have reported 21 false-positive missing routes.
- **Fix:** Replaced with `parseRouteTree()` that maintains a depth→parent-path stack and reconstructs full paths. Also filtered swagger UI internals (`/docs`, `/docs/*`) and `OPTIONS *` from the gate.
- **Files modified:** `packages/llm/tests/openapi/route-coverage.test.ts`.
- **Commit:** `f22e49b`.

### Unmet Acceptance Criterion (documented)

**Acceptance criterion:** `LuqenResponse(` total grep count `>= 30 (route count ~37)`.

**Actual:** 28 calls across 33 routes (vs the plan's `~37` estimate).

**Why:** The LLM service has 33 method+path combinations once swagger UI internals and `OPTIONS *` are excluded — the plan's `~37` estimate was high. Of those 33, five are `204 No Content` deletes (no body, no `LuqenResponse` needed) and the SSE `agent-conversation` route also documents response shapes via `LuqenResponse`. The actual ratio (28/33 = 85%) matches the plan's intended ratio (30/37 = 81%). Decision: leave at 28 rather than artificially inflate by wrapping `ErrorEnvelope` (which contributes nothing to documentation quality). All other plan-listed criteria are satisfied:

- Every Fastify route in `llm/src/api/routes/*.ts` appears in `app.swagger()` with a schema ✓
- `tests/openapi/route-coverage.test.ts` is active and passes ✓
- `llm.json` regenerates deterministically and grew substantially (1131 → 3757 lines) ✓
- Capability-exec routes carry precise body + response schemas ✓
- `Literal('llm')` enum in `generate-fix` source field captured precisely ✓

## Commits

| Task | Hash | Subject |
|---|---|---|
| 1 | `b1a9445` | feat(41-03): add TypeBox + envelope wiring for LLM service |
| 2 | `934a8af` | feat(41-03): backfill TypeBox schemas across 11 LLM route files |
| 3 | `f22e49b` | test(41-03): activate LLM route-coverage gate + regenerate llm.json |

## Self-Check

**Files claimed exist:**

- `packages/llm/src/api/schemas/envelope.ts` — FOUND
- `packages/llm/tests/openapi/route-coverage.test.ts` (modified) — FOUND
- `docs/reference/openapi/llm.json` (regenerated, 3757 lines) — FOUND

**Commits claimed exist:** `b1a9445`, `934a8af`, `f22e49b` — all FOUND in `git log --oneline`.

## Self-Check: PASSED
