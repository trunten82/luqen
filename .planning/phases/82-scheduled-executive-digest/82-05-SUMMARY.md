---
phase: 82-scheduled-executive-digest
plan: "05"
subsystem: dashboard-api
tags: [api, digest, wp-plugin, openapi, scheduler]
dependency_graph:
  requires: ["82-04"]
  provides: ["82-06"]
  affects: ["packages/dashboard/src/server.ts", "docs/reference/openapi/dashboard.json", "docs/reference/rbac-matrix.md"]
tech_stack:
  added: []
  patterns: ["requireAuthOrSend401 pattern from wp-network.ts", "rateLimitConfig 120/min", "disclaimer-strip at API boundary"]
key_files:
  created:
    - packages/dashboard/src/routes/api/digest.ts
    - packages/dashboard/tests/routes/api/digest-api.test.ts
  modified:
    - packages/dashboard/src/server.ts
    - docs/reference/openapi/dashboard.json
    - docs/reference/rbac-matrix.md
decisions:
  - "Period window for GET /api/v1/digest defaults to last 30 days (no schedule context at API call time)"
  - "disclaimer field stripped at the API boundary to avoid disclaimer exposure to WP consumers — WP renders its own localised disclaimer (D-12)"
  - "band is string label only (lower/moderate/elevated/high), never a numeric score (D-12)"
  - "digestApiRoutes registered next to wpNetworkApiRoutes; digestScheduleRoutes registered next to emailReportRoutes"
  - "digestTimer registered in onClose cleanup alongside emailTimer (no process-exit hang)"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-11"
  tasks_completed: 2
  files_modified: 5
---

# Phase 82 Plan 05: Digest API Endpoint + Server Wiring Summary

**One-liner:** Org-scoped `GET /api/v1/digest` endpoint (OAuth2/rate-limited/disclaimer-stripped) wired into server.ts alongside digest admin routes and sweep scheduler; openapi/rbac drift snapshots regenerated.

## What Was Built

### Task 1: GET /api/v1/digest endpoint + API route test (TDD)

Created `packages/dashboard/src/routes/api/digest.ts` with `digestApiRoutes(server, storage)`:

- `GET /api/v1/digest?site=…` — auth-gated (OAuth2 / X-Org-Id / API key); `requireAuthOrSend401` returns 401 when `currentOrgId` is absent or empty
- Rate-limited at 120 req/min (mirrors `rateLimitConfig` from `wp-network.ts`)
- Calls `buildDigest(storage, { orgId, siteUrl: site ?? null }, { start, end })` with a 30-day baseline window
- Strips `currentExposure.disclaimer` and `baselineExposure.disclaimer` from the response — WP plugin renders its own localised disclaimer (D-11/D-12)
- Band is always the ordinal string label (`lower|moderate|elevated|high`), never a numeric value (D-12)
- TypeBox response schema has no `disclaimer` field — enforced at both schema and handler levels
- No forbidden words in source file (`compliant`, `100%`, `lawsuit-proof`, `will be sued`, `fault`, `guarantee`)

Test file `packages/dashboard/tests/routes/api/digest-api.test.ts` (9 tests):
- 401 for unauthenticated + empty orgId
- 200 + `{ digest }` shape for empty org
- Sites array present
- Band is one of `lower|moderate|elevated|high` when exposure exists
- No `disclaimer` field in site payload
- No `"score": <number>` in site payload
- Single-site `?site=` scope returns 200
- Org-wide (no site param) returns 200 with sites array
- D-12 forbidden-words absent from serialised payload

TDD gate compliance: RED commit `b6bbaacc` → GREEN commit `ca83bf36`.

### Task 2: Server wiring + drift snapshot regeneration

Modified `packages/dashboard/src/server.ts`:

- Added imports: `digestScheduleRoutes` (admin), `digestApiRoutes` (API), `startDigestScheduler` (scheduler)
- Registered `await digestScheduleRoutes(server, storage, pluginManager)` next to `emailReportRoutes` (line ~1131)
- Registered `await digestApiRoutes(server, storage)` next to `wpNetworkApiRoutes` (line ~1194)
- Added `const digestTimer = startDigestScheduler(storage, pluginManager)` in `onReady` hook next to `emailTimer`
- Added `clearInterval(digestTimer)` in `onClose` hook alongside other timers

Regenerated drift snapshots (no new dependencies installed):
- `docs/reference/openapi/dashboard.json` — 357 paths; `GET /api/v1/digest` present
- `docs/reference/rbac-matrix.md` — 415 rows; `admin.system` gate on all `/admin/digest-schedules` routes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `default` substring in comment matched D-12 forbidden-word grep**
- **Found during:** Task 1 acceptance-criteria check (`grep -niE '...fault...' routes/api/digest.ts`)
- **Issue:** Comment text "reasonable default for first call" contains `fault` as a substring, triggering the `grep -niE 'fault'` gate
- **Fix:** Replaced with "baseline window for first call" (D-12 vocabulary: use `baseline` not `default` — explicit PATTERNS.md guidance)
- **Files modified:** `packages/dashboard/src/routes/api/digest.ts`
- **Commit:** `bbd6db4c`

**2. [Rule 3 - Blocking] `docs:openapi` and `docs:rbac` scripts are at repo root, not in `packages/dashboard`**
- **Found during:** Task 2 — plan referenced `npm run docs:openapi` from `packages/dashboard` but the scripts live at root `package.json`
- **Fix:** Ran `npm run docs:openapi && npm run docs:rbac` from the repo root; snapshot output written to `docs/reference/openapi/` and `docs/reference/rbac-matrix.md` (not `packages/dashboard/openapi.json` as the plan template mentioned)
- **Impact:** Drift gate verified against `docs/reference/openapi/dashboard.json` (correct location)

## TDD Gate Compliance

- RED: `test(82-05)` commit `b6bbaacc` — failing tests (Cannot find module `routes/api/digest.js`)
- GREEN: `feat(82-05)` commit `ca83bf36` — 9 tests passing
- REFACTOR: `fix(82-05)` commit `bbd6db4c` — comment wording fix (D-12 vocabulary)

## Known Stubs

None. The period window (last 30 days) is a working default; Plan 06 (WP plugin) passes the site URL and the period is correctly computed from `buildDigest`. No hardcoded placeholder data.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already covers:
- T-82-15: org isolation via `requireAuthOrSend401` + `currentOrgId` scoping — mitigated
- T-82-18: rate limiting at 120/min — mitigated
- T-82-19b: disclaimer stripped, band is label, forbidden words absent — mitigated
- T-82-26: openapi/rbac snapshots regenerated and committed — mitigated

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `packages/dashboard/src/routes/api/digest.ts` exists | FOUND |
| `packages/dashboard/tests/routes/api/digest-api.test.ts` exists | FOUND |
| `docs/reference/openapi/dashboard.json` exists | FOUND |
| `docs/reference/rbac-matrix.md` exists | FOUND |
| Commit `b6bbaacc` (RED test) | FOUND |
| Commit `ca83bf36` (GREEN impl) | FOUND |
| Commit `6fdaf49f` (server wiring + snapshots) | FOUND |
| Commit `bbd6db4c` (fix forbidden-word comment) | FOUND |
| 9 tests passing | CONFIRMED |
| GET /api/v1/digest in openapi snapshot | CONFIRMED |
