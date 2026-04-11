---
phase: 16-persistence-layer
plan: 01
subsystem: dashboard/db
tags: [migration, sqlite, brand-scores, schema, persistence]
requires: []
provides:
  - DASHBOARD_MIGRATIONS contains id='043' brand-scores-and-org-branding-mode
  - brand_scores table (17 columns, 2 indexes, CHECK on mode)
  - organizations.branding_mode column (NOT NULL DEFAULT 'embedded')
  - Locked schema shape for Plan 16-02 (BrandScoreRepository)
affects:
  - packages/dashboard/src/db/sqlite/migrations.ts
  - packages/dashboard/tests/db/migration-043-brand-scores.test.ts
tech-stack:
  added: []
  patterns:
    - Single-transaction multi-statement migration (pattern from id='034' branding-guidelines-tables)
    - PRAGMA-introspection schema testing against :memory: DB + real DASHBOARD_MIGRATIONS
key-files:
  created:
    - packages/dashboard/tests/db/migration-043-brand-scores.test.ts
  modified:
    - packages/dashboard/src/db/sqlite/migrations.ts
decisions:
  - subscore_details TEXT column added to locked schema to close Phase 15 SubScoreDetail round-trip gap (additive, does not change research-locked columns)
  - CHECK (mode IN ('embedded','remote')) added as schema-level defence in depth atop the TypeScript literal union
  - id TEXT PRIMARY KEY notnull assertion dropped from test — SQLite historic quirk reports notnull=0 on TEXT PK; pk=1 is the authoritative check
metrics:
  duration: 2m36s
  tasks_completed: 2
  completed_date: 2026-04-11
---

# Phase 16 Plan 01: Persistence Layer — Migration 043 Summary

Migration 043 (`brand-scores-and-org-branding-mode`) landed as a single atomic `DASHBOARD_MIGRATIONS` entry creating the `brand_scores` table with nullable score columns + JSON coverage/subscore blobs + CHECK-constrained `mode` + FK CASCADE to `scan_records`, two indexes (`idx_brand_scores_scan`, `idx_brand_scores_org_site`), and the `organizations.branding_mode` column defaulting to `'embedded'` — all verified end-to-end by a new 10-test PRAGMA-introspection vitest suite.

## What Landed

### Migration Entry (packages/dashboard/src/db/sqlite/migrations.ts)

Appended exactly one new element to `DASHBOARD_MIGRATIONS`, immediately after id `'042'`:

```typescript
{
  id: '043',
  name: 'brand-scores-and-org-branding-mode',
  sql: `
