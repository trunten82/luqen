---
phase: 27-historical-rescore
plan: 01
subsystem: dashboard/rescore
tags: [rescore, batch-processing, brand-scoring, migration]
dependency_graph:
  requires: [brand-score-calculator, brand-score-repository, scan-repository, branding-repository]
  provides: [rescore-service, rescore-progress-repository, migration-046]
  affects: [brand-overview, admin-branding]
tech_stack:
  added: []
  patterns: [repository-pattern, batch-processing, org-level-lock, idempotent-skip]
key_files:
  created:
    - packages/dashboard/src/services/rescore/rescore-types.ts
    - packages/dashboard/src/services/rescore/rescore-service.ts
    - packages/dashboard/src/db/interfaces/rescore-progress-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/rescore-progress-repository.ts
    - packages/dashboard/tests/db/rescore-progress-repository.test.ts
    - packages/dashboard/tests/services/rescore-service.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
decisions:
  - "Embedded BrandingMatcher used for issue matching before scoring (not orchestrator)"
  - "INSERT OR REPLACE on org_id for upsert semantics (single progress row per org)"
  - "Generic error message 'Batch processing failed' stored in progress (T-27-04)"
metrics:
  duration: 300s
  completed: "2026-04-13T06:45:05Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 20
  files_created: 6
  files_modified: 1
---

# Phase 27 Plan 01: Rescore Engine Summary

Batch rescore engine with migration 046, RescoreProgressRepository, and RescoreService processing historical scans in groups of 50 using embedded calculateBrandScore with idempotent skip, guideline-warning logic, and org-level locking.

## Task Completion

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Migration 046 + rescore types + RescoreProgressRepository | 3ae478b | Done |
| 2 | RescoreService batch processing engine | 5ac27f3 | Done |

## Implementation Details

### Task 1: Migration 046 + Types + Repository

- Migration 046 creates `rescore_progress` table with `UNIQUE` constraint on `org_id`
- Columns: id, org_id, status (CHECK constraint), total_scans, processed_scans, scored_count, skipped_count, warning_count, last_processed_scan_id, error, created_at, updated_at
- `RescoreProgress`, `RescoreResult`, `RescoreStatus` types exported from `rescore-types.ts`
- `RescoreProgressRepository` interface with getByOrgId, upsert, deleteByOrgId
- `SqliteRescoreProgressRepository` implementation using `INSERT OR REPLACE` keyed on org_id
- 7 TDD tests covering schema, CRUD, and uniqueness constraint

### Task 2: RescoreService

- `startRescore(orgId)` -- checks org lock (D-09), counts candidates, creates progress row
- `processNextBatch(orgId)` -- processes up to 50 scans per call (BRESCORE-03)
- `getProgress(orgId)` -- returns current progress or null
- `getCandidateCount(orgId)` -- counts scans without brand_scores rows
- Idempotent: scans with existing brand_scores rows are skipped (BRESCORE-02)
- Guideline safety: deleted/inactive guidelines produce warning count (BRESCORE-04)
- Embedded-only: calls `calculateBrandScore` directly, never `BrandingOrchestrator` (BRESCORE-05)
- Issues extracted from jsonReport and matched via `BrandingMatcher` before scoring
- JSON.parse wrapped in try/catch for malformed reports (T-27-02)
- Generic error messages stored in progress, not stack traces (T-27-04)
- 13 TDD tests covering all BRESCORE requirements and edge cases

## BRESCORE Requirements Coverage

| Requirement | Description | Verified By |
|-------------|-------------|-------------|
| BRESCORE-02 | Idempotent skip of already-scored scans | Test 4 |
| BRESCORE-03 | Batch size capped at 50 | Test 6 |
| BRESCORE-04 | Guideline-deleted warning skip | Test 5 |
| BRESCORE-05 | Embedded-only scoring | Test 7 |
| D-09 | Org-level lock (one rescore at a time) | Test 1 |

## Deviations from Plan

None -- plan executed exactly as written.

## Self-Check: PASSED

All 7 files verified present. Both commit hashes (3ae478b, 5ac27f3) confirmed in git log. 20/20 tests passing.
