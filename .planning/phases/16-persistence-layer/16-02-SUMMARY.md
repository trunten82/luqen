---
phase: 16-persistence-layer
plan: 02
subsystem: dashboard/db
tags: [repository, sqlite, brand-scores, scoring, persistence, phase-15-contract, append-only]
requires:
  - 16-01 (migration 043 — brand_scores table + organizations.branding_mode)
  - 15-04 (Phase 15 ScoreResult / SubScore / CoverageProfile / UnscorableReason types)
provides:
  - BrandScoreRepository interface (insert / getLatestForScan / getHistoryForSite)
  - SqliteBrandScoreRepository implementation (append-only, ScoreResult round-trip)
  - StorageAdapter.brandScores registration (both on abstract interface and SQLite adapter)
  - Locked read/write contract for Phase 17 orchestrator + Phases 18/20/21 consumers
affects:
  - packages/dashboard/src/db/interfaces/brand-score-repository.ts
  - packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts
  - packages/dashboard/src/db/sqlite/repositories/index.ts
  - packages/dashboard/src/db/sqlite/index.ts
  - packages/dashboard/src/db/adapter.ts
  - packages/dashboard/tests/db/brand-score-repository.test.ts
tech-stack:
  added: []
  patterns:
    - Private row-type + rowToDomain / domainToRow mapping pair (mirrors SqliteBrandingRepository convention)
    - Defensive literal-whitelist assertion (KNOWN_UNSCORABLE_REASONS) guarding TEXT column reads against schema drift
    - Deterministic rowid tie-breaker on ORDER BY when ISO-ms timestamps can collide
    - Append-only contract enforced by absence of any UPDATE statement on the table
key-files:
  created:
    - packages/dashboard/src/db/interfaces/brand-score-repository.ts
    - packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts
    - packages/dashboard/tests/db/brand-score-repository.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/repositories/index.ts
    - packages/dashboard/src/db/sqlite/index.ts
    - packages/dashboard/src/db/adapter.ts
decisions:
  - rowToScoreResult predicate refined to `overall !== null && subscore_details !== null` (NOT "all 4 score columns present"). The per-dimension score columns are denormalized caches of subscore_details.*.value for the scored-sub case and are legitimately NULL when a nested SubScore is unscorable inside an otherwise scored top-level result. subscore_details JSON is the authoritative per-dimension source on read. Directly encodes Phase 15 D-13.
  - ORDER BY clauses include rowid DESC as a deterministic tie-breaker. ISO-ms timestamps collide on same-millisecond append-only writes (e.g. two retag inserts back-to-back). SQLite's monotonic implicit ROWID preserves the "latest row wins" contract without requiring sub-ms precision.
  - Sentinel coverage_profile `{color:false,typography:false,components:false,contributingWeight:0}` is written for top-level unscorable rows — satisfies the NOT NULL schema column without fabricating score data.
  - KNOWN_UNSCORABLE_REASONS literal whitelist rejects unknown `unscorable_reason` values at read time with an explicit Error — defense in depth against a future writer bypassing the typed insert path.
  - No `number | null` anywhere in the interface or impl surface. D-16 enforced at the boundary.
metrics:
  duration: ~8m
  tasks_completed: 3
  completed_date: 2026-04-11
---

# Phase 16 Plan 02: BrandScoreRepository (Append-only) Summary

Append-only `SqliteBrandScoreRepository` lands over migration 043's `brand_scores` table, consuming and returning Phase 15's `ScoreResult` tagged union end-to-end — per-dimension `SubScoreDetail` round-trips verbatim through the `subscore_details` JSON column, NULL score columns map to `{kind:'unscorable', reason}` without any null-to-zero coercion, and a `rowid` tie-breaker preserves "latest row wins" semantics for retag scenarios that fire two inserts inside the same millisecond.

## What Landed

### Interface (packages/dashboard/src/db/interfaces/brand-score-repository.ts)

New 75-line file exporting three types:

- **`BrandScoreScanContext`** — per-row metadata (`scanId`, `orgId`, `siteUrl`, `guidelineId?`, `guidelineVersion?`, `mode: 'embedded' | 'remote'`, `brandRelatedCount`, `totalIssues`). The `mode` literal union matches the schema CHECK constraint from migration 043.
- **`BrandScoreHistoryEntry`** — `{ computedAt: string; result: ScoreResult }`. Never `number | null` at the boundary.
- **`BrandScoreRepository`** — three async methods:
  - `insert(result: ScoreResult, context: BrandScoreScanContext): Promise<void>`
  - `getLatestForScan(scanId: string): Promise<ScoreResult | null>` — `null` means "no row exists for this scan_id", distinct from a row whose ScoreResult kind is `'unscorable'`.
  - `getHistoryForSite(orgId: string, siteUrl: string, limit: number): Promise<readonly BrandScoreHistoryEntry[]>` — rows ordered `computedAt DESC`, respects `limit`.

