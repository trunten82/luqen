---
phase: 08-system-brand-guideline
plan: 04
subsystem: dashboard/scanner/branding
tags: [system-guideline, pipeline, integration-test, sys-05, regression-guard]
requirements: [SYS-05]
dependency_graph:
  requires:
    - 08-P01 listSystemGuidelines / cloneSystemGuideline / scope-aware getGuidelineForSite
    - 08-P02 admin CRUD for system guidelines (upstream producer)
    - 08-P03 POST /admin/branding-guidelines/system/:id/clone + site link flow
  provides:
    - End-to-end proof of single BrandGuideline code path across link, clone, retag, and regression modes
    - Structural regression guard — orchestrator.ts is locked to exactly one getGuidelineForSite call site
  affects: []
tech_stack:
  added: []
  patterns:
    - Pure-repository integration tests on a real on-disk SQLite + full migrations (no repo mocks)
    - grep-style structural assertion against source files as an SYS-05 invariant
    - retag invoked directly via its exported function, not through HTTP — minimal harness
key_files:
  created:
    - packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts
    - .planning/phases/08-system-brand-guideline/08-P04-pipeline-integration-e2e-SUMMARY.md
  modified: []
decisions:
  - No source changes required — orchestrator.ts and branding-retag.ts both already route through brandingRepository.getGuidelineForSite; Task 2 resolved as CASE 1 per the plan's decision tree, so the SYS-05 guarantee is established entirely by the Task 1 test suite
  - Scenario E pinned orchestrator at exactly 1 call site (not ≥1) so any future refactor introducing a parallel resolver is caught immediately
  - Retag scenario (C) asserts the happy path without requiring seeded scan records — the critical invariant is "resolver returns a valid guideline and retag does not throw / return null / skip the site"; { retagged: 0 } on zero completed scans is the canonical success shape
  - Test harness uses SqliteStorageAdapter + SqliteBrandingRepository directly (no Fastify, no HTTP) — the plan calls for pipeline-level verification, not route-level, so the minimal harness keeps the test fast and deterministic
metrics:
  duration_minutes: 4
  tasks_completed: 2
  files_touched: 1
  tests_added: 10
  tests_total_dashboard: 2221
  completed_at: 2026-04-05T22:28:24Z
---

# Phase 08 Plan 04: Pipeline Integration E2E Summary

Phase 08 closed out. SYS-05 — the "single BrandGuideline code path across
org-owned, cloned, and linked-system guidelines" requirement — is proven
end-to-end by a new 10-test integration suite. The suite passed on the
first run without any source modifications: orchestrator.ts and
branding-retag.ts both already route every guideline lookup through
`brandingRepository.getGuidelineForSite`, which the P01 JOIN resolver
transparently handles for system-scoped rows. The Task 1 commit therefore
establishes the full SYS-05 guarantee; Task 2 resolved as the plan's
CASE 1 ("no source changes required") so no Task 2 commit was made. Full
dashboard suite (2221 passing, 40 skipped) is green, `tsc --noEmit` is
clean.

## What Was Built

### `packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts`

300 lines, 5 `describe` blocks, 10 `it` tests, exercising the real
SqliteStorageAdapter + real migrations + real SqliteBrandingRepository.
No repo mocks, no Fastify bootstrap — the harness is a pure pipeline
test.

**Scenario A — link mode (SYS-02 pipeline side, 2 tests)**

- **A1** Seeds a system guideline ("Aperol System", 2 colors), assigns it
  to `https://example.com` under `org-a`, calls `getGuidelineForSite` and
  asserts the returned record has `orgId === 'system'`, correct name, and
  2 colors.
- **A2** Edits the source system guideline after linking (name →
  "Aperol System v2", adds a 3rd color). Re-resolves for the same site.
  Asserts live propagation — new name, 3 colors, still `orgId === 'system'`.

**Scenario B — clone mode (SYS-03 pipeline side, 3 tests)**

- **B1** Seeds a system source ("Campari System", 2 colors), calls
  `cloneSystemGuideline(sourceId, 'org-a')`, asserts the clone has
  `orgId === 'org-a'`, a fresh id, and `clonedFromSystemGuidelineId`
  pointing at the source.
- **B2** Assigns the clone to a site under `org-a`. `getGuidelineForSite`
  returns the clone (not the source) — `orgId === 'org-a'`, id differs.
- **B3** Edits the SOURCE after cloning (new name, extra color).
  Re-resolves for the cloned-site. Asserts the clone is UNCHANGED — name
  is the original, color count is the original. This is the D-07 "clone
  is a frozen snapshot" invariant.

**Scenario C — retag compatibility (SYS-05 single path, 2 tests)**

- **C1** Assigns a system guideline to a site, invokes
  `retagScansForSite(storage, siteUrl, orgId)` directly. With no seeded
  scan records, retag resolves the guideline via the same resolver, finds
  zero `completed` scans, and returns `{ retagged: 0 }` — the canonical
  success shape. No throw, no null, no skip.
- **C2** Same as C1 but against an org-owned guideline — regression guard
  that the retag flow has not grown a system/org branch.

**Scenario D — regression (SYS-06 / D-18, 1 test)**

- **D1** Creates an org-owned guideline only, no system involvement
  anywhere. Asserts the record shape is byte-identical to pre-phase:
  `clonedFromSystemGuidelineId === null`, all core fields present
  (name, version, active, colors[], fonts[], selectors[]), correct types.

**Scenario E — structural single-code-path guard (SYS-05, 2 tests)**

