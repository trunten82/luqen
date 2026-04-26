---
phase: 18-scanner-wire-up
plan: 05
subsystem: trend-query
status: complete
started_at: 2026-04-11T17:32Z
completed_at: 2026-04-11T17:40Z
requirements:
  - BSTORE-04
  - BSTORE-06
tags:
  - trend-query
  - left-join
  - brand-score-mapper
  - bstore-04
  - score-result
  - latest-per-scan
  - null-safety
dependency_graph:
  requires:
    - 16-02 (BrandScoreRepository row-to-ScoreResult reconstruction pattern)
    - 18-03 (scanner writes brand_scores rows so trend query has data to join)
    - 18-04 (retag appends N rows per scan — drives the latest-per-scan subquery requirement)
  provides:
    - Shared brand-score-row-mapper.ts used by BrandScoreRepository AND SqliteScanRepository.getTrendData
    - ScanRecord.brandScore?: ScoreResult | null domain field
    - getTrendData LEFT JOIN brand_scores with MAX(rowid) latest-per-scan subquery
    - BSTORE-04 regression suite (5 tests) pinning the strict-null contract
  affects:
    - 18-06 (trend query is not on the scanner hot path — no perf gate impact)
    - 20 (report panel can now read record.brandScore from trend data)
    - 21 (dashboard widget can now render brandScore from trend query results)
tech-stack:
  added: []
  patterns:
    - LEFT JOIN with correlated MAX(rowid) subquery for latest-per-group (mirrors Phase 16-02 rowid DESC tie-breaker)
    - Structural row-shape interface (BrandScoreRowLike) letting one mapper serve two repositories
    - Optional discriminated-union field (ScoreResult | null) as a three-state signal (undefined | null | ScoreResult)
key_files:
  created:
    - packages/dashboard/src/db/sqlite/repositories/brand-score-row-mapper.ts
    - packages/dashboard/tests/db/scan-repository-trend-brand-score.test.ts
  modified:
    - packages/dashboard/src/db/types.ts
    - packages/dashboard/src/db/sqlite/repositories/scan-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts
decisions:
  - "Shared brand-score-row-mapper.ts — extract the row→ScoreResult reconstruction out of BrandScoreRepository so the scan-repository trend path uses the EXACT same tagged-union reconstruction logic. A single source of truth means D-13 / D-15 invariants (overall-plus-subscore-details predicate, UnscorableReason whitelist) cannot drift between the two query paths."
  - "LEFT JOIN (not INNER JOIN) for getTrendData — pre-v2.11.0 scans have zero rows in brand_scores by BSTORE-06 no-backfill. INNER JOIN would silently drop them; LEFT JOIN preserves them with NULLs across every brand_scores column, which maps to brandScore: null."
  - "Latest-per-scan via correlated subquery on MAX(rowid) — retag from Phase 18-04 appends a new brand_scores row every run. The trend query needs ONE row per scan carrying the latest score. Using `bs.rowid = (SELECT MAX(rowid) FROM brand_scores WHERE scan_id = s.id)` mirrors the Phase 16-02 repository's rowid DESC tie-breaker exactly, so the two read paths agree on which row is 'latest'."
  - "ScanRecord.brandScore is OPTIONAL (`?:`) AND nullable (`ScoreResult | null`) — three distinct states: undefined means the query did not join brand_scores (legacy call sites like listScans / getScan), null means the LEFT JOIN had no match (pre-v2.11.0 or no-guideline scan), and a ScoreResult means the row was matched and reconstructed. Phase 21 widget will check `scan.brandScore === null` for the empty-state branch."
  - "Strict `toBe(null)` assertion in Test 1 — not `toBeFalsy`, not `toBeNull` with undefined tolerance. The Phase 21 widget's empty-state check will use `=== null` strict equality, so the test pins exactly the shape the widget relies on. undefined, NaN, 0, and `{ overall: 0 }` are all rejected explicitly by additional `not.toEqual` / `not.toBe` assertions."
metrics:
  duration_minutes: 8
  tasks_completed: 3
  files_created: 2
  files_modified: 3
  tests_added: 5
  tests_total_dashboard: 2495
  tests_total_dashboard_baseline: 2490
---

# Phase 18 Plan 05: getTrendData LEFT JOIN brand_scores Summary

