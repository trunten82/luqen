---
phase: 06-service-connections-ui
plan: 01
subsystem: database
tags: [sqlite, encryption, aes-256-gcm, repository-pattern, oauth, better-sqlite3, vitest]

# Dependency graph
requires: []
provides:
  - SQLite migration 038 creating the service_connections table (encrypted-at-rest secrets)
  - ServiceConnectionsRepository interface with list/get/upsert/clearSecret + blank-to-keep semantics
  - ServiceConnection type carrying a source: 'db' | 'config' discriminator for per-service fallback
  - SqliteServiceConnectionsRepository implementation using existing encryptSecret/decryptSecret helpers
  - importFromConfigIfEmpty bootstrap helper that imports config values into the DB on first boot only
affects: [06-P02-client-registry, 06-P03-admin-route, 06-P04-admin-ui, 06-P05-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repository pattern with Database injection + prepared statements (mirrors SqliteApiKeyRepository)"
    - "Blank-to-keep secret update: null preserves existing ciphertext, '' clears, string re-encrypts"
    - "Empty-secret short-circuit: '' is stored as-is and NEVER passed to decryptSecret (handles D-06 without throwing)"
    - "source discriminator ('db' | 'config') so route handlers can synthesize per-service fallback rows"

key-files:
  created:
    - packages/dashboard/src/db/service-connections-repository.ts
    - packages/dashboard/src/db/sqlite/service-connections-sqlite.ts
    - packages/dashboard/src/services/service-connections-bootstrap.ts
    - packages/dashboard/tests/db/service-connections-repository.test.ts
    - packages/dashboard/tests/services/service-connections-bootstrap.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts

key-decisions:
  - "Reused existing encryptSecret/decryptSecret keyed on config.sessionSecret — no new crypto code (D-05)"
  - "Empty client_secret_encrypted column short-circuits decrypt to avoid throwing on the unset case (D-06)"
  - "upsert uses INSERT ... ON CONFLICT DO UPDATE with separate SQL branches for null (keep) vs explicit (replace) secret"
  - "Repository always stamps source='db'; the 'config' value is synthesized only by the admin route handler (W3)"
  - "Bootstrap skips services whose URL is missing/empty so they can fall back to config per-service (D-14)"

patterns-established:
  - "Pattern: Encrypt-at-rest secrets reuse plugins/crypto.ts helpers keyed on sessionSecret"
  - "Pattern: Blank-to-keep UX mirrored from routes/git-credentials.ts (null/''/string tri-state)"
  - "Pattern: Integration-style repository tests use SqliteStorageAdapter + getRawDatabase() for real migrations"

requirements-completed: [SVC-05, SVC-07]

# Metrics
duration: 16min
completed: 2026-04-05
---

# Phase 06 Plan 01: Storage Foundation Summary

**Encrypted-at-rest SQLite storage for the three outbound service connections (compliance, branding, LLM), with a blank-to-keep repository API and a first-boot config→DB bootstrap helper — zero new dependencies, full reuse of existing crypto utilities.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-05T11:16:00Z
- **Completed:** 2026-04-05T11:21:37Z
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 1

## Accomplishments

- Delivered migration 038 (`service_connections` table) matching the exact schema from CONTEXT D-04 — no squashing into existing migrations, strictly greater version.
- Landed `ServiceConnectionsRepository` contract and `ServiceConnection` type including the `source: 'db' | 'config'` discriminator (W3) that downstream plans need to distinguish persistent rows from synthesized fallbacks.
- Implemented `SqliteServiceConnectionsRepository` with full encrypt/decrypt roundtrip, empty-secret short-circuit, blank-to-keep semantics, and atomic `clearSecret`.
- Added `importFromConfigIfEmpty` bootstrap helper with partial-config support (per-service skipping) and structured INFO logging per imported row.
- 13/13 integration tests pass (9 repository + 4 bootstrap); `tsc --noEmit` clean; zero deviations from the plan.

## Task Commits

1. **Task 1 — Migration + repository interface**
   - `8029906` (test: failing tests for service_connections table + repository contract)
   - `1b12ab4` (feat: migration 038 + `service-connections-repository.ts`)
2. **Task 2 — SqliteServiceConnectionsRepository with encryption**
   - `a0ee312` (feat: encryption, blank-to-keep, source='db' stamping — 9/9 tests green)
3. **Task 3 — Bootstrap helper (config → DB on first boot)**
   - `0ead646` (test: failing bootstrap tests including partial-config case)
   - `d6b7acb` (feat: `importFromConfigIfEmpty` — 4/4 tests green)

All commits use `--no-verify` per parallel executor convention.

## Files Created/Modified

**Created:**
- `packages/dashboard/src/db/service-connections-repository.ts` — `ServiceId`, `ServiceConnection`, `ServiceConnectionsRepository`, `ServiceConnectionUpsertInput` exports
- `packages/dashboard/src/db/sqlite/service-connections-sqlite.ts` — SQLite implementation with AES-256-GCM via existing helpers
- `packages/dashboard/src/services/service-connections-bootstrap.ts` — `importFromConfigIfEmpty(repo, config, logger)` helper
- `packages/dashboard/tests/db/service-connections-repository.test.ts` — 9 integration tests against real SQLite migrations
- `packages/dashboard/tests/services/service-connections-bootstrap.test.ts` — 4 bootstrap tests (no-op, full import, partial config, encryption-at-rest)

**Modified:**
- `packages/dashboard/src/db/sqlite/migrations.ts` — appended migration `038 create-service-connections` (strictly > 037)

## Decisions Made

- **Reuse `sessionSecret` as encryption key** — matches git-credentials and plugin-config patterns; minimizes crypto surface area; deferred to a dedicated key per CONTEXT deferred list.
- **Two SQL branches in `upsert`** (one with `excluded.client_secret_encrypted`, one without) instead of a single `COALESCE` expression — clearer semantics for reviewers, keeps the "don't touch ciphertext" path impossible to get wrong.
- **Empty secret bypasses `decryptSecret`** — the cipher would throw on empty input; short-circuit makes the "unset" path a first-class state without special NULL handling in SQL.
- **Tests use `SqliteStorageAdapter` + `getRawDatabase()`** rather than a handwritten in-memory DB — guarantees the real migration runner actually applies migration 038, so if the CREATE TABLE SQL were wrong the tests would catch it.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met; no Rule 1/2/3 auto-fixes required; no Rule 4 architectural decisions triggered.

## Issues Encountered

None. The TDD RED→GREEN cycle passed cleanly on first attempt for both Task 2 and Task 3 implementations.

## User Setup Required

None — storage-layer work only, no external services or env vars introduced.

## Next Phase Readiness

**Ready for 06-P02 (client registry):**
- Repository is the only consumer of encryption in this plan; the registry can inject the same `SqliteServiceConnectionsRepository` and call `list()`/`get()` per-request.
- `source: 'db' | 'config'` discriminator is in place for the admin route (P03) to synthesize fallback rows without the registry or repo caring.
- Bootstrap helper is ready to be wired into `server.ts` startup (post-`migrate()`, pre-registry-construction) in a later plan.

**No blockers.** SVC-05 (encrypted at rest) and SVC-07 (config fallback path) are structurally addressable by downstream plans.

## Self-Check: PASSED

- `packages/dashboard/src/db/service-connections-repository.ts` — FOUND
- `packages/dashboard/src/db/sqlite/service-connections-sqlite.ts` — FOUND
- `packages/dashboard/src/services/service-connections-bootstrap.ts` — FOUND
- `packages/dashboard/tests/db/service-connections-repository.test.ts` — FOUND
- `packages/dashboard/tests/services/service-connections-bootstrap.test.ts` — FOUND
- Migration 038 in `packages/dashboard/src/db/sqlite/migrations.ts` — FOUND
- Commit `8029906` (test repo) — FOUND
- Commit `1b12ab4` (migration + interface) — FOUND
- Commit `a0ee312` (sqlite impl) — FOUND
- Commit `0ead646` (test bootstrap) — FOUND
- Commit `d6b7acb` (bootstrap impl) — FOUND
- Repository tests: 9/9 passing
- Bootstrap tests: 4/4 passing
- `tsc --noEmit`: clean

---
*Phase: 06-service-connections-ui*
*Completed: 2026-04-05*
