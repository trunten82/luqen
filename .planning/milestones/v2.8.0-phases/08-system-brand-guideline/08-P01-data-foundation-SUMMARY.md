---
phase: 08-system-brand-guideline
plan: 01
subsystem: dashboard/db/branding
tags: [branding, system-guideline, migration, sqlite, repository]
requirements: [SYS-06]
dependency_graph:
  requires: []
  provides:
    - listSystemGuidelines()
    - cloneSystemGuideline()
    - cloned_from_system_guideline_id column
    - scope-aware getGuidelineForSite (verified, unchanged)
  affects:
    - 08-P02 admin-route-and-page (consumes listSystemGuidelines)
    - 08-P03 org-system-library-tab (consumes listSystemGuidelines + cloneSystemGuideline)
    - 08-P04 pipeline-integration-e2e (relies on resolver single code path)
tech_stack:
  added: []
  patterns:
    - Transaction-wrapped clone with synchronous body (better-sqlite3)
    - Row mapper surfaces new column via null coalescing (non-breaking)
    - Additive migration — nullable column, zero backfill (D-17)
key_files:
  created:
    - packages/dashboard/tests/db/branding-repository-system.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
    - packages/dashboard/src/db/interfaces/branding-repository.ts
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/sqlite/repositories/branding-repository.ts
decisions:
  - Clone child rows regenerated with fresh UUIDs inside a single transaction (exception-safe rollback)
  - Clone body snapshots source children synchronously before entering db.transaction() — better-sqlite3 txn cannot span async awaits
  - getGuidelineForSite JOIN left byte-identical (D-06) — system rows resolve through the existing code path
  - clonedFromSystemGuidelineId surfaced as `string | null` on the record (not optional-absent) so callers can pattern-match the field's presence
metrics:
  duration_minutes: 3
  tasks_completed: 2
  files_touched: 5
  tests_added: 9
  tests_total_db_suite: 272
  completed_at: 2026-04-05T22:07:40Z
---

# Phase 08 Plan 01: Data Foundation Summary

Data foundation for system brand guidelines shipped: migration 040 adds a
single nullable `cloned_from_system_guideline_id` column to
`branding_guidelines`, the SQLite repository gains `listSystemGuidelines`
and a transaction-wrapped `cloneSystemGuideline`, and `getGuidelineForSite`
resolves system-scoped rows transparently through the existing JOIN — no
second code path. Zero migration of existing data (D-17), all 272 tests in
`packages/dashboard/tests/db/` pass.

## What Was Built

### Migration 040 — `add_branding_guidelines_cloned_from_system_guideline_id`

Appended to `packages/dashboard/src/db/sqlite/migrations.ts`. Single
`ALTER TABLE` adds a nullable `TEXT` column. No `NOT NULL`, no `DEFAULT`,
no backfill — every pre-existing row stays byte-identical with the column
as `NULL`.

### Repository interface extension

`packages/dashboard/src/db/interfaces/branding-repository.ts` now declares:

- `listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]>`
- `cloneSystemGuideline(sourceId, targetOrgId, overrides?): Promise<BrandingGuidelineRecord>`

`BrandingGuidelineRecord` in `packages/dashboard/src/db/types.ts` gains
`clonedFromSystemGuidelineId?: string | null`.

### SqliteBrandingRepository implementation

- `GuidelineRow` interface + `guidelineRowToRecord` propagate the new column
  (`row.cloned_from_system_guideline_id ?? null`).
- `listSystemGuidelines` runs `WHERE g.org_id = 'system' ORDER BY g.name ASC`
  and eagerly loads colors/fonts/selectors — same shape as `getGuideline`.