Type-only imports from `../../services/scoring/types.js` keep the interface file zero-runtime-dependency.

### SQLite Implementation (packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts)

240-line file with a clear three-section layout:

1. **Private row type** (`BrandScoreRow`) mirrors the migration 043 column layout — 17 fields, all nullable columns typed as `T | null`.
2. **Read-path mappers**:
   - `KNOWN_UNSCORABLE_REASONS` — literal whitelist over the 6 `UnscorableReason` enum values.
   - `assertUnscorableReason(value)` — throws on NULL or unknown literal; returns the typed reason otherwise.
   - `rowToScoreResult(row)` — returns `{kind:'scored', ...}` when `row.overall !== null && row.subscore_details !== null`; otherwise returns `{kind:'unscorable', reason: assertUnscorableReason(row.unscorable_reason)}`. The scored branch reconstructs `color/typography/components` from `subscore_details` JSON (preserving nested `SubScore` discriminated-union variants including any unscorable subs) and `coverage` from `coverage_profile` JSON.
3. **Write-path mappers**:
   - `UNSCORABLE_COVERAGE_PROFILE` sentinel — `{color:false, typography:false, components:false, contributingWeight:0}` written for top-level unscorable rows to satisfy `coverage_profile TEXT NOT NULL`.
   - `subValueOrNull(sub)` — numeric value when `sub.kind === 'scored'`, else `null`.
   - `buildInsertColumns(result, context)` — generates a `randomUUID()` id, calls `new Date().toISOString()` for `computed_at`, branches on `result.kind` to populate 17 column values.

The class `SqliteBrandScoreRepository` holds the prepared statements as module-level SQL string constants and delegates each method to one prepared statement + mapper.

#### Exact INSERT SQL

```sql
INSERT INTO brand_scores (
  id, scan_id, org_id, site_url, guideline_id, guideline_version,
  overall, color_contrast, typography, components,
  coverage_profile, subscore_details, unscorable_reason,
  brand_related_count, total_issues, mode, computed_at
) VALUES (
  @id, @scan_id, @org_id, @site_url, @guideline_id, @guideline_version,
  @overall, @color_contrast, @typography, @components,
  @coverage_profile, @subscore_details, @unscorable_reason,
  @brand_related_count, @total_issues, @mode, @computed_at
)
```

Named bindings — zero string interpolation, zero dynamic SQL.

#### Exact SELECT SQL

```sql
-- getLatestForScan
SELECT * FROM brand_scores WHERE scan_id = ? ORDER BY computed_at DESC, rowid DESC LIMIT 1

-- getHistoryForSite
SELECT * FROM brand_scores WHERE org_id = ? AND site_url = ? ORDER BY computed_at DESC, rowid DESC LIMIT ?
```

