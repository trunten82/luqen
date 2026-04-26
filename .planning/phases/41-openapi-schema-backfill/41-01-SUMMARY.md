---
phase: 41-openapi-schema-backfill
plan: 01
subsystem: compliance-service
tags: [openapi, typebox, schema, compliance, fastify, ci-gate]
requires:
  - "@fastify/type-provider-typebox"
  - "@sinclair/typebox"
provides:
  - LuqenResponse<T> + ErrorEnvelope envelope helpers (compliance only)
  - Active route-vs-spec coverage gate for compliance
affects:
  - docs/reference/openapi/compliance.json (snapshot regen)
tech-stack:
  added: ["@fastify/type-provider-typebox@^5", "@sinclair/typebox@^0.34"]
  patterns: [TypeBox route schemas, shared envelope module per service, onRoute schema injection for plugin-mounted routes]
key-files:
  created:
    - packages/compliance/src/api/schemas/envelope.ts
  modified:
    - packages/compliance/package.json
    - packages/compliance/src/api/server.ts
    - packages/compliance/src/api/routes/health.ts
    - packages/compliance/src/api/routes/well-known.ts
    - packages/compliance/src/api/routes/oauth.ts
    - packages/compliance/src/api/routes/jurisdictions.ts
    - packages/compliance/src/api/routes/regulations.ts
    - packages/compliance/src/api/routes/requirements.ts
    - packages/compliance/src/api/routes/compliance.ts
    - packages/compliance/src/api/routes/updates.ts
    - packages/compliance/src/api/routes/sources.ts
    - packages/compliance/src/api/routes/webhooks.ts
    - packages/compliance/src/api/routes/users.ts
    - packages/compliance/src/api/routes/clients.ts
    - packages/compliance/src/api/routes/seed.ts
    - packages/compliance/src/api/routes/orgs.ts
    - packages/compliance/src/api/routes/wcag-criteria.ts
    - packages/compliance/src/api/routes/mcp.ts
    - packages/compliance/tests/openapi/route-coverage.test.ts
    - docs/reference/openapi/compliance.json
decisions:
  - "Skip body schema (not response/params) on routes whose existing tests POST without body — preserves backwards-compat (seed, oauth/revoke, sources/scan)"
  - "Skip response schema on /compliance/check — engine returns dynamic per-jurisdiction matrix that fast-json-stringify cannot enumerate from a static schema without dropping fields"
  - "MCP route uses onRoute hook to inject route.schema, since the shared @luqen/core/mcp plugin has no schema-injection API and changing it would touch every other service in the wave"
  - "Rewrote route-coverage parser from line-split to tree-walk because Fastify v5 printRoutes({ commonPrefix:false }) emits a hierarchical tree, not a flat list — original parser was returning bare /:id segments and would have flagged everything as missing"
metrics:
  duration: ~25 min
  completed: 2026-04-26
---

# Phase 41 Plan 01: Compliance OpenAPI Schema Backfill Summary

TypeBox schemas backfilled across all 16 compliance route files; route-vs-spec coverage gate flipped from `describe.skip` to `describe` and now passes; `docs/reference/openapi/compliance.json` regenerated from 745 → 4947 lines and is byte-stable across re-runs.

## What Shipped

**Task 1 — TypeBox provider + shared envelope (commit `97fa73b`)**
- Added `@fastify/type-provider-typebox@^5.0.0` and `@sinclair/typebox@^0.34.0` to `packages/compliance/package.json`.
- Created `packages/compliance/src/api/schemas/envelope.ts` exporting `LuqenResponse<T>` and `ErrorEnvelope` per Phase 41 D-04 (with `additionalProperties: true` per D-05).
- Wired `withTypeProvider<TypeBoxTypeProvider>()` on the Fastify instance in `packages/compliance/src/api/server.ts`.

**Task 2 — Backfill schemas on all 16 route files (commit `d03420d`)**
- Every route in `packages/compliance/src/api/routes/*.ts` now declares `schema: { tags, summary, body?, params?, querystring?, response }`.
- Local TypeBox shape constants per route file mirror the engine domain entities; all use `additionalProperties: true` (D-05 tolerant) so superset payloads from existing callers continue to work.
- D-06 Zod migration: confirmed via grep that no compliance route imports Zod at the request path — nothing to migrate.
- `mcp.ts` injects an OpenAPI schema via Fastify's `onRoute` hook (no plugin API change required), declaring the JSON-RPC 2.0 envelope as the body shape and `Type.Any()` for the response.

**Task 3 — Flip gate green + regen snapshot (commit `ac6aedd`)**
- `packages/compliance/tests/openapi/route-coverage.test.ts`: removed `describe.skip` and `[Phase 41 pending]` marker.
- Rewrote the route-tree parser to walk Fastify v5's hierarchical `printRoutes({ commonPrefix: false })` output and join parent path prefixes.
- Test now passes: every registered `/api/v1/*` and `/.well-known/*` route appears in `app.swagger().paths`.
- `npm run docs:openapi` regenerated `docs/reference/openapi/compliance.json` (745 → 4947 lines). Verified byte-stable across two consecutive runs.

