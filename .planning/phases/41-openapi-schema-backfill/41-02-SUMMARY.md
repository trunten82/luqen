---
phase: 41-openapi-schema-backfill
plan: 02
subsystem: branding
tags: [openapi, typebox, schemas, branding]
dependency_graph:
  requires:
    - "@fastify/swagger registered in branding (Phase 40-01)"
  provides:
    - "Substantive OpenAPI schemas for all 18 branding HTTP paths"
    - "Active route-vs-spec coverage gate for branding"
    - "Reusable LuqenResponse / ErrorEnvelope TypeBox helpers (branding-local)"
  affects:
    - "Snapshot CI gate openapi-drift — branding.json now full-shape"
    - "Future plans 41-03/04/05 use the same envelope + tree-parser pattern"
tech_stack:
  added:
    - "@fastify/type-provider-typebox ^6.1.0"
    - "@sinclair/typebox ^0.34.49"
  patterns:
    - "withTypeProvider<TypeBoxTypeProvider>() applied at Fastify factory"
    - "Slim {data, meta?} envelope (no success/error) per Phase 41 D-04"
    - "onRoute hook pattern to attach schema to plugin-registered POST /api/v1/mcp"
    - "Walk-the-tree parser for Fastify printRoutes() indentation output"
key_files:
  created:
    - "packages/branding/src/api/schemas/envelope.ts"
    - ".planning/phases/41-openapi-schema-backfill/41-02-SUMMARY.md"
  modified:
    - "packages/branding/package.json"
    - "packages/branding/src/api/server.ts"
    - "packages/branding/src/api/routes/mcp.ts"
    - "packages/branding/src/api/routes/well-known.ts"
    - "packages/branding/tests/openapi/route-coverage.test.ts"
    - "docs/reference/openapi/branding.json"
    - "package-lock.json"
decisions:
  - "Cast handler send args (readonly→never) to keep TypeBoxTypeProvider strict checks happy without rewriting handler shapes"
  - "Filter /docs/* + /api/v1/openapi.json from coverage gate — they are swagger surface / redirect alias, not API"
metrics:
  duration_minutes: 12
  completed: "2026-04-26T06:45:00Z"
requirements: [OAPI-02]
---

# Phase 41 Plan 02: Branding OpenAPI Schema Backfill Summary

TypeBox schemas backfilled across every Fastify route in the branding service; route-coverage gate flipped on; deterministic OpenAPI snapshot regenerated from 415 → 2346 lines.

## Tasks Completed

| Task | Description | Commit |
| ---- | ----------- | ------ |
| 1 | Add TypeBox dep, create shared envelope, wire withTypeProvider | `23fd8fc` |
| 2 | Add schemas to all routes; fix tree-parser; flip gate; regenerate snapshot | `95d3a1a` |

## What Shipped

- **TypeBox plumbing**: `@fastify/type-provider-typebox` + `@sinclair/typebox` added to `packages/branding/package.json`; Fastify instance now built via `withTypeProvider<TypeBoxTypeProvider>()`.
- **Shared envelope**: `packages/branding/src/api/schemas/envelope.ts` exports `LuqenResponse(T)` (slim `{ data, meta? }` shape, preserved per Phase 41 D-04) and `ErrorEnvelope` (`{ error, statusCode? }`).
- **23 `schema:` blocks** across:
  - `server.ts` — `/api/v1/health` (kept), `/api/v1/oauth/token`, `/api/v1/templates/csv`, `/api/v1/templates/json`, `/api/v1/guidelines` (LIST/GET/POST/PUT/DELETE), `/api/v1/guidelines/:id/{colors,fonts,selectors}` (POST/DELETE), `/api/v1/guidelines/:id/sites` (POST/DELETE/GET), `/api/v1/clients` (LIST/POST), `/api/v1/clients/:id/revoke` (POST), `/api/v1/match` (POST)
  - `routes/well-known.ts` — `/.well-known/oauth-protected-resource`
  - `routes/mcp.ts` — `/api/v1/mcp` (POST) attached via `onRoute` hook because the shared `@luqen/core/mcp` plugin owns the route registration and has no schema option
