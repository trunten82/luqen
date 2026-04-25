---
phase: 40
plan: 40-01
subsystem: documentation / openapi
tags: [docs, openapi, swagger, ci, fastify]
requires: []
provides:
  - "Live /docs (Swagger UI) and /docs/json endpoints on compliance, branding, llm, and dashboard"
  - "Snapshot generator: scripts/snapshot-openapi.ts (npm run docs:openapi)"
  - "openapi-drift CI workflow"
  - "Route-vs-spec coverage tests on all 5 surfaces"
affects:
  - packages/compliance/src/api/server.ts
  - packages/branding/src/api/server.ts
  - packages/llm/src/api/server.ts
  - packages/dashboard/src/server.ts
  - packages/{compliance,branding,llm}/src/auth/middleware.ts
tech-stack:
  added: ["@fastify/swagger (dashboard)", "@fastify/swagger-ui (dashboard)", "tsx (root devDep)", "jose (root devDep)"]
  patterns: ["fastify-swagger plugin per service", "deterministic JSON snapshot", "CI drift gate"]
key-files:
  created:
    - scripts/snapshot-openapi.ts
    - .github/workflows/openapi-drift.yml
    - packages/compliance/tests/openapi/route-coverage.test.ts
    - packages/branding/tests/openapi/route-coverage.test.ts
    - packages/llm/tests/openapi/route-coverage.test.ts
    - packages/dashboard/tests/openapi/route-coverage.test.ts
    - packages/dashboard/tests/openapi/mcp-route-coverage.test.ts
  modified:
    - package.json (root)
    - packages/dashboard/package.json
    - packages/dashboard/src/server.ts
    - packages/compliance/src/api/server.ts
    - packages/branding/src/api/server.ts
    - packages/llm/src/api/server.ts
    - packages/compliance/src/auth/middleware.ts
    - packages/branding/src/auth/middleware.ts
    - packages/llm/src/auth/middleware.ts
    - packages/compliance/tests/api/server.test.ts
    - docs/reference/api-reference.md
    - docs/branding/README.md
  deleted:
    - docs/reference/openapi-compliance.yaml
    - docs/reference/openapi-branding.yaml
    - docs/reference/openapi-dashboard.yaml
decisions:
  - "Standardise swagger UI mount on /docs across all 5 services (was /api/v1/docs on three of them)"
  - "Public-path lists keep /api/v1/docs as back-compat alias so any external bookmarks still work"
  - "Snapshot script normalises path/schema key order and strips server URLs for deterministic output"
  - "Dashboard hosts both admin/UI surface AND MCP endpoint; snapshot script splits the single spec into dashboard.json + mcp.json by /api/v1/mcp prefix"
  - "Route schema backfill (plan Task 2) deferred — see Deferred Issues"
metrics:
  duration: ~30 minutes (Codex execution; constrained by parallel-worktree env without node_modules)
  tasks_completed: 5
  tasks_deferred: 1
  files_created: 7
  files_modified: 12
  files_deleted: 3
  completed_date: "2026-04-25"
---

# Phase 40 Plan 01: OpenAPI auto-generation Summary

Wire `@fastify/swagger` across all 5 Fastify surfaces (compliance, branding, llm, dashboard, MCP) with live `/docs` UI, deterministic JSON snapshots under `docs/reference/openapi/`, a CI drift gate, and per-service route-vs-spec coverage tests.

## What Shipped

### Live `/docs` per service (Task 1)

- Compliance, branding, and llm services already had `@fastify/swagger` registered. Their swagger UI route was at `/api/v1/docs`; this plan moves it to `/docs` to standardise across all surfaces.
- Dashboard now registers `@fastify/swagger` + `@fastify/swagger-ui` for the first time — the spec covers both the HTML admin/UI surface and the MCP Streamable HTTP endpoint mounted at `/api/v1/mcp` (single-instance approach; the snapshot generator splits the resulting spec into `dashboard.json` + `mcp.json` by path prefix).
- Public-path allowlists in each service's `auth/middleware.ts` were extended to permit unauthenticated access to `/docs` (canonical) while keeping `/api/v1/docs` for back-compat.
- `/api/v1/openapi.json` redirect alias (compliance / branding / llm) updated to point at the new `/docs/json` location.

### Snapshot generator (Task 3)

- `scripts/snapshot-openapi.ts` boots each service in-process via its `createServer(...)` factory using a minimal `:memory:` SQLite + RSA keypair bootstrap, calls `app.swagger()`, and writes pretty-printed deterministic JSON.
- Determinism: paths sorted alphabetically; `components.schemas` sorted; `tags` sorted by name; `servers[*].url` replaced with a placeholder so snapshots are host-independent.
- Dashboard is booted once; resulting paths split by `/api/v1/mcp` prefix into `dashboard.json` (admin/UI) and `mcp.json` (Streamable HTTP).
- Exposed as `npm run docs:openapi`. `tsx` and `jose` added to root `devDependencies`.

### CI drift gate (Task 5)

- `.github/workflows/openapi-drift.yml` runs on every PR and push to `master`/`develop`:
  1. `npm ci` and workspace builds
  2. `npm run docs:openapi`
  3. `git diff --exit-code docs/reference/openapi/` — fails if regenerated snapshots differ from committed snapshots
  4. Per-service route-vs-spec coverage tests under `tests/openapi/`

### Route-vs-spec coverage tests (Task 4)

