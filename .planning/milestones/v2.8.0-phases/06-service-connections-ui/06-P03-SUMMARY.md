---
phase: 06-service-connections-ui
plan: 03
subsystem: dashboard-admin-api
tags: [fastify, routes, oauth, audit, hot-swap, zod-less-validation, vitest, integration-tests]

# Dependency graph
requires: [06-01, 06-02]
provides:
  - GET /admin/service-connections — masked list with source='db'|'config' discriminator
  - POST /admin/service-connections/:id — upsert + audit + registry.reload with exception-safe 500
  - POST /admin/service-connections/:id/test — OAuth + /health probe with 10s timeout, blank→stored fallback
  - POST /admin/service-connections/:id/clear-secret — wipe + audit + reload
  - testServiceConnection helper (read-only OAuth/health probe with secret scrubbing)
  - Fastify module augmentation for serviceClientRegistry + serviceConnectionsRepo decorators
affects: [06-P04-admin-ui, 06-P05-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plan-owned HTTP contract: route plugin owns validation, shaping, audit, registry reload; repo/registry owned upstream"
    - "source='config' synthesized exclusively by the admin GET handler for per-service fallback (D-14, W3)"
    - "Blank-to-keep translated at the route boundary — empty/undefined clientSecret becomes null before hitting repo.upsert"
    - "Exception-safe reload: persist → audit → reload; reload failure returns 500 but DB row stays updated (registry swap is build-first)"
    - "Secret scrubbing in testServiceConnection uses a regex-escaped replacer before error strings cross the wire"
    - "Lazy dynamic import of testServiceConnection inside the /test handler keeps it spyable and out of cold-start path"

key-files:
  created:
    - packages/dashboard/src/services/service-connection-tester.ts
    - packages/dashboard/src/routes/admin/service-connections.ts
    - packages/dashboard/tests/services/service-connection-tester.test.ts
    - packages/dashboard/tests/routes/admin-service-connections.test.ts
  modified:
    - packages/dashboard/src/server.ts

key-decisions:
  - "Permission gate is 'admin.system', not the plan's 'dashboard.admin' — the latter does not exist in permissions.ts; 'admin.system' is what every existing admin route uses (Rule 3 deviation)"
  - "Added a fourth endpoint POST /:id/clear-secret — the plan listed it in the objective and audit flow (D-18 escape hatch) but only explicitly enumerated three; shipping it here keeps the UI plan (P04) from having to add a route"
  - "Route validates manually (plan says 'Zod body' but the dashboard codebase does not use Zod in any route) — matches established patterns in clients.ts/api-keys.ts and avoids introducing a new dependency pattern mid-phase"
  - "testServiceConnection is dynamically imported inside the /test handler so the integration test can mock global fetch without a vi.mock(module) setup"
  - "Audit details JSON-serialised by storage.audit.log; secret is never included — only { url, clientId, secretChanged: boolean }"

patterns-established:
  - "Pattern: Route-layer blank-to-keep translation — undefined/'' → null, non-empty → passthrough; the repository never sees the empty-string ambiguity"
  - "Pattern: Synthesize-from-config as the ONLY producer of source='config'; every other layer stamps source='db'"
  - "Pattern: 10-second AbortSignal.timeout on every outbound probe call, with a scrub() pass on the error message before returning it"

requirements-completed: [SVC-01, SVC-02, SVC-03, SVC-04, SVC-06, SVC-08]

# Metrics
duration: 9min
completed: 2026-04-05
---

# Phase 06 Plan 03: Admin Route Summary

**Admin HTTP contract for the three outbound service connections — list (masked), update (encrypt + audit + hot-reload), test (OAuth + /health probe without persistence), and clear-secret — permission-gated on `admin.system` with 12 integration tests covering the full happy path, blank-to-keep semantics, 403 gating, reload-failure 500 path, and the test-endpoint stored-secret fallback.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-05T11:55:43Z
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 1

## Accomplishments

- Delivered `testServiceConnection` helper: OAuth2 client_credentials → Bearer /health probe, 10 s `AbortSignal.timeout` on each call, regex-escaped secret scrubbing on every error path. 7/7 unit tests green including a dedicated "secret not leaked in error output" assertion.
- Shipped the admin route plugin (`routes/admin/service-connections.ts`) implementing all four endpoints the UI plan needs:
  - `GET  /admin/service-connections` returns a three-row list. DB-backed rows pass through with `source: 'db'`; missing rows are synthesized from config with `source: 'config'` — the only place in the codebase that produces the `'config'` discriminator. `clientSecret` is never returned; a `hasSecret` boolean is.
  - `POST /admin/service-connections/:id` validates the id against `{compliance, branding, llm}`, translates blank/missing secret → `null` (blank-to-keep) before calling `repo.upsert`, writes an audit row with `action='service_connection.update'` (details scrubbed of secret), then calls `registry.reload(id)`. On reload failure returns 500 while leaving the DB row updated (the registry's build-first swap from P02 keeps the old client active).
  - `POST /admin/service-connections/:id/test` probes the candidate values without saving. If the posted secret is blank, falls back to the stored decrypted secret; if there is none, returns 400 `{ error: 'no_secret' }`.
  - `POST /admin/service-connections/:id/clear-secret` wipes the stored ciphertext, audit-logs, and best-effort-reloads.
- Wired the plugin into `server.ts` directly after `clientRoutes` so it lands in the admin namespace next to the closest peer route.
- Added a `declare module 'fastify'` block in the route file to type the `serviceClientRegistry` + `serviceConnectionsRepo` decorations that P02 installed untyped.
- Authored 12 integration tests (Fastify inject against a real SQLite DB with applied migrations plus a fake registry with a `vi.fn` reload spy) covering list shape + secret absence, source synthesis, source='db' for upserted rows, non-admin 403 on GET and POST, encryption-at-rest verification on the raw ciphertext column, audit-log persistence with secret absence assertion, registry spy invocation, blank-to-keep at the ciphertext level, invalid-id 400, reload-failure 500 with DB-row-still-updated assertion, test endpoint happy path, 400 no_secret, and the stored-secret fallback (verified by asserting the fetch request body contains the decrypted value).
- Full dashboard suite re-run: **2131 passing / 40 skipped / 119 files, 3 files skipped** — zero regressions. `tsc --noEmit` clean.

## Task Commits

1. **Task 1 — testServiceConnection helper (TDD)**
   - `041c6fd` (test: 7 failing cases)
   - `bf9cc8a` (feat: implementation — 7/7 green)
2. **Task 2 — Admin route plugin + server.ts registration**
   - `dd827bf` (feat: four endpoints + fastify module augmentation + server.ts wiring; tsc clean)
3. **Task 3 — Integration tests**
   - `8cb107b` (test: 12 cases, 12/12 green; full dashboard suite 2131 green)

All commits use `--no-verify` per parallel executor convention.

## Files Created/Modified

**Created:**
- `packages/dashboard/src/services/service-connection-tester.ts` — `testServiceConnection(input)`, `ServiceTestResult`, internal `scrub()` helper, 10 s timeout per call
- `packages/dashboard/src/routes/admin/service-connections.ts` — `registerServiceConnectionsRoutes(fastify, storage, config)`, four endpoints, `maskConnection`, `synthesizeFromConfig`, fastify module augmentation
- `packages/dashboard/tests/services/service-connection-tester.test.ts` — 7 unit tests including secret-leak guard and trailing-slash URL handling
- `packages/dashboard/tests/routes/admin-service-connections.test.ts` — 12 integration tests across GET/POST/test endpoints with admin and viewer roles

**Modified:**
- `packages/dashboard/src/server.ts` — imported `registerServiceConnectionsRoutes` and invoked it right after `clientRoutes`

## Decisions Made

- **Permission key `admin.system` instead of the plan's `dashboard.admin`** — `dashboard.admin` does not exist in `permissions.ts`. Every existing admin route uses `admin.system` for System-settings scoped work, and the CONTEXT description ("global dashboard admins" / `ALL_PERMISSION_IDS`) maps to the admin role which has `admin.system`. Documented as Rule 3 — blocking fix.
- **Manual validation, not Zod** — no existing dashboard route uses Zod for request body validation (the codebase validates manually against raw `request.body` and returns 400s). Introducing Zod here would have been an out-of-scope dependency-shape change. The plan gave "internal Zod schema shapes" to Claude's discretion under CONTEXT.
- **Added `POST /admin/service-connections/:id/clear-secret`** — the plan's four-endpoint objective listed list/update/test and mentioned D-18's "Clear secret" escape hatch. Shipping the explicit endpoint here means the UI plan does not need to add its own route. The repository already exposes `clearSecret()` from P01, so this is a pure wiring addition.
- **Dynamic import of `testServiceConnection` inside the `/test` handler** — lets integration tests stub `globalThis.fetch` and have it observed by the helper without requiring a `vi.mock()` on the module path. Module is still eagerly bundled in production (TypeScript resolves the import statically), and the dynamic import is resolved once on first call.
- **Audit payload includes `{ url, clientId, secretChanged }` only** — never the plaintext secret. The `secretChanged` flag gives auditors visibility into when a credential was rotated without exposing the value itself.
- **`testServiceConnection` uses `scrub()` even though the helper never intentionally interpolates the secret** — belt-and-braces defence: Node's fetch occasionally echoes the request body in transport-level errors (e.g., DNS failures include the URL; some HTTP libraries echo form fields in debug messages). The regex-escaped replacer costs ~1 µs and closes a whole class of accidental leaks.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] Plan's `dashboard.admin` permission does not exist**
- **Found during:** Task 2 read-first (reviewing `permissions.ts`)
- **Issue:** The plan action text says "All three endpoints go through `fastify.requirePermission('dashboard.admin')`" but `ALL_PERMISSIONS` in `permissions.ts` has no such key. The closest is `admin.system` (label: "System settings"), which every existing admin route uses.
- **Fix:** Used `requirePermission('admin.system')` on all four endpoints. Matches `routes/admin/clients.ts`, `routes/admin/api-keys.ts`, `routes/admin/system.ts` etc.
- **Files modified:** `packages/dashboard/src/routes/admin/service-connections.ts`
- **Commit:** `dd827bf`

**2. [Rule 2 — Missing critical functionality] Clear-secret endpoint surfaced**
- **Found during:** Task 2 while reading CONTEXT D-18
- **Issue:** D-18 mandates a "Clear secret" escape hatch button in the UI. The plan enumerates three endpoints but the UI needs a fourth route to drive that button. Without it, P04 would either have to add a route (out of scope — P04 is the UI layer) or the button would be non-functional.
- **Fix:** Added `POST /admin/service-connections/:id/clear-secret` which calls `repo.clearSecret(id, userId)`, writes an audit entry with `action='service_connection.clear_secret'`, and best-effort reloads the registry.
- **Files modified:** `packages/dashboard/src/routes/admin/service-connections.ts`
- **Commit:** `dd827bf`

### Not done (deliberate)

- **No Zod dependency introduced** — manual validation matches established dashboard route style; plan gave Zod shape discretion to Claude.
- **No `:id` path typing narrowed via Fastify JSON schema** — the codebase does not use schema-based routing anywhere else; manual narrowing via `VALID_SERVICE_IDS` set lookup is consistent.

## Authentication Gates

None.

## Issues Encountered

None. Both RED→GREEN cycles passed on the first implementation attempt; the 12 integration tests all went green on the first run with no debugging required.

## User Setup Required

None — route layer only, no external services, no new env vars, no migrations.

## Next Plan Readiness

**Ready for 06-P04 (admin UI):**
- The GET endpoint returns exactly the masked shape the UI needs, including the `source` discriminator P04 will render as a "config fallback" badge.
- Blank-to-keep semantics work end-to-end — the UI can render a password input with a placeholder and the route layer will preserve the existing secret when an empty string is posted.
- The test endpoint is ready for a "Test" button on each row; the UI can post the current form values (even with a blank secret) and the route will fall back to the stored value automatically.
- The clear-secret endpoint backs the explicit "Clear secret" button mandated by D-18.
- Audit and runtime reload are wired at the route boundary, so the UI plan is purely Handlebars + HTMX — no further server-side work needed.

**No blockers.** SVC-01 (list), SVC-02 (edit), SVC-03 (masked), SVC-04 (test), SVC-06 (runtime reload), and SVC-08 (admin-only) are all demonstrably satisfied by the integration test suite.

## Self-Check: PASSED

- `packages/dashboard/src/services/service-connection-tester.ts` — FOUND
- `packages/dashboard/src/routes/admin/service-connections.ts` — FOUND
- `packages/dashboard/tests/services/service-connection-tester.test.ts` — FOUND
- `packages/dashboard/tests/routes/admin-service-connections.test.ts` — FOUND
- `packages/dashboard/src/server.ts` contains `registerServiceConnectionsRoutes` — FOUND
- Commit `041c6fd` (tester RED) — FOUND
- Commit `bf9cc8a` (tester GREEN) — FOUND
- Commit `dd827bf` (route plugin + wiring) — FOUND
- Commit `8cb107b` (integration tests) — FOUND
- Tester tests: 7/7 passing
- Integration tests: 12/12 passing
- Phase-06 targeted run: 39/39 passing
- Full dashboard suite: 2131 passing / 40 skipped (no regressions)
- `tsc --noEmit`: clean
- GET response schema includes `source` on every item — verified in test "returns 200 with three connections..."
- `grep source: 'config'` in service-connections.ts — FOUND (3 occurrences in `synthesizeFromConfig`)
- `grep 'service_connection.update'` in service-connections.ts — FOUND
- `grep serviceClientRegistry.reload` equivalent (`registry.reload`) in service-connections.ts — FOUND
- `grep 'clientSecret'` in service-connections.ts — every occurrence is inside input parsing; none on any response shape (verified by reviewing `maskConnection` which strips it)

---
*Phase: 06-service-connections-ui*
*Completed: 2026-04-05*
