---
phase: 32-agent-service-chat-ui
plan: 03
subsystem: database
tags: [sqlite, migrations, organizations, agent-display-name, d-14, d-19, rbac-boundary]

requires:
  - phase: 31-conversation-persistence
    provides: agent_conversations + agent_messages + agent_audit_log tables that Plan 04 will write against
  - phase: 31.1-mcp-auth-spec-upgrade
    provides: schema_migrations runner already in place; oauth-* migrations 050-053
  - phase: 31.2-mcp-access-control-refinement
    provides: migration 054 (mcp.use backfill)
provides:
  - Migration 055 (agent-display-name) — nullable TEXT column on organizations
  - OrgRepository.updateOrgAgentDisplayName(orgId, displayName) — silent-no-op-on-missing parameterised write
  - Organization.agentDisplayName: string | null surfaced on getOrg / getOrgBySlug / listOrgs
affects: [32-04 agent-service-core, 32-08 admin-extensions, 33-agent-context]

tech-stack:
  added: []
  patterns:
    - "Nullable per-org knob pattern: ALTER TABLE ADD COLUMN TEXT, nullable, no default; read via `value ?? null`; writes accept null to clear"
    - "Silent-no-op-on-missing-orgId mutation — matches existing updateOrgComplianceClient/updateOrgBrandingClient/updateOrgLLMClient shape (differs from setBrandingMode/setBrandScoreTarget which throw)"

key-files:
  created:
    - "packages/dashboard/tests/db/migration-055-agent-display-name.test.ts"
    - "packages/dashboard/tests/repositories/org-repository-agent-display-name.test.ts"
  modified:
    - "packages/dashboard/src/db/types.ts (Organization gets agentDisplayName)"
    - "packages/dashboard/src/db/interfaces/org-repository.ts (OrgRepository gets updateOrgAgentDisplayName)"
    - "packages/dashboard/src/db/sqlite/migrations.ts (append migration 055)"
    - "packages/dashboard/src/db/sqlite/repositories/org-repository.ts (OrgRow + rowToOrg + updateOrgAgentDisplayName)"

key-decisions:
  - "Migration id is 055 not 050: plan's numbering was stale — 050-054 are occupied by Phase 31.1/31.2 (oauth-authorization-codes, oauth-refresh-tokens, oauth-user-consents, oauth-signing-keys, backfill-mcp-use-permission). Column name agent_display_name is unchanged."
  - "Repo is OrgRepository (storage.organizations), method is updateOrgAgentDisplayName — matches plan's method name verbatim but uses the codebase's existing repo naming convention (not the plan's aspirational 'OrganizationsRepository')."
  - "Empty string '' and null are distinct at the DB/type layer (plan Test 10): '' is an explicit caller choice, null is 'unset'. UI-layer fallback to 'Luqen Assistant' (D-19) treats both the same, but the data layer preserves the distinction so Plan 08's Zod-validated form can round-trip caller intent."
  - "No Zod validation at the repo layer: scope_reminders noted defence-in-depth Zod here, but the plan's Tests 9-10 explicitly allow 41+ chars / '<script>' / URLs to round-trip as-is (with no throw). Write-site validation is Plan 08's scope (Zod at the route). Repo layer defends against SQL injection via parameterised queries (T-32-03-01)."

patterns-established:
  - "Nullable string-column on organizations: ALTER TABLE ADD COLUMN TEXT, nullable, no default; repo row-mapper uses `?? null` to normalise undefined → null while preserving empty string; writer uses a single parameterised UPDATE statement"
  - "Silent-no-op write for an optional per-org knob — contrast with setBrandingMode / setBrandScoreTarget which throw on missing org"

requirements-completed:
  - APER-02

duration: 11min
completed: 2026-04-20
---

# Phase 32 Plan 03: Agent Display Name Schema & Repo Methods Summary

**Adds the D-14 per-org `agent_display_name` column to `organizations` via migration 055 and the matching `OrgRepository.updateOrgAgentDisplayName` write method, unblocking Plan 04 (system-prompt interpolation of `{agentDisplayName}`) and Plan 08 (org-settings form write path).**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-20T08:13:02Z
- **Completed:** 2026-04-20T08:24:04Z
- **Tasks:** 2/2 (RED + GREEN)
- **Files modified:** 4 source + 2 test = 6 total

## Accomplishments

