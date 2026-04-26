---
phase: 18-scanner-wire-up
verified: 2026-04-11T18:15:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 18: Scanner Wire-Up — Verification Report

**Phase Goal:** Scanner and retag pipeline call the Phase 17 `BrandingOrchestrator` exactly once per scan, persist the resulting `ScoreResult` via the Phase 16 `BrandScoreRepository` (append-only, retag produces N+1 rows), preserve backwards-compatibility via LEFT JOIN trend queries for pre-v2.11.0 scans, and hold scan-completion latency within 15% of the current baseline.

**Verified:** 2026-04-11T18:15:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Requirements covered:** BSTORE-02, BSTORE-03, BSTORE-04, BSTORE-06

## Goal Achievement — ROADMAP Success Criteria

All 5 ROADMAP success criteria verified against the actual codebase. Must-haves from every plan (18-01 through 18-06) were cross-checked against grep-level invariants, test evidence, and the latency gate artifact.

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | `scanner/orchestrator.ts` calls `brandingOrchestrator.matchAndScore()` exactly once per scan (Pitfall #10) | VERIFIED | `grep -c "this.brandingOrchestrator.matchAndScore" src/scanner/orchestrator.ts` = 1 (line 640). `BrandingMatcher` references = 0. `await import('@luqen/branding')` = 0 (only a `@luqen/core` dynamic import remains at line 269, unrelated). Pinned by Test 1 in `tests/scanner/branding-rewire.test.ts` with `expect(brandingOrchestrator.matchAndScore).toHaveBeenCalledTimes(1)`. |
| 2 | `services/branding-retag.ts` calls `matchAndScore()` the same way; retag appends NEW `brand_scores` rows (never UPDATE) | VERIFIED | `grep -c "brandingOrchestrator.matchAndScore" src/services/branding-retag.ts` = 1. `brandScoreRepository.insert` = 2 (matched + degraded branches). `BrandingMatcher` = 0. All 13 retag call sites updated to the 5-arg signature: `routes/api/branding.ts:423` (1), `routes/admin/branding-guidelines.ts` (10 invocations at lines 468, 686, 797, 871, 903, 962, 994, 1042, 1074, 1145), `graphql/resolvers.ts:751,770` (2). BSTORE-03 append-only pinned by real-SQLite `SELECT COUNT(*) FROM brand_scores WHERE scan_id = ?` assertion in `tests/services/branding-retag-rewire.test.ts:269` (6 tests total, all marked `BSTORE-03`). |
| 3 | Every completed scan writes exactly one `brand_scores` row (scored / degraded / no-guideline variants); persistence failure non-blocking | VERIFIED | Dispatch block at `scanner/orchestrator.ts:654` (matched → insert), `:708` (degraded → insert unscorable variant), `:751` (no-guideline → skip). Two `brandScoreRepository.insert` call sites (lines 689 + 732), both wrapped in nested non-blocking try/catch. Tests 4, 5, 6, 7 in `branding-rewire.test.ts` pin: Test 4 (CRITICAL) degraded-still-persists with `toHaveBeenCalledTimes(1)` + `writtenResult.kind === 'unscorable'`; Test 5 no-guideline-no-persist; Test 6 persistence-failure non-blocking (insert throws → scan still `complete`); Test 7 (BSTORE-06) no-backfill. 7/7 invariant tests pass. |
| 4 | Trend queries use LEFT JOIN brand_scores with NULL handling; pre-v2.11.0 scans render `brandScore: null` strictly, never fabricated 0 | VERIFIED | `grep -c "LEFT JOIN brand_scores" src/db/sqlite/repositories/scan-repository.ts` = 2 (both `getTrendData` sites). `INNER JOIN brand_scores` = 0. `ScanRecord.brandScore?: ScoreResult \| null` in `src/db/types.ts:77`. Shared mapper `brand-score-row-mapper.ts` exists and is imported by `brand-score-repository.ts:13,178,191` (2+ references to `brand-score-row-mapper` — confirms D-13/D-15 reconstruction is a single source of truth across both read paths). BSTORE-04 regression: `tests/db/scan-repository-trend-brand-score.test.ts:102` asserts `expect(entry.brandScore).toBe(null)` strictly (not `toBeFalsy`, not `toBeNull`). 5/5 tests pass. |
| 5 | Post-rewire scan latency within +15% of baseline (per-site ≤ +25%) | VERIFIED (PASS gate) | `.planning/phases/18-scanner-wire-up/18-06-GATE.md` contains the literal line `## Latency Gate Verdict: PASS`. Grand median: **14951 ms (baseline) → 14759 ms (post) = −1.3%**. All 3 measured sites ran *faster* post-rewire: aperol.com −8.6%, inps.it −8.4%, sky.it −1.3%. sap.com TIMEOUT-excluded from both sides per the sentinel rule (OOM at 10 GB heap cap, documented in 18-01-BASELINE.md and mirrored on 18-06-POST.md). Per the objective, the 18-06 gate is authoritative — verdict **NOT re-run**, only parsed. |

**Score: 5/5 truths verified**

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/dashboard/src/scanner/orchestrator.ts` | Rewired scanner, `this.brandingOrchestrator.matchAndScore` called once, inline block + dynamic branding import deleted | VERIFIED | 1 matchAndScore call, 2 insert calls, 3 tagged-union branches, 0 BrandingMatcher references |
| `packages/dashboard/src/services/branding-retag.ts` | Rewired retag, 5-arg signature, append-only insert | VERIFIED | `brandingOrchestrator.matchAndScore` x1, `brandScoreRepository.insert` x2, three kind branches (matched/degraded/no-guideline ignored with comment) |
| `packages/dashboard/src/db/sqlite/repositories/scan-repository.ts` | `getTrendData` uses LEFT JOIN with MAX(rowid) latest-per-scan subquery | VERIFIED | 2 `LEFT JOIN brand_scores` occurrences, 0 `INNER JOIN` occurrences |
| `packages/dashboard/src/db/sqlite/repositories/brand-score-row-mapper.ts` | Shared row → ScoreResult mapper file | VERIFIED | File exists, imported by `brand-score-repository.ts` (2 imports/usages) |
| `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` | Imports shared mapper instead of inline reconstruction | VERIFIED | `import { brandScoreRowToResult } from './brand-score-row-mapper.js'` (line 13) |
| `packages/dashboard/src/db/types.ts` | `ScanRecord.brandScore?: ScoreResult \| null` field added | VERIFIED | Line 77: `readonly brandScore?: ScoreResult \| null;` |
| `packages/dashboard/src/routes/api/branding.ts` | Retag call updated to 5-arg form | VERIFIED | Line 423 passes `server.brandingOrchestrator` + `storage.brandScores` |
| `packages/dashboard/src/routes/admin/branding-guidelines.ts` | 10 retag call sites updated | VERIFIED | All 10 invocations (lines 468, 686, 797, 871, 903, 962, 994, 1042, 1074, 1145) pass 5-arg form; Fastify module augmentation for `brandingOrchestrator` declared inline |
| `packages/dashboard/src/graphql/resolvers.ts` | 2 retag call sites updated | VERIFIED | Lines 751, 770 use `ctx.brandingOrchestrator` + `ctx.storage.brandScores` |
| `packages/dashboard/tests/scanner/branding-rewire.test.ts` | 7 invariant tests from Plan 18-03 | VERIFIED | 7 `it()` blocks at lines 258, 280, 313, 353, 381, 400, 429 — Test 1 (one-match-call), Test 2 (matched persist), Test 3 (display enrichment), Test 4 CRITICAL (degraded-still-persists), Test 5 (no-guideline no-persist), Test 6 (persistence-failure non-blocking), Test 7 (BSTORE-06 no-backfill). All pass. |
| `packages/dashboard/tests/services/branding-retag-rewire.test.ts` | Append-only test with real SQLite + raw COUNT | VERIFIED | 6 tests, `BSTORE-03` referenced 6 times, raw `SELECT COUNT(*) as n FROM brand_scores WHERE scan_id = ?` prepared statement at line 269 executes against real `SqliteStorageAdapter` tmp-file DB (not a mock counter). |
| `packages/dashboard/tests/db/scan-repository-trend-brand-score.test.ts` | BSTORE-04 strict-null regression | VERIFIED | 5 tests. `expect(entry.brandScore).toBe(null)` at line 102, plus line 219 `not.toBe(null)` (matched case) and line 222 `toBe(null)` (mixed-org case). Strict equality, not `toBeFalsy`/`toBeNull` tolerant. |
| `.planning/phases/18-scanner-wire-up/18-01-BASELINE.md` | Pre-rewire baseline with methodology + raw JSON | VERIFIED | Captured 2026-04-11, git sha `df8a7e4`, grand median 14951 ms (3 working sites), sap.com TIMEOUT-excluded per sentinel rule |
| `.planning/phases/18-scanner-wire-up/18-06-POST.md` | Post-rewire numbers at rewired HEAD | VERIFIED | Captured 2026-04-11, git sha `d484283`, grand median 14759 ms |
| `.planning/phases/18-scanner-wire-up/18-06-GATE.md` | Literal PASS/FAIL verdict | VERIFIED | Contains `## Latency Gate Verdict: PASS` (line 34); grand delta −1.3%; all 3 measured sites PASS; no site approaches +25% ceiling |

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `scanner/orchestrator.ts runScan` | `brandingOrchestrator.matchAndScore` | constructor-injected, single call at line 640 | WIRED | Outer guard ensures both deps are present; nested try/catch around persistence keeps scan non-blocking |
| `scanner/orchestrator.ts matched branch` | `brandScoreRepository.insert` | nested try/catch at line 689 | WIRED | Persists ScoreResult with `{ scanId, orgId, siteUrl, guidelineId, guidelineVersion, mode, brandRelatedCount, totalIssues }` context |
| `scanner/orchestrator.ts degraded branch` | `brandScoreRepository.insert` | nested try/catch at line 732 | WIRED | Persists `{ kind: 'unscorable', reason: 'no-branded-issues' }` variant with `brandRelatedCount: 0` |
| `server.ts ScanOrchestrator construction` | `brandingOrchestrator` + `storage.brandScores` | constructor-injected via `OrchestratorOptions` | WIRED | Phase 18-02 plumbing, Phase 18-03 activated |
| `retagScansForSite` | `brandingOrchestrator.matchAndScore` | parameter-injected, per-scan loop | WIRED | Signature extended to 5 args; all 13 callers updated |
| `retagScansForSite` | `brandScoreRepository.insert` | parameter-injected, per-scan loop, try/catch | WIRED | Append-only append-per-retag proven by raw COUNT test |
| `getTrendData SQL` | `brand_scores` table | LEFT JOIN + correlated MAX(rowid) subquery | WIRED | 2 LEFT JOIN sites in the file, row mapped via shared `brandScoreRowToResult` |
| `ScanRecord.brandScore` | Phase 15 `ScoreResult` tagged union | optional `?:` field, `ScoreResult \| null` type | WIRED | Three-state signal: `undefined` (legacy call), `null` (pre-v2.11.0 or no-guideline), `ScoreResult` (matched/degraded) |
| `brand-score-repository.ts` | shared `brand-score-row-mapper.ts` | import + single-source reconstruction | WIRED | Both read paths (direct repo + trend LEFT JOIN) use the same mapper — D-13/D-15 invariants cannot drift |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Dashboard typecheck (lint) | `cd packages/dashboard && npm run lint` (runs `tsc --noEmit`) | exit 0, no output beyond the npm banner | PASS |
| Full dashboard test suite | `cd packages/dashboard && npx vitest run` | 152 passed / 3 skipped files, **2495 tests passed / 40 skipped / 0 failed**, duration 157.79s | PASS |
| Scanner rewire invariant count | `grep -c "this.brandingOrchestrator.matchAndScore" src/scanner/orchestrator.ts` | 1 (exactly one call per scan) | PASS |
| Retag rewire invariant count | `grep -c "brandingOrchestrator.matchAndScore" src/services/branding-retag.ts` | 1 | PASS |
| Inline matcher removal | `grep -c "BrandingMatcher" src/scanner/orchestrator.ts` | 0 (class reference + JSDoc scrubbed) | PASS |
| LEFT JOIN trend query | `grep -c "LEFT JOIN brand_scores" src/db/sqlite/repositories/scan-repository.ts` | 2 | PASS |
| INNER JOIN safety check | `grep -c "INNER JOIN brand_scores" src/db/sqlite/repositories/scan-repository.ts` | 0 | PASS |
| Latency gate parse | `grep "Latency Gate Verdict" .planning/phases/18-scanner-wire-up/18-06-GATE.md` | `## Latency Gate Verdict: PASS` | PASS |

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| BSTORE-02 | 18-01, 18-02, 18-03, 18-06 | System writes one append-only `brand_scores` row per scan completion (scanner orchestrator), including composite + 3 sub-scores + coverage profile + mode + timestamps | SATISFIED | Scanner dispatch block writes row for matched + degraded variants via `brandScoreRepository.insert(...)`. 7/7 invariant tests pass. Latency gate PASSED. |
| BSTORE-03 | 18-04 | System writes one append-only `brand_scores` row per retag completion without overwriting prior rows — trend preserves history | SATISFIED | Retag rewired to 5-arg form, append-per-retag proven by real-SQLite `SELECT COUNT(*)` assertion (double-retag → 2 rows, N → N+1). 6/6 BSTORE-03 tests pass. |
| BSTORE-04 | 18-05 | User can see brand score history via server-side LEFT JOIN queries that include pre-v2.11.0 scans (NULL handled as empty-state, not zero) | SATISFIED | `getTrendData` rewritten with LEFT JOIN + MAX(rowid) subquery; ScanRecord.brandScore typed `ScoreResult \| null`; 5/5 regression tests pass; pre-v2.11.0 case asserted with strict `toBe(null)`. |
| BSTORE-06 | 18-03, 18-05 | System does NOT backfill historical scans — pre-v2.11.0 scans render empty-state, never fake `0` scores | SATISFIED | No backfill path added in scanner/retag code. Test 7 in `branding-rewire.test.ts` asserts scanner only inserts for current scan, never others. LEFT JOIN preserves NULL row for pre-v2.11.0 scans without fabricating defaults. |

All 4 requirements mapped to Phase 18 in REQUIREMENTS.md are satisfied. No orphaned requirements.

## Latency Gate (Criterion #5) — Explicit Confirmation

The authoritative gate verdict lives in `.planning/phases/18-scanner-wire-up/18-06-GATE.md`. Per the verification objective, the bench was NOT re-run; the gate file was parsed.

**Verdict parsed from 18-06-GATE.md:** `## Latency Gate Verdict: PASS`

**Deltas:**
- Grand median: 14951 ms (baseline, git `df8a7e4`) → 14759 ms (post, git `d484283`) = **−1.3%** (gate ceiling was +15% / 17194 ms)
- aperol.com: 19207 → 17549 = **−8.6%** (ceiling +25% / 24009 ms) — PASS
- inps.it: 11835 → 10845 = **−8.4%** (ceiling +25% / 14794 ms) — PASS
- sky.it: 14951 → 14759 = **−1.3%** (ceiling +25% / 18689 ms) — PASS
- sap.com: TIMEOUT on baseline side (OOM at 10 GB heap); EXCLUDED from both sides per the documented sentinel rule in 18-01-PLAN.md. Symmetric exclusion preserves apples-to-apples semantics.

All measured sites ran *faster* post-rewire. The rewire's net effect on the hot path is essentially neutral — the new orchestrator dispatches directly to `EmbeddedBrandingAdapter.matchForSite` which wraps the same `BrandingMatcher.match()` the old inline block called. The only additions are a sub-ms `OrgRepository.getBrandingMode` SQLite lookup and a few-ms `BrandScoreRepository.insert` transaction, both well below the pa11y + headless-browser wall time.

**Phase 18 success criterion #5 is CLEARED. Phase 18 latency gate: PASSED.**

## Anti-Patterns Scan

Spot-checked key modified files (`scanner/orchestrator.ts`, `branding-retag.ts`, `scan-repository.ts`, `brand-score-row-mapper.ts`, `brand-score-repository.ts`) — no TODO, FIXME, placeholder, hardcoded stub, or `return null` pattern introduced by Phase 18. The `void this.brandingOrchestrator; void this.brandScoreRepository;` plumbing markers from Plan 18-02 were deleted in Plan 18-03 (documented in 18-03-SUMMARY.md) — the fields are now actually consumed. No anti-patterns flagged.

## Human Verification Required

None. All goal-achievement criteria are automatable via grep/test/artifact inspection. The latency gate is measured by a deterministic script whose verdict is recorded in a git-committed artifact.

## Gaps Summary

No gaps. All 5 ROADMAP success criteria verified, all 4 requirements satisfied, full test suite green (2495 passed / 0 failed), lint clean, latency gate PASS verdict parsed from 18-06-GATE.md.

Phase 18 is complete from a goal-achievement standpoint. The v2.11.0 brand persistence milestone's highest-risk phase shipped without a latency regression. The scanner hot path, retag pipeline, and trend query are fully rewired to the Phase 16/17 foundations.

---

_Verified: 2026-04-11T18:15:00Z_
_Verifier: Claude (gsd-verifier), Opus 4.6 (1M context)_