Wired `SqliteScanRepository.getTrendData` to LEFT JOIN `brand_scores` with a
latest-per-scan `MAX(rowid)` subquery, extended `ScanRecord` with an optional
`brandScore: ScoreResult | null` field, extracted the row→ScoreResult mapper
into a shared `brand-score-row-mapper.ts` used by both brand-score-repository
and scan-repository, and pinned the BSTORE-04 strict-null contract with a 5-test
regression suite (the critical one asserts `expect(entry.brandScore).toBe(null)`
for a pre-v2.11.0 scan).

## What Changed

### 1. Shared row-to-ScoreResult mapper

Created `packages/dashboard/src/db/sqlite/repositories/brand-score-row-mapper.ts`:

- `BrandScoreRowLike` — minimal row-shape interface (overall, subscore_details,
  unscorable_reason, coverage_profile) that both the direct brand_scores
  SELECT and the scan-repository LEFT JOIN result satisfy structurally.
- `KNOWN_UNSCORABLE_REASONS` — whitelist Set of the six `UnscorableReason`
  literals.
- `assertUnscorableReason(value)` — throws on NULL or unknown literal.
- `brandScoreRowToResult(row)` — the D-13-aware reconstruction: `isTopLevelScored
  = row.overall !== null && row.subscore_details !== null`, parses
  subscore_details + coverage_profile JSON, returns a scored ScoreResult;
  otherwise returns an unscorable ScoreResult.

`brand-score-repository.ts` now imports `brandScoreRowToResult` from the shared
file instead of holding its own copy. The Phase 16-02 8/8 test suite still
passes unchanged — proof that the extraction is behavior-preserving.

### 2. ScanRecord.brandScore domain field

`packages/dashboard/src/db/types.ts` gains:

```typescript
import type { ScoreResult } from '../services/scoring/types.js';

export interface ScanRecord {
  // ...existing fields unchanged...
  readonly brandRelatedCount?: number;
  /**
   * Phase 18-05: Latest brand_scores row for this scan, reconstructed as a
   * Phase 15 ScoreResult tagged union. Populated ONLY by queries that opt
   * into the brand_scores LEFT JOIN (currently getTrendData); direct
   * getScan / listScans leave this field undefined.
   *
   * Semantics:
   *   - undefined  → query did not join brand_scores (legacy call site)
   *   - null       → LEFT JOIN matched no brand_scores row for this scan
   *   - ScoreResult → reconstructed tagged union (kind 'scored' or 'unscorable').
   */
  readonly brandScore?: ScoreResult | null;
}
```

The field is OPTIONAL so legacy consumers (`routes/api/export.ts`,
`routes/trends.ts`, `graphql/resolvers.ts`) compile and run unchanged — they
just ignore `brandScore` until Phase 20/21 wires UI.

### 3. getTrendData LEFT JOIN rewrite

`SqliteScanRepository.getTrendData` is now:

```sql
SELECT
  s.*,
  bs.overall           AS brand_overall,
  bs.subscore_details  AS brand_subscore_details,
  bs.unscorable_reason AS brand_unscorable_reason,
  bs.coverage_profile  AS brand_coverage_profile,
  bs.rowid             AS brand_row_id
FROM scan_records s
LEFT JOIN brand_scores bs
  ON bs.scan_id = s.id
 AND bs.rowid = (
   SELECT MAX(rowid) FROM brand_scores
   WHERE scan_id = s.id
 )
WHERE s.status = 'completed'
  AND s.org_id = @orgId   -- only when an orgId was provided
ORDER BY s.created_at ASC
```

Row mapping logic:

```typescript
if (row.brand_row_id === null) {
  return { ...base, brandScore: null };   // LEFT JOIN miss
}
const like: BrandScoreRowLike = {
  overall: row.brand_overall,
  subscore_details: row.brand_subscore_details,
  unscorable_reason: row.brand_unscorable_reason,
  coverage_profile: row.brand_coverage_profile,
};
const brandScore: ScoreResult = brandScoreRowToResult(like);
return { ...base, brandScore };
```

Two invariants enforced at the SQL + mapping boundary:

1. **LEFT JOIN, not INNER JOIN.** Pre-v2.11.0 scans have zero rows in
   brand_scores (BSTORE-06 no-backfill invariant). INNER JOIN would drop them
   and the Phase 21 widget would see "no data" for orgs with pre-v2.11.0
   history. LEFT JOIN preserves them, and `brand_row_id IS NULL` is the exact
   signal the row mapper uses to yield `brandScore: null`.