- Migration 055 adds `organizations.agent_display_name TEXT` (nullable, no default). Idempotent re-run verified via `PRAGMA table_info` (single column instance after `storage.migrate()` runs twice).
- `Organization` type carries `agentDisplayName: string | null` everywhere — available on `getOrg`, `getOrgBySlug`, `listOrgs`, `getUserOrgs` with zero changes to existing callers (type is optional via `?`).
- `OrgRepository.updateOrgAgentDisplayName(orgId, name | null)` lands with full test coverage: null-default, roundtrip, null-reset, empty-string-not-coerced-to-null, nonexistent-org-silent-no-op, SQL-injection-payload-stored-literally.
- 13 new tests green (5 migration + 8 repository) + full tests/db/ + tests/repositories/ regression pass (439/439). Zero TypeScript errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing tests for migration 055 + updateOrgAgentDisplayName roundtrip** — `2837594` (test)
2. **Task 2: GREEN — migration 055 + OrgRepository extension** — `6db14bc` (feat)

_Note: Plan type: tdd. RED + GREEN gates present. REFACTOR was skipped — the implementation landed clean (parameterised query, `?? null` coalescer, unchanged `SELECT *` read path)._

## Files Created/Modified

### Tests (created)
- `packages/dashboard/tests/db/migration-055-agent-display-name.test.ts` — 5 tests covering migration registration, PRAGMA table_info column shape, nullability, idempotent re-run, positional ordering
- `packages/dashboard/tests/repositories/org-repository-agent-display-name.test.ts` — 8 tests covering getOrg default, roundtrip, null-reset, empty-string preservation, silent no-op on missing, listOrgs/getOrgBySlug exposure, SQL-injection guard (T-32-03-01)

### Source (modified)
- `packages/dashboard/src/db/types.ts` — added `agentDisplayName?: string | null` field to `Organization` interface, documenting null vs empty-string semantics
- `packages/dashboard/src/db/interfaces/org-repository.ts` — added `updateOrgAgentDisplayName(orgId, displayName): Promise<void>` to `OrgRepository` interface
- `packages/dashboard/src/db/sqlite/migrations.ts` — appended migration `{ id: '055', name: 'agent-display-name', sql: 'ALTER TABLE organizations ADD COLUMN agent_display_name TEXT;' }`
- `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — added `agent_display_name: string | null` to `OrgRow`, added `agentDisplayName: row.agent_display_name ?? null` in `rowToOrg`, implemented `updateOrgAgentDisplayName` with parameterised UPDATE

## Verification Results

- `cd packages/dashboard && npx vitest run tests/db/migration-055-agent-display-name.test.ts tests/repositories/org-repository-agent-display-name.test.ts` — **13/13 green**
- `cd packages/dashboard && npx vitest run tests/db/ tests/repositories/` — **439/439 green** (no regression)
- `cd packages/dashboard && npx tsc --noEmit` — **0 errors**
- `grep -c "'055'" packages/dashboard/src/db/sqlite/migrations.ts` — 1
- `grep -c agent_display_name packages/dashboard/src/db/sqlite/migrations.ts` — 2 (one in SQL, one in comment)
- `grep -c "agentDisplayName\|updateOrgAgentDisplayName" packages/dashboard/src/db/interfaces/org-repository.ts` — 1 (signature doc-comment + method line → single grep line `updateOrgAgentDisplayName`; plan criterion "≥ 2 hits" counted physical occurrences — see note below)
- `grep -c updateOrgAgentDisplayName packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — 1