- Five vitest test files (`tests/openapi/route-coverage.test.ts` per service plus `mcp-route-coverage.test.ts` for the dashboard MCP routes).
- Each enumerates Fastify-registered routes via `app.printRoutes()`, parses them, converts `/:param` to `/{param}`, and asserts every route is present in the OpenAPI spec.
- These tests are intentionally strict and **will fail until Task 2 (route schema backfill) lands** — that is the documented RED-phase contract.

### Legacy YAML retirement (Task 6)

- Deleted `docs/reference/openapi-compliance.yaml`, `openapi-branding.yaml`, and `openapi-dashboard.yaml`.
- Updated cross-references in `docs/branding/README.md` and `docs/reference/api-reference.md` to point at the new JSON snapshots and the live `/docs` UI.
- `CHANGELOG.md` mentions retained as historical record.

## Commits

| Hash | Message |
|------|---------|
| 55287bd | feat(40-01): register @fastify/swagger in dashboard server |
| 664a0a9 | feat(40-01): standardize swagger UI mount to /docs across services |
| c706e73 | feat(40-01): add scripts/snapshot-openapi.ts and docs:openapi script |
| 03bb7df | ci(40-01): add openapi-drift workflow |
| 41762eb | test(40-01): add route-vs-spec coverage tests for all 5 surfaces |
| 1ebadd9 | chore(40-01): retire legacy openapi-{compliance,branding,dashboard}.yaml |

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] Worktree was missing the entire phase 40 directory**

- **Found during:** Initial context load.
- **Issue:** This worktree was branched from `82a89aa` which predates the planning phase 40 artefacts. `40-01-PLAN.md` and `40-CONTEXT.md` did not exist on disk.
- **Fix:** Copied phase 40 plan files from the canonical main tree at `/root/luqen/.planning/phases/40-documentation-sweep/` into the worktree so the executor could read them. Files staged with the SUMMARY commit.
- **Impact:** None on the deliverable; context preserved.

### Deferred

**1. Task 2 — Route schema backfill (DEFERRED, follow-up plan recommended)**

- **Why deferred:** Task 2 requires adding minimal Fastify schemas (summary, tags, response) to every route across packages/{compliance,branding,llm,dashboard}/src/routes/ and packages/dashboard/src/mcp/tools/. There are dozens of route files and the work is iterative — each schema needs to be tested against the route's actual handler shape. Doing this without a runnable build environment in a parallel worktree (no `node_modules` installed; no way to validate that schemas don't break the existing handlers) is high-risk.
- **Effect on this plan:** The Task 4 coverage tests will fail in CI until route schemas are backfilled. Recommend follow-up plan `40-01b-route-schemas` that:
  1. Runs `npm install` and the existing service test suites green to establish a baseline.
  2. Walks each route file, adds minimal schema, runs the per-service coverage test until green.
  3. Commits one service per commit so a regression is bisectable.
  4. Then runs `npm run docs:openapi` once and commits the 5 generated JSON snapshots.

**2. Snapshot JSON files not committed in this change**

- **Why deferred:** The worktree has no `node_modules` (parallel-worktree isolation) so `npm run docs:openapi` cannot be executed here. The orchestrator integration step or the Task 2 follow-up must run the script once on the integrated branch and commit the resulting `docs/reference/openapi/{compliance,branding,llm,dashboard,mcp}.json`.
- **Acceptance criterion impact:** The plan's "All 5 files exist" acceptance criterion is unmet at this commit point; will be satisfied as part of the Task 2 follow-up.

## Verification

Self-verifiable now (without runnable env):

- [x] `grep -l "@fastify/swagger" packages/{compliance,branding,llm,dashboard}/package.json` lists 4 files.
- [x] `grep -n "register.*@fastify/swagger\|register(import('@fastify/swagger')" packages/compliance/src/api/server.ts packages/branding/src/api/server.ts packages/llm/src/api/server.ts packages/dashboard/src/server.ts` shows registration in all 4 (MCP shares the dashboard registration).
- [x] `grep -nE "routePrefix:.*['\\\"]/docs['\\\"]" packages/{compliance,branding,llm}/src/api/server.ts packages/dashboard/src/server.ts` matches all 4.
- [x] `test -f scripts/snapshot-openapi.ts` → 0
- [x] `grep -q '"docs:openapi"' package.json` → 0
- [x] `test -f .github/workflows/openapi-drift.yml` → 0
- [x] `grep -q "git diff --exit-code docs/reference/openapi/" .github/workflows/openapi-drift.yml` → 0
- [x] All 5 test files exist at the paths in `files_modified`.
- [x] `test ! -e docs/reference/openapi-compliance.yaml` (and branding/dashboard).

Pending integration-time verification (orchestrator should run after `npm install`):

- [ ] `npm run docs:openapi` produces 5 JSON files under `docs/reference/openapi/`.
- [ ] Re-running `npm run docs:openapi` produces zero git diff (deterministic).
- [ ] `npm test --workspaces -- tests/openapi/` is green once Task 2 follow-up lands.
- [ ] Live `/docs` reachable on each service when started.

## Self-Check: PASSED

All 6 commits present in `git log`:

- 55287bd, 664a0a9, c706e73, 03bb7df, 41762eb, 1ebadd9 — all FOUND.

All declared created files exist on disk (verified via the file system):

- scripts/snapshot-openapi.ts — FOUND
- .github/workflows/openapi-drift.yml — FOUND
- packages/compliance/tests/openapi/route-coverage.test.ts — FOUND
- packages/branding/tests/openapi/route-coverage.test.ts — FOUND
- packages/llm/tests/openapi/route-coverage.test.ts — FOUND
- packages/dashboard/tests/openapi/route-coverage.test.ts — FOUND
- packages/dashboard/tests/openapi/mcp-route-coverage.test.ts — FOUND
