---
phase: 38-multi-org-context-switching
plan: 01
subsystem: dashboard/persistence
tags: [aorg-03, persistence, migration, sqlite, user-repository]
requires:
  - phase: 37-streaming-ux-polish
    provides: migration 060 (last existing migration id)
provides:
  - migration 061 (dashboard_users.active_org_id)
  - DashboardUser.activeOrgId field
  - UserRepository.setActiveOrgId(userId, orgId | null) method
affects:
  - 38-02..04 (route + UI plans persist via this primitive)
  - resolveAgentOrgId in routes/agent.ts (will read activeOrgId in Plan 38-03)
tech-stack:
  added: []
  patterns:
    - Single parameterised UPDATE keyed on dashboard_users.id (PK)
    - Row mapper surfacing nullable column as `string | null`
    - Migration appended at next free id (061) without index — small cardinality
key-files:
  created:
    - packages/dashboard/tests/db/user-repository.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/interfaces/user-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/user-repository.ts
key-decisions:
  - "Migration 061 ALTER TABLE adds nullable TEXT column with no default — NULL semantics = 'use computed default at read-time'."
  - "No index on active_org_id — lookups go via dashboard_users.id (PK); cardinality is tiny (3 orgs in prod)."
  - "Repo trusts its inputs — admin.system gating and org-membership validation live in routes/agent.ts (Plan 38-03), per threat-register T-38-03 disposition."
  - "DashboardUser.activeOrgId is always present (never undefined) — keeps the public type stable; null = 'unset'."
patterns-established:
  - "Append migrations at the next sequential id with a brief header comment naming the requirement (e.g. AORG-03) — matches phase 37's id convention."
  - "Row mapper coerces nullable DB columns via `?? null` to keep TS shape predictable."
requirements-completed: [AORG-03]
duration: ~10 min
completed: 2026-04-24
---

# Phase 38 Plan 01: active_org_id Persistence Summary

**Adds the storage bedrock under D-Persistence / AORG-03 — migration 061 puts a nullable `active_org_id` column on `dashboard_users`, the row mapper surfaces it as `DashboardUser.activeOrgId`, and `UserRepository.setActiveOrgId(userId, orgId | null)` provides the single write primitive every downstream plan in the phase will consume.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-24T12:43Z
- **Completed:** 2026-04-24T12:46Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4
- **Files created:** 1
- **Tests added:** 12 (5 migration + 7 repository)

## Accomplishments

- Migration 061 (`agent-active-org`) registered immediately after 060.
  Single-statement `ALTER TABLE dashboard_users ADD COLUMN active_org_id TEXT;`
  No NOT NULL, no default, no index.
- `DashboardUser` extended with `activeOrgId: string | null` — always
  present, surfaced from every existing finder (`getUserById`,
  `getUserByUsername`, `listUsers`, `listUsersForOrg`).
- `UserRepository.setActiveOrgId` — parameterised
  `UPDATE dashboard_users SET active_org_id = @orgId WHERE id = @userId`,
  returns `info.changes > 0`.
- Tests cover: column type/nullability, idempotent migration,
  set/clear/unknown-user/idempotency, and `listUsers` surfacing the
  column for both populated and null rows.

## Task Commits

1. **Task 1+2 RED: failing migration + setActiveOrgId tests** — `8023fd9` (test)
2. **Task 1 GREEN: migration 061** — `24592b7` (feat)
3. **Task 2 GREEN: UserRepository.activeOrgId + setActiveOrgId** — `f0449c6` (feat)

(Tasks 1 and 2 share the same RED commit because the plan called for
adding tests to the same `tests/db/user-repository.test.ts` file in both
tasks — splitting RED commits would have produced churn for no
verification benefit. Both task GREEN commits are independent.)

## Files Created/Modified

- `packages/dashboard/src/db/sqlite/migrations.ts` — appended migration
  061 entry (id `'061'`, name `'agent-active-org'`).
- `packages/dashboard/src/db/types.ts` — `DashboardUser.activeOrgId: string | null`.
- `packages/dashboard/src/db/interfaces/user-repository.ts` —
  `setActiveOrgId(userId, orgId | null): Promise<boolean>` interface
  method with contract docstring.
- `packages/dashboard/src/db/sqlite/repositories/user-repository.ts` —
  `UserRow` extended with `active_org_id`; row mapper surfaces it;
  `getUserById` / `getUserByUsername` / `listUsers` SELECT lists include
  `active_org_id`; `listUsersForOrg` uses `du.*` and inherits the column;
  new `setActiveOrgId` implementation.
- `packages/dashboard/tests/db/user-repository.test.ts` (new) — 5
  migration assertions + 7 repository assertions.

## Decisions Made

- **No index on active_org_id** — tiny cardinality (3 orgs in prod) and
  lookups always go via `dashboard_users.id` (PK), so an index would only
  cost write throughput. Documented inline in the migration SQL header.
- **`activeOrgId` is always present (never undefined)** on
  `DashboardUser` — keeps the public type narrow; consumers never need to
  guard against `undefined` separate from `null`.