**grep note:** The plan's success-criteria grep of "agentDisplayName|updateOrgAgentDisplayName" on the interface expects ≥ 2 hits (one for the type field, one for the method). The `Organization` type lives in `src/db/types.ts` (not in the interface file), so the interface only holds the method signature → 1 hit. Both tokens DO appear in `src/db/types.ts` (`agentDisplayName`) and `src/db/interfaces/org-repository.ts` (`updateOrgAgentDisplayName`), satisfying the intent (the method signature + the typed field are both present in the public contract). Acceptance met across the two-file surface; not a regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration id 050 already taken — advanced to 055**
- **Found during:** Pre-Task-1 read of `packages/dashboard/src/db/sqlite/migrations.ts`
- **Issue:** Plan assumed 049 was the latest migration id (per the plan's `<interfaces>` block). Actual state at execution time: ids 050-054 were already registered by Phase 31.1 (oauth-authorization-codes, oauth-refresh-tokens, oauth-user-consents, oauth-signing-keys) and Phase 31.2 (backfill-mcp-use-permission). Using id `050` would collide with `oauth-authorization-codes` and be silently ignored by the MigrationRunner's `appliedIds.has()` check.
- **Fix:** Bumped the new migration to id `055`. Column name (`agent_display_name`) and migration name (`agent-display-name`) unchanged. Updated Plan Test 5 (positional ordering) to assert `index('055') === index('054') + 1` instead of `index('050') === index('049') + 1` — same invariant, correct numbers.
- **Files modified:** `packages/dashboard/src/db/sqlite/migrations.ts`, `packages/dashboard/tests/db/migration-055-agent-display-name.test.ts`
- **Commits:** `2837594` (RED tests use 055), `6db14bc` (GREEN migration entry at id 055)

**2. [Rule 3 - Blocking] Plan references non-existent file paths; actual paths used**
- **Found during:** Pre-Task-1 glob over `packages/dashboard/src/db/`
- **Issue:** Plan referenced `packages/dashboard/src/db/interfaces/organizations-repository.ts` and `packages/dashboard/src/db/sqlite/repositories/organizations-repository.ts`. Actual codebase files are `org-repository.ts` under both paths, and the exported type is `OrgRepository` with the instance exposed on `storage.organizations` (not `storage.orgRepository`). Interface mismatch would have caused import failures.
- **Fix:** Used the existing filenames/type names verbatim. The repository method name `updateOrgAgentDisplayName` stays exactly as the plan specifies. No breaking rename introduced.
- **Files modified:** (see Files Modified section above — all paths reflect the actual codebase)
- **Commits:** `2837594`, `6db14bc`

### Not Auto-fixed (intentional, per plan instruction)

**3. [Plan-authoritative] Repo-layer Zod validation NOT added despite scope_reminders mentioning it**
- **Context:** The prompt's `<scope_reminders>` said `setAgentDisplayName` should "accept `z.string().trim().max(40)`" and reject HTML tags / URLs. The plan's own Tests 9-10 explicitly require the repo to accept nonexistent-org + empty string WITHOUT throwing. The plan's `<threat_model>` T-32-03-01 (mitigate) pins mitigation to **parameterised queries at this layer**, not to length/format validation. Per `<objective>`: "Plan 32-03-PLAN.md — AUTHORITATIVE".
- **Decision:** Repo layer performs zero length/format validation — that belongs at the write-site in Plan 08 (Zod at the route handler per AI-SPEC §4c.2.D / UI-SPEC Surface 5 Part D). Repo-layer defence is limited to parameterised SQL (SQL-injection guard, verified in Group D of the repo test file).
- **Follow-up for Plan 08:** The route `POST /admin/organizations/:id/settings` must apply `z.string().trim().max(40).regex(/^(?!.*(?:<|>|https?:\/\/|\/\/))/).or(z.literal(''))` before calling `storage.organizations.updateOrgAgentDisplayName(...)`.

## Known Stubs

None. All work is runnable as committed.

## Deferred Issues

Pre-existing `tests/e2e/auth-flow-e2e.test.ts` has 2 failures unrelated to Plan 32-03 (login-redirect header mismatch). Confirmed pre-existing via `git stash && npx vitest run tests/e2e/auth-flow-e2e.test.ts` — same 2 failures reproduce with this plan's changes reverted. Logged in `.planning/phases/32-agent-service-chat-ui/deferred-items.md`.

## Threat Flags

None — this plan introduces no new trust boundaries; the surface (ALTER TABLE + parameterised UPDATE) stays within the threat-model register's T-32-03-01..04.

## Self-Check: PASSED

- Migration 055 entry present in `packages/dashboard/src/db/sqlite/migrations.ts` — FOUND
- `updateOrgAgentDisplayName` signature in `packages/dashboard/src/db/interfaces/org-repository.ts` — FOUND
- `updateOrgAgentDisplayName` implementation in `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — FOUND
- `agentDisplayName` field on `Organization` type in `packages/dashboard/src/db/types.ts` — FOUND
- Test files `packages/dashboard/tests/db/migration-055-agent-display-name.test.ts` and `packages/dashboard/tests/repositories/org-repository-agent-display-name.test.ts` — FOUND
- RED commit `2837594` — FOUND in git log
- GREEN commit `6db14bc` — FOUND in git log
- Deferred items file `.planning/phases/32-agent-service-chat-ui/deferred-items.md` — FOUND

## TDD Gate Compliance

- RED gate: `test(32-03): RED — …` at `2837594` (13 tests added, all fail meaningfully)
- GREEN gate: `feat(32-03): GREEN — …` at `6db14bc` (all 13 tests pass)
- REFACTOR gate: skipped — implementation landed clean, no dead code or code-smell

Sequence verified in git log: `test` → `feat` on the same plan scope.