## Verification

| Gate | Result |
|------|--------|
| `cd packages/compliance && npx tsc --noEmit` | exit 0 |
| `grep -L 'schema:' packages/compliance/src/api/routes/*.ts` | (empty — every file matches) |
| `cd packages/compliance && npx vitest run tests/api` | 146/146 pass |
| `cd packages/compliance && npx vitest run tests/openapi/route-coverage.test.ts` | 1/1 pass |
| `wc -l docs/reference/openapi/compliance.json` | 4947 (target >1500) |
| `npm run docs:openapi && diff` (back-to-back) | byte-stable |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Test invocations break under new body schemas**

- **Found during:** Task 2 verification.
- **Issue:** Existing tests POST to `/api/v1/seed`, `/api/v1/oauth/revoke`, and `/api/v1/sources/scan` with no body and no `content-type` header. With a TypeBox `body` schema declared, AJV rejected the empty body with HTTP 400, causing seed-dependent tests (compliance.test.ts, sources.test.ts) to cascade-fail.
- **Fix:** Dropped the `body:` field from those three routes' schemas (kept `tags`, `summary`, `response`). Routes still appear in OpenAPI; tolerant per D-05.
- **Files modified:** `seed.ts`, `oauth.ts`, `sources.ts`.
- **Commit:** `d03420d`.

**2. [Rule 1 — Bug] Response schema strips engine output**

- **Found during:** Task 2 verification of `compliance.test.ts`.
- **Issue:** Declaring `response: { 200: <any-schema> }` on `POST /api/v1/compliance/check` caused fast-json-stringify to drop dynamic fields from the engine's per-jurisdiction matrix (e.g. `annotatedIssues[].regulations`). Existing tests that asserted on those fields broke.
- **Fix:** Removed the response schema for that one endpoint with an explanatory comment. Body schema is retained, so the route still surfaces in the OpenAPI spec with full request shape.
- **Files modified:** `compliance.ts`.
- **Commit:** `d03420d`.

**3. [Rule 1 — Bug] Route-coverage parser broken under Fastify v5 tree output**

- **Found during:** Task 3 — flipping the gate exposed parser issues.
- **Issue:** The original parser line-split `printRoutes({ commonPrefix: false })` and matched `/^(\S+)\s+\((METHODS)\)$/`. Under Fastify v5 the output is a hierarchical tree where descendants print only their relative segment (e.g. `└── /:id (GET)` under `├── /api/v1/jurisdictions`). The parser returned bare `/:id` paths, which never appeared in the OpenAPI spec and would have failed the gate even with full schema coverage.
- **Fix:** Replaced parser with a tree-walker that tracks indent depth, maintains an ancestor-path stack, and joins parent + child segments. Added a `/api/v1` and `/.well-known` filter to ignore `@fastify/swagger-ui` static helper routes.
- **Files modified:** `tests/openapi/route-coverage.test.ts`.
- **Commit:** `ac6aedd`.

**4. [Rule 3 — Blocker] @luqen/core/mcp not built**

- **Found during:** Task 2 verification.
- **Issue:** Tests failed with `Cannot find package '@luqen/core/mcp'` because `packages/core/dist` was missing in the worktree.
- **Fix:** Ran `npm run build:core` once. Subsequently `npm run build` for the docs:openapi snapshot which needs all `dist/` outputs.
- **Files modified:** none (build artefacts only).

### Architectural Adjustments

None — all changes stayed within the single-service scope of plan 41-01.

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `grep -q '"@fastify/type-provider-typebox"' packages/compliance/package.json` | PASS |
| `test -f packages/compliance/src/api/schemas/envelope.ts` | PASS |
| `grep -q 'export const LuqenResponse'` envelope.ts | PASS |
| `grep -q 'export const ErrorEnvelope'` envelope.ts | PASS |
| `grep -qE 'TypeBoxTypeProvider\|withTypeProvider' server.ts` | PASS |
| `npx tsc --noEmit` for compliance | PASS (exit 0) |
| `grep -L 'schema:' .../routes/*.ts` returns ZERO files | PASS |
| `npx vitest run tests/api` | 146/146 PASS |
| No new `import.*from 'zod'` in route files | PASS (none introduced) |
| `describe.skip` removed from route-coverage.test.ts | PASS |
| `[Phase 41 pending]` marker removed | PASS |
| `npx vitest run tests/openapi/route-coverage.test.ts` exits 0 | PASS |
| `wc -l docs/reference/openapi/compliance.json` significantly more than 745 | PASS (4947) |
| `npm run docs:openapi && diff` deterministic | PASS |

## Self-Check

`git log --oneline -4`:
- `ac6aedd` — Task 3 (gate flip + snapshot regen)
- `d03420d` — Task 2 (16 route files backfilled)
- `97fa73b` — Task 1 (TypeBox + envelope)
- `aaa3d65` — base commit

`ls packages/compliance/src/api/schemas/envelope.ts`: present.

## Self-Check: PASSED

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. All changes are additive schema declarations on existing endpoints.