CREATE TABLE IF NOT EXISTS brand_scores (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scan_records(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  guideline_id TEXT,
  guideline_version INTEGER,
  overall INTEGER,
  color_contrast INTEGER,
  typography INTEGER,
  components INTEGER,
  coverage_profile TEXT NOT NULL,
  subscore_details TEXT,
  unscorable_reason TEXT,
  brand_related_count INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('embedded','remote')),
  computed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_scores_scan ON brand_scores(scan_id);
CREATE INDEX IF NOT EXISTS idx_brand_scores_org_site ON brand_scores(org_id, site_url, computed_at);

ALTER TABLE organizations
  ADD COLUMN branding_mode TEXT NOT NULL DEFAULT 'embedded';
  `,
},
```

Atomicity comes from `MigrationRunner.run()` wrapping the `sql` block in `db.transaction(...)` (migrations.ts lines 55-62) — all four statements (table + two indexes + ALTER TABLE) land together or none do.

Diff scope: **+30 lines, -0 lines** on `migrations.ts`. Migrations 001-042 are byte-identical to before.

### Schema Decisions (locked in this plan)

Two additive refinements to the research-locked schema at `.planning/research/SUMMARY.md` lines 80-104:

1. **`subscore_details TEXT` column added.** Closes the SubScoreDetail round-trip research gap. The Phase 15 `SubScore` discriminated union carries per-dimension `detail` objects (`ColorSubScoreDetail`, `TypographySubScoreDetail`, `ComponentsSubScoreDetail`) that the locked schema did not preserve. Plan 16-02's `BrandScoreRepository` will populate this column on insert (`{ color, typography, components }` JSON when `kind === 'scored'`; `NULL` when `kind === 'unscorable'`) and deserialize it verbatim on read — eliminating the need for a dishonest synthetic fallback. Nullability preserves the "NULL means unscorable" invariant.

2. **`CHECK (mode IN ('embedded','remote'))` constraint added.** Defense in depth against any out-of-band writer that bypasses the typed repository (future migration scripts, SQLite REPL sessions, alternative adapters). The TypeScript literal union `'embedded' | 'remote'` remains the primary contract; the CHECK is the schema-level backstop. Test 9 exercises this by attempting to INSERT `mode = 'remote-but-typo'` and asserting the insert throws with `/CHECK constraint/i`.

Both additions are **strictly additive** — no column was renamed, retyped, reordered, or had its nullability changed from the research-locked shape.

### Test Suite (packages/dashboard/tests/db/migration-043-brand-scores.test.ts)

10 tests using in-memory better-sqlite3 (`:memory:`) with `foreign_keys = ON` and the real `DASHBOARD_MIGRATIONS` array run through `MigrationRunner`:

| # | Test | Asserts |
|---|------|---------|
| 1 | creates the brand_scores table | `sqlite_master` has one row with name `brand_scores` |
| 2 | locked column structure with nullable score columns | `PRAGMA table_info` returns exactly 17 columns with correct types, notnull flags, and `'0'` defaults on counters |
| 3 | creates both required indexes | `PRAGMA index_list` contains `idx_brand_scores_scan` and `idx_brand_scores_org_site` |
| 4 | org_site index column order | `PRAGMA index_info` returns `(org_id, site_url, computed_at)` in order |
| 5 | branding_mode column exists with embedded default | `PRAGMA table_info('organizations')` surfaces notnull=1, dflt_value=`'embedded'` |
| 6 | default applied to fresh row | INSERT without branding_mode → SELECT returns `'embedded'` |
| 7 | idempotent | Second `MigrationRunner.run(DASHBOARD_MIGRATIONS)` does not throw, `schema_migrations` row count for id `'043'` stays at 1 |
| 8 | no backfill | Parallel DB with all migrations through 042, insert scan_record, run 043 on top, assert byte-identical state |
| 9 | CHECK constraint rejects invalid mode | INSERT with `mode = 'remote-but-typo'` throws `/CHECK constraint/i` |
| 10 | FK cascade | DELETE scan_record removes its brand_scores children |

### PRAGMA Introspection Results (from test run)

- `PRAGMA table_info('brand_scores')` — **17 rows**
- `PRAGMA index_list('brand_scores')` — contains both `idx_brand_scores_scan` and `idx_brand_scores_org_site`
- `PRAGMA index_info('idx_brand_scores_org_site')` — 3 entries in order: `org_id`, `site_url`, `computed_at`
- `PRAGMA table_info('organizations')` — `branding_mode` column present with `notnull=1`, `dflt_value="'embedded'"`

### Column nullability map (brand_scores)

| Column | Type | NOT NULL | Default | Notes |
|--------|------|----------|---------|-------|
| id | TEXT | (PK quirk: reported notnull=0) | — | PRIMARY KEY |
| scan_id | TEXT | ✓ | — | FK → scan_records(id) ON DELETE CASCADE |
| org_id | TEXT | ✓ | — | |
| site_url | TEXT | ✓ | — | |
| guideline_id | TEXT | — | — | nullable |
| guideline_version | INTEGER | — | — | nullable |
| overall | INTEGER | — | — | nullable (Pitfall #3) |
| color_contrast | INTEGER | — | — | nullable (Pitfall #3) |
| typography | INTEGER | — | — | nullable (Pitfall #3) |
| components | INTEGER | — | — | nullable (Pitfall #3) |
| coverage_profile | TEXT | ✓ | — | JSON (CoverageProfile) |
| subscore_details | TEXT | — | — | JSON, NULL when unscorable |
| unscorable_reason | TEXT | — | — | nullable enum |
| brand_related_count | INTEGER | ✓ | 0 | |
| total_issues | INTEGER | ✓ | 0 | |
| mode | TEXT | ✓ | — | CHECK (mode IN ('embedded','remote')) |
| computed_at | TEXT | ✓ | — | ISO audit timestamp |

## Verification

| Check | Result |
|-------|--------|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | ✓ 0 errors |
| `npx vitest run tests/db/migration-043-brand-scores.test.ts` | ✓ 10/10 passed (141ms) |
| `npx vitest run tests/db/migrations.test.ts tests/db/orgs.test.ts` | ✓ 24/24 passed (regression clean) |
| `grep -c "id: '043'" packages/dashboard/src/db/sqlite/migrations.ts` | 1 |
| `grep -c "CREATE TABLE IF NOT EXISTS brand_scores" …/migrations.ts` | 1 |
| `grep -c "CREATE INDEX IF NOT EXISTS idx_brand_scores_scan" …/migrations.ts` | 1 |
| `grep -c "CREATE INDEX IF NOT EXISTS idx_brand_scores_org_site" …/migrations.ts` | 1 |
| `grep -c "ADD COLUMN branding_mode TEXT NOT NULL DEFAULT 'embedded'" …/migrations.ts` | 1 |
| `grep -c "subscore_details TEXT" …/migrations.ts` | 1 |
| `grep -c "coverage_profile TEXT NOT NULL" …/migrations.ts` | 1 |
| `grep -F "CHECK (mode IN ('embedded','remote'))" …/migrations.ts` | 1 line |
| `git diff --stat …/migrations.ts` | 30 insertions, 0 deletions |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] id column notnull assertion removed from structure test**
- **Found during:** Task 2 vitest run (9/10 passed; test "has the locked column structure with nullable score columns (Pitfall #3)" failed on `expect(byName.get('id')?.notnull).toBe(1)`)
- **Issue:** SQLite's `PRAGMA table_info` reports `notnull=0` for `TEXT PRIMARY KEY` columns. This is a well-known SQLite historic quirk — non-INTEGER primary keys do not imply `NOT NULL` in the table_info report. The plan's expected behavior stated "id PK NOT NULL" but the authoritative primary-key check is `pk=1`, not `notnull=1`.
- **Fix:** Removed the single `expect(byName.get('id')?.notnull).toBe(1)` line and added an explanatory comment. The `pk=1` assertion (preserved on the previous line) is the authoritative primary-key check. The schema itself was NOT touched — this is a test-correction, not a schema change.
- **Files modified:** `packages/dashboard/tests/db/migration-043-brand-scores.test.ts` (test-only edit, 1 line removed + 4-line comment added)
- **Commit:** `dad2720`

No other deviations. Both tasks executed verbatim otherwise; no architectural changes, no auth gates, no blockers.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `c8b9460` | `feat(16-01): add migration 043 brand_scores table + organizations.branding_mode` |
| 2 | `dad2720` | `test(16-01): add migration 043 brand_scores schema PRAGMA introspection suite` |

## Downstream Contract (consumed by Plan 16-02)

Plan 16-02 (BrandScoreRepository) will rely on:
- **Column order:** the exact order above — repository SQL will bind parameters positionally in this order
- **subscore_details JSON shape:** `{ color: SubScore, typography: SubScore, components: SubScore }` when `ScoreResult.kind === 'scored'`; `NULL` when `kind === 'unscorable'`
- **Nullability invariant:** repository `insert()` passes literal `null` (not `0`) for every score column whose category is unscorable; read path reconstructs tagged-union `SubScore.kind === 'unscorable'` when it sees SQL NULL + non-empty `unscorable_reason`
- **Append-only contract:** no `UPDATE` statements — retag appends a new row with a fresh `computed_at`
- **FK cascade:** repository does not need to manually delete brand_scores on scan removal — SQLite handles it via `ON DELETE CASCADE`

## Self-Check: PASSED

- [x] `packages/dashboard/src/db/sqlite/migrations.ts` — FOUND (edited, 30-line insertion verified)
- [x] `packages/dashboard/tests/db/migration-043-brand-scores.test.ts` — FOUND (new file, 269 lines)
- [x] `.planning/phases/16-persistence-layer/16-01-SUMMARY.md` — FOUND (this file)
- [x] Commit `c8b9460` — FOUND in `git log`
- [x] Commit `dad2720` — FOUND in `git log`
- [x] All acceptance criteria (greps + typecheck + vitest) satisfied
- [x] No regression in `tests/db/migrations.test.ts` or `tests/db/orgs.test.ts` (24/24 passed)
