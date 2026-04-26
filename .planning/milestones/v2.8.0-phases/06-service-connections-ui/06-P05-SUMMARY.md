---
phase: 06-service-connections-ui
plan: 05
subsystem: dashboard-integration-tests
tags: [integration-tests, fastify-inject, sqlite, encryption, htmx, rbac, coverage]

# Dependency graph
requires: [06-01, 06-02, 06-03, 06-04]
provides:
  - End-to-end save → reload → GET flow verification with a real SqliteStorageAdapter + real ServiceClientRegistry (ServiceTokenManager/createLLMClient mocked at module scope)
  - Encryption-at-rest proof via raw SQLite ciphertext inspection
  - Bootstrap + per-service config fallback + DB-wins-over-config coverage
  - Non-admin 403 gating across all four admin endpoints with zero-audit-write assertion
  - HTMX content-negotiation coverage for save, test, clear-secret, /edit, /row
  - Phase 06 line-coverage gate (≥80%) met on all five new source files
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fastify inject integration test with real storage + real registry + module-level mocks for network clients"
    - "Partial Handlebars helper registration inside tests (t + eq) so HTMX fragment responses can compile without spinning up server.ts"
    - "Raw SQLite ciphertext assertions (SELECT client_secret_encrypted) to prove encryption at rest directly at the byte level"
    - "Registry sabotage via runtime method replacement to exercise reload-failure 500 path without touching production code"

key-files:
  created:
    - packages/dashboard/tests/integration/service-connections-flow.test.ts
    - packages/dashboard/tests/integration/service-connections-fallback.test.ts
  modified: []

key-decisions:
  - "Used tests/integration/ (plural) to match the dashboard package convention — plan text says test/integration but vitest.config.ts and every other dashboard integration test uses tests/integration/. Same Rule 3 call as P02."
  - "Registered only the t and eq handlebars helpers inside the tests (not the full 30+ helper set from server.ts) — the two service-connection-row partials use nothing else, and loading the full server.ts path would add cost and flakiness for zero benefit."
  - "Used a fresh on-disk SQLite file per test (tmpdir + randomUUID) rather than :memory: so that the raw ciphertext SELECT is reading the exact file the repository wrote to, closing any possibility of in-memory shortcut."
  - "Sabotaged ctx.registry.reload by assigning a throwing function on the instance rather than mocking the module — keeps the rest of the registry real and proves the route's try/catch + HTMX 500 branch exactly as a deployed instance would behave."
  - "Extended the existing Task 1/2 files to close the coverage gap (Task 3 deviation) rather than creating a third test file, as the plan explicitly mandates."

patterns-established:
  - "Pattern: Phase-06 integration test boilerplate — vi.mock() both service-token.js and llm-client.js at module scope, then dynamic-import everything else, then register t/eq handlebars helpers."
  - "Pattern: Raw-ciphertext assertion — prepare('SELECT client_secret_encrypted FROM service_connections WHERE service_id = ?').get(id) immediately after a save/bootstrap to assert the plaintext is not present as a substring."
  - "Pattern: Registry sabotage for reload-failure branches — overwrite ctx.registry.reload at runtime with a throwing function; the real registry is otherwise untouched."

requirements-completed: [SVC-05, SVC-06, SVC-07, SVC-08]

# Metrics
duration: 13min
completed: 2026-04-05
---

# Phase 06 Plan 05: End-to-End Verification Summary

**Phase 06 is done — two integration test files (`service-connections-flow.test.ts`, `service-connections-fallback.test.ts`) prove the full save → reload → GET → test → clear-secret pipeline against a real SQLite-backed dashboard with a real `ServiceClientRegistry`, covering encryption at rest, runtime client hot-swap, per-service config fallback, DB-wins-over-config, admin-only RBAC, HTMX content-negotiation for every endpoint, and 400-validation branches. All five Phase 06 source files are ≥80% line-covered and the full dashboard suite runs 2147 passing / 40 skipped with zero regressions.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-05T12:27:00Z
- **Completed:** 2026-04-05T12:40:00Z
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 0 (production) / 2 (tests — Task 3 coverage extensions to the files created in Tasks 1-2)

## Accomplishments

### Task 1 — End-to-end flow test (SVC-05 / SVC-06)

Six integration cases in `tests/integration/service-connections-flow.test.ts`:

1. **Save triggers a real registry reload + encryption at rest + audit row.** Captures the registry reference before the save, inject POSTs `/admin/service-connections/compliance`, asserts `before !== after`, the new instance carries the new url/clientId/clientSecret, the old instance was destroyed, GET never leaks the plaintext, raw SQLite `client_secret_encrypted` does NOT contain the plaintext substring (SVC-05), and `audit_log` has a matching row with actor=`e2e-admin` and no plaintext in the details JSON.
2. **Blank-to-keep preserves ciphertext.** Save, capture ciphertext, save again with `clientSecret: ''`, assert the new ciphertext is byte-identical to the previous one while the URL and clientId did update. The live registry still decrypts to the original secret.
3. **`/test` stored-secret fallback.** Install a stored secret, then POST `/test` with `clientSecret: ''`. A fetch spy on `globalThis.fetch` asserts the outbound `/oauth/token` body contains the stored plaintext — proving the decrypt path was exercised.
4. **HTMX save response is a row fragment + OOB toast.** POST with `hx-request: true`, assert 200 + `Content-Type: text/html`, body contains `service-connection-row-compliance`, `hx-swap-oob`, `toast-container`, and NOT the plaintext secret.
5. **HTMX `/test` success badge.** Spy on fetch to succeed both OAuth and health, POST `/test` with HTMX header, assert response is a success badge HTML fragment (`badge--success`) containing no plaintext.

### Task 2 — Fallback + permissions test (SVC-07 / SVC-08)

Ten integration cases in `tests/integration/service-connections-fallback.test.ts`:

1. **Full config → empty DB bootstrap imports all three rows.** Raw SELECT confirms three rows, all with `updated_by='bootstrap-from-config'` and `client_secret_encrypted` not containing the plaintext config secrets. Registry resolves all three to live clients.
2. **Partial config → only compliance imported; branding/llm fall back per-service.** Raw SELECT shows exactly one row (compliance). Registry builds compliance from DB, and `getBrandingTokenManager()` / `getLLMClient()` return null without throwing (empty config → null is the correct D-14 behaviour). Admin GET still returns three rows with `source='db'` for compliance and `source='config'` for the synthesized branding/llm rows.
3. **Non-admin 403 + zero audit writes.** Viewer role receives 403 on GET list, POST update, POST test, POST clear-secret. Audit log query for both `service_connection.update` and `service_connection.clear_secret` returns zero entries.
4. **DB wins over config on subsequent boots (D-12).** Pre-seed a compliance row with a URL different from config, then boot with `importFromConfigIfEmpty`. The pre-seeded row is untouched (URL matches seed, `updated_by='seed-script'`, no `bootstrap-from-config` rows), branding/llm correctly fall back to config values.
5. **POST `/clear-secret` JSON path.** Cleared row has empty `client_secret_encrypted` and an audit row with action `service_connection.clear_secret`, actor `e2e-admin`.
6. **HTMX POST `/clear-secret`.** Returns row fragment + OOB `secretCleared` toast targeting global `toast-container`.
7. **HTMX save reload-failure 500.** Registry's `reload` method is sabotaged at runtime to throw. Response is 500 with row fragment + error toast containing the simulated error message. DB row is still updated (exception-safe registry keeps the write separate from the swap).
8. **HTMX `/test` failure badge.** Mock fetch returns 401 for `/oauth/token`, POST with HTMX header, assert `badge--error` fragment returned.
9. **GET `/:id/edit` and GET `/:id/row` fragment endpoints.** Both return HTML fragments rooted on `service-connection-row-compliance`; edit partial never carries the plaintext secret (type=password, no `value=`).
10. **400 validation branches.** Invalid service id on every endpoint (`/edit`, `/row`, `/clear-secret`, `/test`), invalid url (empty string), non-string clientId, non-string clientSecret — all return the documented 400 error shape.

### Task 3 — Regression + coverage gate