`rowid DESC` is the deterministic tie-breaker (see Deviations #2 below).

### Wiring

**`packages/dashboard/src/db/sqlite/repositories/index.ts`** — one new re-export line appended:
```typescript
export { SqliteBrandScoreRepository } from './brand-score-repository.js';
```

**`packages/dashboard/src/db/sqlite/index.ts`** — three additions (mirrors the existing `SqliteBrandingRepository` pattern exactly):
- `SqliteBrandScoreRepository` added to the destructured import block
- `readonly brandScores: SqliteBrandScoreRepository;` added after `readonly branding: SqliteBrandingRepository;`
- `this.brandScores = new SqliteBrandScoreRepository(this.db);` added after `this.branding = new SqliteBrandingRepository(this.db);`

**`packages/dashboard/src/db/adapter.ts`** — two additions:
- `import type { BrandScoreRepository } from './interfaces/brand-score-repository.js';`
- `readonly brandScores: BrandScoreRepository;` on the `StorageAdapter` interface

### Test Suite (packages/dashboard/tests/db/brand-score-repository.test.ts)

8 tests covering the full Phase 15 ↔ migration 043 round-trip contract. Uses temp-file `SqliteStorageAdapter` + `storage.migrate()` so the wiring from Task 2 is exercised on every test.

| # | Test | Phase 15 decision pinned |
|---|------|--------------------------|
| 1 | round-trips a fully scored ScoreResult including per-dimension SubScoreDetail | D-12, D-13 (ScoreResult + SubScore tagged unions), D-14 (CoverageProfile) |
| 2 | round-trips a scored ScoreResult containing an unscorable typography sub-score | D-13 (nested SubScore can be unscorable inside a scored top-level), D-16 (no number \| null) |
| 3 | round-trips a top-level unscorable ScoreResult and stores NULL score columns (verified via raw SQL) | D-06 (no null-to-zero coercion), D-15 (UnscorableReason enum) |
| 4 | round-trips an all-subs-unscorable ScoreResult | D-15 (second UnscorableReason literal proves the whitelist works beyond one variant) |
| 5 | returns null from getLatestForScan when no row exists for the scan_id | D-16 (null vs unscorable distinction) |
| 6 | returns history rows ordered by computedAt DESC and respects the limit | Append-only + indexing contract |
| 7 | isolates getHistoryForSite results to the requested (orgId, siteUrl) | Index scope correctness |
| 8 | retag scenario appends a new row instead of updating in place | Append-only invariant (T-16-02-01 threat mitigation) |

Test 6 uses raw SQL to control `computed_at` timestamps deterministically — the typed `insert()` always uses `new Date().toISOString()` and would otherwise race within the same millisecond, making chronological assertions flaky. Write-path verification lives in Tests 1-4 and 8.

## Verification

| Check | Result |
|-------|--------|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | PASS — 0 errors |
| `npx vitest run tests/db/brand-score-repository.test.ts` | PASS — 8/8 tests, 120ms |
| `npx vitest run tests/db/migration-043-brand-scores.test.ts tests/db/migrations.test.ts tests/db/orgs.test.ts tests/db/brand-score-repository.test.ts` | PASS — 42/42 tests, 684ms |
| `npx vitest run tests/db/branding-repository-system.test.ts tests/db/scans.test.ts` | PASS — 28/28 tests, 599ms (pre-existing regression clean) |
| `grep -ic "UPDATE brand_scores" packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` | 0 (append-only invariant) |
| `grep -cE "\?\? 0\|\|\| 0" packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` | 0 (D-06 no null coercion) |
| `grep -c "export class SqliteBrandScoreRepository implements BrandScoreRepository" packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` | 1 |
| `grep -c "brandScores: BrandScoreRepository" packages/dashboard/src/db/adapter.ts` | 1 |
| `grep -c "this.brandScores = new SqliteBrandScoreRepository" packages/dashboard/src/db/sqlite/index.ts` | 1 |
| `grep -cE "number \| null\|null \| number" packages/dashboard/src/db/interfaces/brand-score-repository.ts` | 0 (D-16 no null-number leak at boundary) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] rowToScoreResult read-path predicate was too strict**
- **Found during:** Task 3, running Test 2 (`round-trips a scored ScoreResult containing an unscorable typography sub-score`)
- **Issue:** The plan's `rowToScoreResult` code block (Task 2 action Step 1) used `allScoreColumnsPresent = row.overall !== null && row.color_contrast !== null && row.typography !== null && row.components !== null && row.subscore_details !== null` as the discriminator between scored and unscorable. This wrongly demoted a scored top-level result to unscorable whenever any nested `SubScore` was itself unscorable (e.g. Test 2 inserts a scored top-level where only the `typography` sub is unscorable — that writes NULL to the `typography` column, which then flipped the read path to the unscorable branch and threw inside `assertUnscorableReason` because `unscorable_reason` was legitimately NULL for a top-level scored row).
- **Root cause:** Phase 15 D-13 allows any per-dimension `SubScore` to be unscorable inside an otherwise scored top-level `ScoreResult`. The per-dimension score columns (`color_contrast`, `typography`, `components`) are denormalized caches of `subscore_details.*.value` for the scored-sub case — they are legitimately NULL for nested unscorable subs. The authoritative per-dimension source on read is the `subscore_details` JSON column, not the individual score columns.
- **Fix:** Refined the discriminator to `isTopLevelScored = row.overall !== null && row.subscore_details !== null`. Added an 8-line comment block on `rowToScoreResult` linking the invariant to Phase 15 D-13. The insert path was not touched — it was already correct; only the read-path predicate needed loosening.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` (8-line edit in `rowToScoreResult`)
- **Commit:** `6e61e8f`
- **How the plan's must-have squares with the fix:** The must-have "Repository writes scored ScoreResult: all 4 score columns populated" implicitly assumed all 3 sub-scores are themselves scored. Test 2 encodes the Phase 15 D-13 edge case directly and is the tie-breaker — the plan's TDD flow is designed to surface exactly this kind of implicit assumption.

**2. [Rule 1 - Bug] ORDER BY needed a deterministic tie-breaker for same-millisecond appends**
- **Found during:** Task 3, running Test 8 (`retag scenario appends a new row instead of updating in place`)
- **Issue:** Test 8 calls `storage.brandScores.insert(...)` twice back-to-back for the same `scan_id` and asserts `getLatestForScan()` returns the second-written row (with `overall = 90`). Both `insert()` calls produce an ISO-ms `computed_at` that can collide inside the same millisecond. With `ORDER BY computed_at DESC LIMIT 1` and no tie-breaker, SQLite's choice among ties is undefined — the test failed because the first-written row (`overall = 73`) came back instead of the second.
- **Root cause:** `Date.toISOString()` is locked at millisecond precision. Two synchronous `repo.insert()` calls inside the same event-loop tick routinely land on the same ms. The append-only "latest row wins" contract requires a deterministic ordering that doesn't depend on sub-ms clock precision.
- **Fix:** Added `rowid DESC` as the secondary sort key on both `SELECT_BY_SCAN_SQL` and `SELECT_HISTORY_FOR_SITE_SQL`. SQLite's implicit ROWID is monotonic across inserts on the same table (the table does not use WITHOUT ROWID), so the most-recently-inserted row is always returned first among ties. Added an 8-line comment block explaining the reasoning. The history-ordering test uses explicit non-colliding timestamps so it is unaffected.
- **Files modified:** `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` (8-line comment + 2 `ORDER BY` clause edits)
- **Commit:** `6e61e8f` (same commit as the first deviation — both read-path bugs surfaced during the same TDD run of the test suite, and the plan commits the test file + its driving impl fixes together per TDD convention)

No other deviations. No auth gates. No architectural changes. No blockers. The interface file (Task 1) and the wiring edits (Task 2 Steps 2-4) executed verbatim; both deviations lived inside the repository implementation file created in Task 2 Step 1, caught by the test suite in Task 3.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `d6b5611` | `feat(16-02): add BrandScoreRepository interface + context + history types` |
| 2 | `6cbf508` | `feat(16-02): implement SqliteBrandScoreRepository with append-only insert` |
| 3 | `6e61e8f` | `test(16-02): add SqliteBrandScoreRepository round-trip + append-only suite` (includes both Rule 1 fixes to the repository impl) |

## Downstream Contract (consumed by Phase 17 / Phases 18-21)

Phase 17 orchestrator will call:
```typescript
await storage.brandScores.insert(scoreResult, {
  scanId, orgId, siteUrl,
  guidelineId: guideline.id,
  guidelineVersion: guideline.version,
  mode: 'embedded',  // or 'remote' depending on BrandingOrchestrator path
  brandRelatedCount,
  totalIssues,
});
```

Phase 18 retag path and Phase 20/21 read paths will call:
```typescript
const latest = await storage.brandScores.getLatestForScan(scanId);
// null → no score recorded (pre-v2.11.0 scan), render "not yet scored" empty state
// { kind: 'unscorable', reason } → scored but unscorable, render reason-specific empty state
// { kind: 'scored', overall, color, typography, components, coverage } → render widget