- `cloneSystemGuideline`:
  - Loads source via `getGuideline` → throws if not found.
  - Throws `Cannot clone non-system guideline …` if `source.orgId !== 'system'`.
  - Snapshots source children synchronously (async calls can't span a
    better-sqlite3 transaction body).
  - Inside `this.db.transaction(() => { … })`, inserts a fresh guideline row
    with `clonedFromSystemGuidelineId = sourceId`, then inserts fresh colors,
    fonts, and selectors — each with a new UUID but pointing at the new
    guideline id.
  - Returns the freshly-built record directly (no round-trip re-read).
- `getGuidelineForSite` — **unchanged**. The existing `SELECT g.* … JOIN
  site_branding` already returns whatever `org_id` the linked guideline has,
  so system rows resolve transparently through the single code path (D-06).

## Verification

- New test file `tests/db/branding-repository-system.test.ts` pins 9 behaviours
  across migration, list, clone (default name, override name, non-system
  reject), resolver (system row + org row byte-identity), and round-trip —
  all green.
- Full `packages/dashboard/tests/db/` suite: **272/272 passing**, zero
  regressions on the pre-existing 263 tests.
- `npx tsc --noEmit` clean on the dashboard package.
- CLAUDE.md + security rules honored: no hardcoded secrets, immutable
  record construction (no in-place mutation), input-boundary validation
  on the `cloneSystemGuideline` source-org check.

## Deviations from Plan

**None relative to the behaviour spec.** Minor implementation-level
adjustments within the letter of the plan:

1. **[Rule 3 - Blocking] Sync snapshot before transaction.** The plan's
   pseudocode implied calling `addColor` / `addFont` / `addSelector` inside
   the transaction. better-sqlite3's `db.transaction(fn)` requires `fn` to
   be synchronous — but the existing `addColor/addFont/addSelector` methods
   are `async`. Resolution: snapshot `source.colors/fonts/selectors` into
   local arrays before entering the transaction, then use prepared
   statements directly inside the synchronous transaction body. Same net
   effect (fresh UUIDs, rollback on partial failure), but stays within the
   sync constraint. Committed as part of `f94a2e8`.

2. **Interface location.** The plan refers to
   `packages/dashboard/src/db/branding-repository.ts`; the actual interface
   lives at `packages/dashboard/src/db/interfaces/branding-repository.ts`
   (the repo already splits interface vs implementation under `interfaces/`
   and `sqlite/repositories/`). Edited the real location. No behavioural
   impact.

## Authentication Gates

None — pure data-layer work.

## Commits

| # | Type  | Hash     | Subject                                                                   |
|---|-------|----------|---------------------------------------------------------------------------|
| 1 | test  | d22dca4  | test(08-P01): add failing tests for system brand guideline data layer     |
| 2 | feat  | 02304d5  | feat(08-P01): migration 040 adds cloned_from_system_guideline_id column   |
| 3 | feat  | f94a2e8  | feat(08-P01): branding repo listSystemGuidelines + cloneSystemGuideline + scope-aware resolver |

## Follow-ups for Downstream Plans

- **08-P02 (admin route):** `repo.listSystemGuidelines()` is the backing
  call for the System Library admin page. The eager colors/fonts/selectors
  load means the admin page can render summaries without N+1 fetches.
- **08-P03 (org library tab):** `repo.cloneSystemGuideline(id, orgId)` is
  the "clone into my org" button handler. Returns the new record directly,
  so the UI can route straight to its edit page.
- **08-P04 (pipeline e2e):** The existing `getGuidelineForSite` JOIN is the
  only resolver — no dual code path to audit. Scans against sites that
  happen to be assigned a system guideline will see `orgId = 'system'` on
  the returned record, which the pipeline must treat as a valid guideline
  (not filter out).

## Known Stubs

None. Every method returns real data from real queries.

## Self-Check: PASSED

- **Files created/modified:** all 5 present on disk.
- **Commits exist:** `d22dca4`, `02304d5`, `f94a2e8` all visible in `git log`.
- **Tests green:** 9/9 new + 272/272 db suite.
- **TypeScript:** `tsc --noEmit` clean.