- `tsc --noEmit` on `packages/dashboard` — clean.
- Full dashboard `vitest run` — **2147 passing / 40 skipped / 118 test files**. Previous baseline was 2131, so the 16 new cases are all accounted for with zero regressions.
- Scoped coverage run against Phase 06 source files returned:

  | File | Lines | Statements | Branches | Functions |
  |---|---|---|---|---|
  | `src/db/sqlite/service-connections-sqlite.ts` | **95.45%** | 95.65% | 90.00% | 100% |
  | `src/services/service-client-registry.ts` | **96.87%** | 93.05% | 86.66% | 100% |
  | `src/services/service-connection-tester.ts` | **89.65%** | 81.25% | 82.35% | 60% |
  | `src/services/service-connections-bootstrap.ts` | **100.00%** | 100% | 66.66% | 100% |
  | `src/routes/admin/service-connections.ts` | **96.05%** | 95.45% | 81.19% | 100% |

  All files exceed the 80% line-coverage gate. The `tester.ts` functions metric sits at 60% because the 10s `AbortSignal.timeout` error branches are unit-tested at the helper level in P03 tests but not re-covered here — the line/statement coverage captures the bulk of the logic and the plan's gate is line-based.

  Initial Task 3 run showed `routes/admin/service-connections.ts` at 50.65% lines (HTMX branches + clear-secret handler unreached). Per the plan's Task 3 directive, I extended the existing Tasks 1/2 files — no new test files — adding seven more cases that exercise HTMX save success, HTMX reload-failure 500, HTMX test success/failure, JSON and HTMX clear-secret, GET /edit and /row fragments, and the full 400-validation matrix. Post-extension the admin route is at 96.05% lines.

## Task Commits

1. **Task 1 — Flow integration test (3 cases, TDD)**
   - `128a240` — `test(06-05): end-to-end flow integration for service connections`
2. **Task 2 — Fallback + permissions test (4 cases, TDD)**
   - `0c1c3fb` — `test(06-05): bootstrap + per-service fallback + 403 gating integration`
3. **Task 3 — Coverage-gap extensions to Tasks 1/2 (9 additional cases, verification gate)**
   - `787abd3` — `test(06-05): extend P05 integration tests to cover HTMX + clear-secret paths`

All commits use `--no-verify` per parallel executor convention.

## Files Created/Modified

**Created:**
- `packages/dashboard/tests/integration/service-connections-flow.test.ts` — 6 test cases (save→reload→GET, blank-to-keep, test-fallback, HTMX save, HTMX test success)
- `packages/dashboard/tests/integration/service-connections-fallback.test.ts` — 10 test cases (full/partial bootstrap, 403 gating, DB-wins, clear-secret JSON/HTMX, reload-failure 500, HTMX test failure, /edit, /row, 400 validation matrix)

**Modified:** None in production code — tests only. The two test files above were extended in Task 3 to close the coverage gap, which counts as the same artifact not a new file.

## Decisions Made

- **`tests/integration/` (plural) instead of `test/integration/` (singular).** The plan text uses the singular form but the dashboard vitest config and every other existing integration test uses the plural. Same Rule 3 call P02 made.
- **Real registry + module-level mocks of `service-token.js` / `llm-client.js`.** The flow test must observe a true registry reference swap (`before !== after`), so it cannot use the fake registry the P03 route tests use. Mocking the two client constructors at module scope keeps the rest of the code path real while removing the network dependency.
- **Minimal handlebars helper set.** Only `t` and `eq` are registered, because those are the only helpers the two partial templates use. Loading the full `server.ts` bootstrap path would add ~30 helpers and several plugin registrations for no benefit; keeping it minimal makes the test fast and the failure surface obvious.
- **On-disk SQLite (tmpdir + randomUUID) over `:memory:`.** The raw ciphertext SELECT needs to be reading the exact file the repository wrote to — any caching layer between the two would weaken the SVC-05 proof. On-disk files are also deleted per-test, so isolation is preserved.
- **Registry sabotage via method replacement.** For the reload-failure 500 test I assign a throwing function directly to `ctx.registry.reload`. Production code is untouched and the entire rest of the registry (getters, repo wiring, builder) is real. Alternative would have been a separate mock registry class — more code for less realism.
- **Task 3 extends Tasks 1/2 files, not a third file.** Plan is explicit: "extend the existing tests from Tasks 1/2, do not create new test files." The two extensions land in a single Task 3 commit that is distinct from the Task 1/2 commits so the coverage-gap fix is traceable.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Path convention] `tests/integration/` instead of `test/integration/`**
- **Found during:** Task 1 file creation
- **Issue:** Plan text uses `test/integration/` but the dashboard package's vitest config scans `tests/**/*.test.ts` (plural). Same call P02 made for `tests/services/`.
- **Fix:** Created both test files at `packages/dashboard/tests/integration/`.
- **Commit:** `128a240`, `0c1c3fb`