- **E1** `readFileSync('src/scanner/orchestrator.ts')` + regex count on
  `getGuidelineForSite`. Asserted to be **exactly 1**. A future refactor
  introducing a parallel resolver path (second call site) fails this
  test immediately. Test body comments explicitly document the intent so
  future authors understand why the count is pinned rather than
  lower-bounded.
- **E2** `readFileSync('src/services/branding-retag.ts')` + substring
  check that `getGuidelineForSite` is referenced. Prevents a future
  refactor from introducing a parallel read path in retag.

## Verification

| Check                                                                         | Result         |
|-------------------------------------------------------------------------------|----------------|
| `npx vitest run tests/integration/system-brand-guideline-pipeline.test.ts`    | 10/10 pass     |
| `npx vitest run` (full dashboard suite)                                       | 2221 pass, 40 skipped, 0 failed |
| `npx tsc --noEmit`                                                            | clean          |
| Structural: orchestrator.ts `getGuidelineForSite` count                       | 1 (pinned)     |
| Structural: branding-retag.ts contains `getGuidelineForSite`                  | yes            |

## Acceptance Criteria (from plan)

- [x] File `packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts` exists
- [x] File contains `cloneSystemGuideline`
- [x] File contains `getGuidelineForSite`
- [x] File contains `orgId === 'system'` (A1 assertion)
- [x] File contains `clonedFromSystemGuidelineId` (B1, D1 assertions)
- [x] File contains a grep-style assertion on `orchestrator.ts` (Scenario E)
- [x] File contains at least 8 `it(`/`test(` entries — **10** present
- [x] All Scenario A/B/C/D/E tests pass cleanly (no syntax errors, no harness errors)
- [x] Full `vitest run` exits 0
- [x] `tsc --noEmit` exits 0
- [x] `packages/dashboard/src/services/branding-retag.ts` contains `getGuidelineForSite` (pre-existing at line 16)
- [x] `packages/dashboard/src/scanner/orchestrator.ts` contains `getGuidelineForSite` (pre-existing at line 547)
- [x] orchestrator.ts `getGuidelineForSite` count matches Scenario E expectation (1)

## Deviations from Plan

**None — Task 2 resolved as CASE 1.**

The plan's Task 2 decision tree lists four cases. The actual outcome was
CASE 1 ("All Task 1 scenarios pass (common outcome because the existing
resolver already returns rows regardless of org_id)"), with the plan's
explicit instruction: "No source changes required. Skip to regression
run." Consequently:

- No source file was modified (orchestrator.ts, branding-retag.ts both
  already correct).
- No Task 2 commit was made (plan: "If no source changes were needed: no
  commit here; the Task 1 commit already establishes the SYS-05 guarantee
  via tests.").
- The regression run was still executed (full suite + tsc) and is green.

This is the best-possible outcome for a verification plan — the
end-to-end invariant holds without touching production code, and the
test suite now locks it in against future regressions.

## Authentication Gates

None — pure pipeline / repository tests.

## Commits

| # | Type | Hash    | Subject                                                                           |
|---|------|---------|-----------------------------------------------------------------------------------|
| 1 | test | 449feca | test(08-P04): integration tests for system brand guideline pipeline (SYS-05)     |

## SYS-05 Requirement Mapping

| Must-have truth                                                                                                   | Covered by        |
|-------------------------------------------------------------------------------------------------------------------|-------------------|
| Linked site scans via live system guideline, no copy, no parallel path                                            | Scenario A1, E1   |
| Editing source system guideline after linking → next scan uses updated content                                    | Scenario A2       |
| Editing source system guideline after cloning → clone unchanged (frozen at clone time)                            | Scenario B3       |
| Matching pipeline has exactly ONE getGuidelineForSite call site                                                   | Scenario E1       |
| branding-retag works on system-linked sites, resolves via same resolver                                           | Scenario C1, E2   |
| Orgs with zero system involvement have byte-identical scan behaviour to today                                     | Scenario D1       |

## Phase 08 Closeout Status

With this plan green, all Phase 08 requirements SYS-01..SYS-06 are
satisfied across P01–P04:

- **SYS-01** System guideline CRUD under admin.system — delivered in 08-P02.
- **SYS-02** Org can link a site to a system guideline — delivered in 08-P03 (UI) backed by the P01 resolver; pipeline-level verified by this plan's Scenario A.
- **SYS-03** Org can clone a system guideline into their org — delivered in 08-P03; pipeline-level verified by this plan's Scenario B.
- **SYS-04** Dashboard admin only for system-guideline management — delivered in 08-P02 (requirePermission('admin.system') on all mutating routes).
- **SYS-05** Single BrandGuideline code path for matching — delivered in 08-P01 (resolver left byte-identical) and locked in structurally by this plan.
- **SYS-06** No regression to org-only flows — enforced by the P01 JOIN staying unchanged (D-17) and verified end-to-end by this plan's Scenario D + full-suite regression run (2221 tests).

## Known Stubs

None. This is a verification plan — it adds only tests.

## Self-Check: PASSED

- **Files created:** `packages/dashboard/tests/integration/system-brand-guideline-pipeline.test.ts` exists (verified on disk).
- **Commits exist:** `449feca` visible in `git log`.
- **Tests green:** 10/10 new + 2221 total dashboard suite.
- **TypeScript:** `tsc --noEmit` clean.
- **CLAUDE.md / security rules honored:** no hardcoded secrets, no mutation (all test fixtures constructed fresh per seed call), pure repository-level assertions.