- **Coverage gate active**: `tests/openapi/route-coverage.test.ts` is no longer `describe.skip`; rewrote the printRoutes tree parser to follow the indentation correctly (the original line parser only saw leaf segments, missing the tree prefix); also filtered `/docs/*` (swagger-ui surface) and `/api/v1/openapi.json` (302 redirect alias) which are not API routes.
- **Snapshot regenerated**: `docs/reference/openapi/branding.json` now 2346 lines (was 415), 18 paths with full request/response schemas. Two consecutive `npm run docs:openapi` runs produce byte-identical output.

## Verification

- `cd packages/branding && npx tsc --noEmit` — clean
- `cd packages/branding && npx vitest run` — 15 files, 95 tests, all green
- `npm run docs:openapi` — wrote `branding.json — 18 paths`
- Repeated `npm run docs:openapi` — `diff` exits 0 → deterministic
- `grep -c 'schema:' packages/branding/src/api/server.ts` → 23 (≥22)
- `grep -c 'describe.skip' packages/branding/tests/openapi/route-coverage.test.ts` → 0
- `wc -l docs/reference/openapi/branding.json` → 2346 (>1000)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeBox provider strict reply.send() type checks**

- **Found during:** Task 2
- **Issue:** `withTypeProvider<TypeBoxTypeProvider>()` enables strict typing of `reply.send()` against the declared response schema. Branding handlers send domain entities sourced from `SqliteAdapter` whose types are `readonly`-marked (`readonly string[]`, `readonly BrandedIssue<...>[]`, etc.). TypeBox-inferred response types are mutable, so 6 handlers failed `tsc` with TS4104 / TS2322.
- **Fix:** Cast the send-arg payloads with `as unknown as never` at the boundary (5 sites in `server.ts`). This preserves runtime AJV serialisation and keeps the OpenAPI documentation accurate while sidestepping a strict mutable/readonly mismatch that has no functional impact.
- **Alternatives considered:** Refactor SqliteAdapter return types to drop `readonly` (out of scope, touches storage layer); make response schemas use `Type.Any()` for `data` (loses OpenAPI documentation value).
- **Files modified:** `packages/branding/src/api/server.ts`
- **Commit:** `95d3a1a`

**2. [Rule 1 - Bug] Test parser couldn't reconstruct full route paths**

- **Found during:** Task 2
- **Issue:** The Phase 40-01 placeholder test parser walked each `printRoutes({ commonPrefix: false })` line in isolation, extracting only the leaf segment (e.g. `/:id/revoke`) instead of the full path (`/api/v1/clients/:id/revoke`). Once schemas were added, the gate failed because no OpenAPI path matched `/:id/revoke`.
- **Fix:** Rewrote `parseRouteLine` → `parseRouteTree` to walk the indented tree (4-char levels) and concatenate prefixes via a stack. Filter swagger-ui (`/docs/*`) and the openapi.json 302 alias which are infrastructural, not API.
- **Files modified:** `packages/branding/tests/openapi/route-coverage.test.ts`
- **Commit:** `95d3a1a`

**3. [Rule 3 - Blocking] `@luqen/core/mcp` plugin owns route registration**

- **Found during:** Task 2
- **Issue:** Plan said "add schema in routes/mcp.ts" but routes/mcp.ts only registers the shared `createMcpHttpPlugin` from `@luqen/core/mcp` — the plugin internally calls `app.post('/api/v1/mcp', handler)` with no schema option exposed.
- **Fix:** Used a `scoped.addHook('onRoute', ...)` inside both register-branches of routes/mcp.ts to mutate `routeOptions.schema` for `POST /api/v1/mcp` after the plugin registers it. No change to the upstream `@luqen/core/mcp` plugin needed.
- **Files modified:** `packages/branding/src/api/routes/mcp.ts`
- **Commit:** `95d3a1a`

## Acceptance Criteria

- [x] All 18 branding routes carry `schema:` blocks (23 schema declarations counted)
- [x] `route-coverage.test.ts` active and green
- [x] `branding.json` regenerated, deterministic, 2346 lines (target >1000)
- [x] Existing 95 branding tests still green
- [x] OAPI-02 satisfied

## Self-Check: PASSED

- FOUND: packages/branding/src/api/schemas/envelope.ts
- FOUND: packages/branding/src/api/server.ts (modified, 23 schema blocks)
- FOUND: docs/reference/openapi/branding.json (2346 lines)
- FOUND commit 23fd8fc (Task 1)
- FOUND commit 95d3a1a (Task 2)