**2. [Rule 3 — Coverage gap fix] HTMX branches + clear-secret handler were unreached**
- **Found during:** Task 3 scoped coverage run
- **Issue:** After Tasks 1-2, `routes/admin/service-connections.ts` was at 50.65% lines — the HTMX branches (save, test), the entire `/clear-secret` handler, the `/edit` and `/row` fragment endpoints, and several 400 validation branches were all unreached.
- **Fix:** Extended `service-connections-flow.test.ts` with 3 more cases (HTMX save, HTMX test success, HTMX test with stored-secret was already present but now joined by success-badge and reload branches). Extended `service-connections-fallback.test.ts` with 7 more cases covering clear-secret JSON + HTMX, HTMX reload-failure 500, HTMX test failure, /edit and /row fragment endpoints, and the full 400 validation matrix.
- **Outcome:** Admin route coverage went from 50.65% → 96.05% lines. All Phase 06 files now clear the 80% gate.
- **Commit:** `787abd3`

### Not done (deliberate)

- **No new test files in Task 3** — per plan directive. All extensions land inside the Tasks 1/2 files.
- **No production code modified** — Task 3 is verification-only and neither the coverage gap nor any test revealed a production bug.
- **No byte-comparison of `dashboard.config.json` on disk** — the plan's orientation mentions "Config file never rewritten (D-15)" as a potential scenario. In practice the route handler has no code path that writes to the config file at all (it only reads `config: ConfigSnapshot`), so the assertion would be tautological and the test fixture doesn't ever create a config file. D-15 is guaranteed by construction rather than by assertion.

## Authentication Gates

None. All tests use `fastify.inject` against an in-memory-seeded admin or viewer user.

## Issues Encountered

- **Handlebars helpers not registered by default.** First HTMX-branch attempt failed with `Missing helper: "t"` because the test harness does not spin up `server.ts`. Fixed by registering `t` and `eq` on the `handlebars` singleton inside the test file's module setup (before any `describe` block). `loadTranslations()` must also be called so `t` can resolve keys.
- **Coverage run reports 80% global threshold failure.** Expected — scoping the coverage run to the Phase 06 tests only means the rest of the dashboard codebase reports 0% line coverage and the global threshold in `vitest.config.ts` fails. The per-file coverage numbers for the five Phase 06 files (reported in the table above) are what the plan's gate actually requires; all clear 80% lines.

## User Setup Required

None. Pure test-layer additions.

## Known Stubs

None. Every production file touched by Phase 06 is ≥89% line-covered and exercised through the real Fastify inject path, the real SQLite repository, and the real registry. No placeholder data, no TODO markers, no hardcoded mock values flowing to UI.

## Next Plan Readiness

**Phase 06 is COMPLETE.**

- SVC-01 (list) — covered by P03 integration tests and this plan's GET list assertions.
- SVC-02 (edit) — covered by this plan's save → reload → GET round-trip, JSON and HTMX paths.
- SVC-03 (masked) — covered by every test's `expect(payload).not.toContain(plaintext)` assertion and the `hasSecret`-only wire shape.
- SVC-04 (test) — covered by this plan's `/test` success, failure, blank-fallback, and HTMX-badge cases.
- SVC-05 (encryption at rest) — covered by raw SQLite ciphertext inspection in the flow test and both bootstrap assertions in the fallback test.
- SVC-06 (runtime reload) — covered by the `before !== after` registry reference assertion and the destroyed-old-instance check.
- SVC-07 (config fallback) — covered by partial-config, full-config, and DB-wins fallback tests.
- SVC-08 (admin-only) — covered by this plan's four 403 assertions with zero-audit-write verification.

**Ready for Phase 07 (Regulation Filter).** The admin page patterns, OAuth client management, and integration test harness established here are reusable.

## Self-Check: PASSED

- `packages/dashboard/tests/integration/service-connections-flow.test.ts` — FOUND
- `packages/dashboard/tests/integration/service-connections-fallback.test.ts` — FOUND
- Commit `128a240` (Task 1 — flow test) — FOUND
- Commit `0c1c3fb` (Task 2 — fallback test) — FOUND
- Commit `787abd3` (Task 3 — coverage extensions) — FOUND
- Flow test: 6/6 passing
- Fallback test: 10/10 passing
- Phase-06 targeted integration run: 16/16 passing
- Full dashboard suite: 2147 passing / 40 skipped / 118 test files — zero regressions
- `cd packages/dashboard && npx tsc --noEmit` — clean
- Line coverage ≥80% on all five Phase 06 files (95.45%, 96.87%, 89.65%, 100%, 96.05%)
- No production code modified in this plan — tests only (plan is verification-only, extensions stayed inside the Task 1/2 files per plan directive)

---
*Phase: 06-service-connections-ui*
*Completed: 2026-04-05*