2. **Latest-per-scan via correlated MAX(rowid) subquery.** Retag (Phase 18-04)
   appends a new brand_scores row every run, so a single scan can have N
   rows. The MAX(rowid) subquery picks the greatest-rowid row per scan_id,
   mirroring the Phase 16-02 repository's `ORDER BY computed_at DESC, rowid
   DESC LIMIT 1` tie-breaker.

### 4. BSTORE-04 regression test suite

`packages/dashboard/tests/db/scan-repository-trend-brand-score.test.ts` — 5
tests, real SqliteStorageAdapter on temp-file SQLite, no mocks:

| Test | Setup | Assertion |
|------|-------|-----------|
| 1 (CRITICAL) | scan_records row, NO brand_scores row | `expect(entry.brandScore).toBe(null)` + `not.toBe(undefined)` + `not.toEqual({ overall: 0 })` |
| 2 | scored brand_scores row | `bs.kind === 'scored'`, `bs.overall === 72`, all subscores scored, coverage round-trips |
| 3 | unscorable brand_scores row | `bs.kind === 'unscorable'`, `bs.reason === 'no-branded-issues'` |
| 4 (retag) | TWO brand_scores rows for same scan_id (overall 50, then 80) | `trend.length === 1` AND `bs.overall === 80` (latest wins) |
| 5 (mixed org) | orgA scored + orgB pre-v2.11.0 | `entryA.brandScore.kind === 'scored'` AND `entryB.brandScore === null` |

The **critical BSTORE-04 assertion** is Test 1 line:

```typescript
expect(entry.brandScore).toBe(null);
```

This is the exact shape the Phase 21 widget will check with `if
(scan.brandScore === null) { renderEmptyState() }`. A `toBeFalsy` /
`toBeNull` looser assertion would accept `undefined` and a `{ overall: 0 }`
object (truthy) or undefined (falsy) — both of which would masquerade as
"measured zero" and break the widget.

The **latest-wins assertion** is Test 4 line:

```typescript
expect(bs.overall).toBe(80);
```

That proves the MAX(rowid) correlated subquery collapses retag history
correctly.

## Out of Scope (Phase 20/21 work)

`routes/trends.ts` and `views/trends.hbs` template consumers are **NOT
touched** by this plan — they still receive the same `ScanRecord[]` shape and
just don't read the new `brandScore` field yet. Phase 20 (report panel) and
Phase 21 (dashboard widget) will opt in to `record.brandScore` when they need
it. Extending the SQL + domain type shape here is strictly preparatory.

`getLatestPerSite` still uses the old INNER JOIN pattern — Phase 20 will
extend it if the per-site widget needs brand scores.

## Verification

- `npm run lint` in packages/dashboard → clean (tsc --noEmit exits 0)
- `npx vitest run tests/db/brand-score-repository.test.ts` → 8/8 still passing
  (Phase 16-02 contract preserved after mapper extraction)
- `npx vitest run tests/db/scans.test.ts` → 18/18 still passing (legacy
  getTrendData callers unaffected)
- `npx vitest run tests/db/scan-repository-trend-brand-score.test.ts` → 5/5
  new BSTORE-04 regression tests passing
- `npx vitest run` full dashboard suite → **2495/2495 passing**, 3 skipped, 40
  skipped — no regression from the 2490 baseline after 18-04
- `grep -c "LEFT JOIN brand_scores" scan-repository.ts` → 2 (comment + SQL)
- `grep -c "INNER JOIN brand_scores" scan-repository.ts` → 0
- `grep -c "MAX(rowid)" scan-repository.ts` → 1
- `grep -c "brandScore" types.ts` → 2 (import + field)

## Commits

- `5ebad35` refactor(18-05): extract brand-score row-to-result mapper to shared helper
- `f505c99` refactor(18-05): extend ScanRecord with brandScore + LEFT JOIN getTrendData
- `b25712c` test(18-05): BSTORE-04 regression suite for getTrendData LEFT JOIN

## Deviations from Plan

None — plan executed exactly as written. One minor correction: the plan's
example test used `storage.close()`, but the actual `SqliteStorageAdapter`
method is `disconnect()` (verified against
`packages/dashboard/src/db/sqlite/index.ts`). Test uses `disconnect()`.

## Self-Check: PASSED

- FOUND: packages/dashboard/src/db/sqlite/repositories/brand-score-row-mapper.ts
- FOUND: packages/dashboard/tests/db/scan-repository-trend-brand-score.test.ts
- FOUND commit: 5ebad35
- FOUND commit: f505c99
- FOUND commit: b25712c