- **RED tests for both tasks live in the same file**, committed once.
  The plan named `tests/db/user-repository.test.ts` for both tasks, and
  splitting the RED commit would not have changed verification — Task 1
  GREEN already turned the 5 migration tests green, leaving only the 7
  repo tests red until Task 2 GREEN. The progression was visible in the
  commit-by-commit `vitest` output captured during execution.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan referenced `findById(userId)` which is not the actual method name**

- **Found during:** Task 2 planning.
- **Issue:** Plan task 2 behaviour block said "`findById(userId)` returns
  `activeOrgId` populated from the new column". The actual interface
  method is `getUserById(id)` (see
  `packages/dashboard/src/db/interfaces/user-repository.ts`); there is no
  `findById`.
- **Fix:** Wired `activeOrgId` through the existing finders
  (`getUserById`, `getUserByUsername`, `listUsers`, `listUsersForOrg` via
  `du.*`) and asserted the contract in tests using the real method
  names. End-state matches the plan's intent.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/user-repository.ts`,
  `packages/dashboard/tests/db/user-repository.test.ts`.
- **Verification:** All 7 repo tests pass; 502/503 db+repositories
  regression tests pass (the 1 failure is pre-existing and out of scope —
  see "Deferred Issues" below).
- **Committed in:** `f0449c6`.

---

**Total deviations:** 1 auto-fixed (Rule 3 — pure naming-mismatch).
**Impact on plan:** None. The deviation is a paper-vs-reality fix; the
plan's intent (read activeOrgId on the standard finders) is preserved.

## Deferred Issues

**1. Pre-existing test failure in `tests/db/migration-058-059.test.ts`**

- **Test:** `migration 059 — agent-share-links > creates agent_share_links table with the expected columns`
- **Reason:** Migration 060 (Phase 37, prior plan) added the
  `expires_at` column to `agent_share_links`, but the column-list
  assertion in the 058-059 test was never updated to include it.
  Verified pre-existing by running `git stash` + the failing test on
  `master @ 24592b7` (Task 1 GREEN, before any Task 2 changes) — it
  still fails. Out of scope for this plan; logged here for the
  verifier / future maintenance.

## Issues Encountered

None beyond the deviation documented above.

## Authentication Gates

None — pure data-layer work.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-38-01 (Tampering on setActiveOrgId) | mitigate | ✓ Single parameterised UPDATE; WHERE keyed on `id = @userId`; no string concat. |
| T-38-02 (Information disclosure on active_org_id) | accept | ✓ Column stores public org id only; no PII added. |
| T-38-03 (Elevation of privilege via setActiveOrgId) | mitigate | ✓ Repo intentionally a thin write primitive — admin.system gate documented in interface contract; route layer (Plan 38-03) enforces caller identity. |

## Threat Flags

None — no new network endpoints introduced. Surface is internal
repository methods only.

## Known Stubs

None — migration applied, repository methods fully implemented and
exercised by tests.

## Verification

- `cd packages/dashboard && npx vitest run tests/db/user-repository.test.ts` — 12/12 pass.
- `cd packages/dashboard && npx tsc --noEmit` — exits 0.
- `cd packages/dashboard && npx vitest run tests/db tests/repositories` —
  502/503 pass (1 failure pre-existing, see Deferred Issues).
- Migration 061 idempotent: `MigrationRunner.run` invoked twice on a
  fresh in-memory DB does not throw and produces exactly one
  `active_org_id` column (asserted by test).

## Next Phase Readiness

- Plan 38-02 (resolveAgentOrgId extension) can now read
  `user.activeOrgId` and fall back to a computed default.
- Plan 38-03 (POST `/agent/active-org` route) can call
  `storage.users.setActiveOrgId` directly.
- Plan 38-04 (drawer switcher UI) has no new dependencies on this plan,
  but inherits the route from 38-03.

## Self-Check

- `packages/dashboard/src/db/sqlite/migrations.ts` migration 061 entry — FOUND (`id: '061'`, `ALTER TABLE dashboard_users ADD COLUMN active_org_id TEXT`)
- `packages/dashboard/src/db/types.ts` — FOUND (`DashboardUser.activeOrgId: string | null`)
- `packages/dashboard/src/db/interfaces/user-repository.ts` — FOUND (`setActiveOrgId` declared)
- `packages/dashboard/src/db/sqlite/repositories/user-repository.ts` — FOUND (`setActiveOrgId` implemented; SELECTs include `active_org_id`)
- `packages/dashboard/tests/db/user-repository.test.ts` — FOUND
- Commit `8023fd9` (RED) — FOUND
- Commit `24592b7` (Task 1 GREEN — migration 061) — FOUND
- Commit `f0449c6` (Task 2 GREEN — repository) — FOUND
- Vitest user-repository.test.ts: 12/12 pass
- `tsc --noEmit`: clean

## Self-Check: PASSED

---
*Phase: 38-multi-org-context-switching*
*Completed: 2026-04-24*