const trend = await storage.brandScores.getHistoryForSite(orgId, siteUrl, 30);
// Rows DESC by computedAt; caller reverses for chronological chart rendering
```

**Invariants downstream agents can rely on:**
- `getLatestForScan` returns the most-recently-inserted row among any `computed_at` ties (rowid tie-breaker)
- Nested unscorable sub-scores inside a scored top-level result round-trip verbatim (Test 2)
- `contributingWeight` in the reconstructed `CoverageProfile` is whatever Phase 15 wrote — the repository does not recompute or mutate it
- No UPDATE statements exist on `brand_scores` — retags are append-only, preserving full history
- Unknown `unscorable_reason` values will throw at read time (not silently fall through) — defense against a future writer that bypasses this repository

## Known Stubs

None. This is a repository layer; all values flow through from Phase 15 types directly.

## Threat Flags

None. No new network endpoints, auth paths, file access, or schema changes beyond the `brand_scores` surface already declared in the Plan 16-02 threat model.

## Self-Check: PASSED

- [x] `packages/dashboard/src/db/interfaces/brand-score-repository.ts` — FOUND (75 lines)
- [x] `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` — FOUND (248 lines)
- [x] `packages/dashboard/src/db/sqlite/repositories/index.ts` — modified (new export line)
- [x] `packages/dashboard/src/db/sqlite/index.ts` — modified (import + field + constructor)
- [x] `packages/dashboard/src/db/adapter.ts` — modified (import + field)
- [x] `packages/dashboard/tests/db/brand-score-repository.test.ts` — FOUND (381 lines, 8 tests)
- [x] Commit `d6b5611` — FOUND in `git log`
- [x] Commit `6cbf508` — FOUND in `git log`
- [x] Commit `6e61e8f` — FOUND in `git log`
- [x] `npm run lint` exits 0
- [x] `vitest run tests/db/brand-score-repository.test.ts` — 8/8 pass
- [x] `vitest run tests/db/migration-043-brand-scores.test.ts tests/db/migrations.test.ts tests/db/orgs.test.ts tests/db/brand-score-repository.test.ts` — 42/42 pass (regression clean)
- [x] `grep -ic "UPDATE brand_scores" …/brand-score-repository.ts` returns 0
- [x] `grep -cE "\?\? 0|\|\| 0" …/brand-score-repository.ts` returns 0
- [x] All success criteria satisfied
