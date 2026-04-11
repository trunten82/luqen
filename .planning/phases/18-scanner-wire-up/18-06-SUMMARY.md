---
phase: 18-scanner-wire-up
plan: 06
status: complete
verdict: PASS
started_at: 2026-04-11T17:40Z
completed_at: 2026-04-11T17:50Z
---

# Plan 18-06 Summary — Post-Rewire Latency Gate

## Objective

Capture post-rewire scanner latency against the Plan 18-01 baseline, compute the delta, and produce a literal PASS/FAIL verdict. Phase 18 success criterion #5 (<15% latency regression) depends on this gate.

## Verdict: **PASS** ✅

**Grand median:** 14951 ms (baseline) → 14759 ms (post) = **−1.3%**

**All measured sites ran *faster* post-rewire.** No per-site delta approached the +25% ceiling. The grand median stayed well inside the +15% threshold (ceiling was 17194 ms; actual post was 14759 ms).

| Site | Baseline | Post | Delta | Result |
|------|----------|------|-------|--------|
| aperol.com | 19207 ms | 17549 ms | **−8.6%** | ✅ PASS |
| inps.it    | 11835 ms | 10845 ms | **−8.4%** | ✅ PASS |
| sky.it     | 14951 ms | 14759 ms | **−1.3%** | ✅ PASS |
| sap.com    | TIMEOUT  | EXCLUDED | — | EXCLUDED |

**Phase 18 success criterion #5 CLEARED. Phase 18 latency gate: PASSED. The rewire ships.**

## Tasks Completed

| # | Task | Output | Status |
|---|------|--------|--------|
| 1 | Run post-rewire bench + write `18-06-POST.md` | Real numbers captured at git sha `d484283` | ✓ |
| 2 | Compare against baseline + write `18-06-GATE.md` | Literal `## Latency Gate Verdict: PASS` | ✓ |

## Pre-conditions verified before the bench

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c "this.brandingOrchestrator.matchAndScore" src/scanner/orchestrator.ts` | 1 | 1 ✓ |
| `grep -c "BrandingMatcher" src/scanner/orchestrator.ts` | 0 | 0 ✓ |
| `grep -c "brandingOrchestrator.matchAndScore" src/services/branding-retag.ts` | 1 | 1 ✓ |
| `grep -c "LEFT JOIN brand_scores" src/db/sqlite/repositories/scan-repository.ts` | 1+ | 2 ✓ |

The rewire is live on HEAD. The bench measured the correct code.

## Analysis — why no regression

The rewire's net effect on the scan hot path is essentially neutral:

**Old inline path (pre-rewire):**
- `storage.branding.getGuidelineForSite(url, orgId)` (SQLite lookup)
- `await import('@luqen/branding')` (dynamic module import — cold once per process)
- `new BrandingMatcher()` + `.match(allIssues, guideline)` (pure in-memory aggregation)
- Enrichment loop over `reportData.pages`

**New orchestrator path (post-rewire):**
- `storage.branding.getGuidelineForSite(url, orgId)` — same SQLite lookup
- `this.brandingOrchestrator.matchAndScore(matchContext)`:
  - `orgRepository.getBrandingMode(orgId)` — one additional SQLite lookup (~sub-millisecond; hot page cache)
  - `embeddedAdapter.matchForSite(...)` — wraps the same `BrandingMatcher` (static import, no dynamic cost)
  - `calculateBrandScore(branded, guideline)` — pure in-memory arithmetic over ≤100 issues (~sub-millisecond)
- `brandScoreRepository.insert(scoreResult, scanContext)` — one additional SQLite transaction (~few ms; single INSERT with pre-computed JSON)
- Enrichment loop over `reportData.pages` (same as before)

Net per-scan overhead: ~5 ms upper bound. Relative to a 10-20 second pa11y + headless-browser + network scan, this is noise — indistinguishable from normal variance across two different wall-clock samples on public sites.

**The slight improvement** (−1.3% grand median) is most plausibly attributed to:
- Edge cache state variance on the target sites between the two runs (sample separation was ~80 minutes — enough for edge caches to shift)
- Natural run-to-run variance on public-internet sites
- Tiny overhead reduction from removing the dynamic `await import('@luqen/branding')` (which did cold-start the branding module once per process on the first scan in the baseline)

None of these are *guarantees* of permanent improvement, but they're all consistent with "the rewire did not regress". The critical number for the gate is the direction, not the magnitude.

## Execution Deviations

1. **Orchestrator inline execution** (matches 18-01 pattern). The bench was run inline by the orchestrator agent rather than through a gsd-executor subagent, to avoid the rate-limit interruption that hit the 18-01 executor attempt. Same site-by-site protocol under OS `timeout 900` wrapper, same methodology constants, same script. No fidelity loss.

2. **sap.com excluded from both sides.** The 18-01 baseline captured sap.com as TIMEOUT (OOM at 6 GB heap, OS-killed at 10 GB heap). Plan 18-06 did NOT attempt sap.com in the post-rewire bench because including it on one side but not the other would break apples-to-apples. The sentinel is documented in both POST.md and GATE.md, and the grand median is computed over the 3 sites that completed cleanly on both sides. This matches the Plan 18-06 sentinel-handling rule ("EXCLUDE from both sides, flag explicitly").

3. **sky.it run 3 anomaly replicated.** Both baseline and post-rewire showed a ~1400 ms run 3 for sky.it — consistent edge CDN short-circuit at the 4th consecutive request. Since the anomaly appears at the same position on both sides, sorted-median picks a stable middle value (14951 baseline, 14759 post) and the comparison is still valid. Documented in both artifacts.

## Files Created

- `/root/luqen/.planning/phases/18-scanner-wire-up/18-06-POST.md` — post-rewire measurement artifact with per-site tables, raw JSON, methodology, sap.com exclusion note
- `/root/luqen/.planning/phases/18-scanner-wire-up/18-06-GATE.md` — literal PASS verdict + side-by-side comparison table + both raw JSON blobs + rewire cost analysis
- `/root/luqen/.planning/phases/18-scanner-wire-up/18-06-SUMMARY.md` (this file)

## Zero source/test diff

```
git diff HEAD~1 -- packages/dashboard/src/ packages/dashboard/tests/ packages/dashboard/scripts/
```
returns empty. Plan 18-06 is verification-only — no source, test, or script edits.

## Requirements Completed

**BSTORE-02** latency clause cleared. The broader BSTORE-02 (scanner writes append-only brand_scores row per scan) was delivered by Plans 18-02/18-03. Plan 18-06 certifies it does so without regressing scan latency.

## Phase 18 Overall Progress

Plan 18-06 is the final plan of Phase 18. All 6 plans are now complete:
- ✓ 18-01 (baseline capture)
- ✓ 18-02 (DI plumbing refactor)
- ✓ 18-03 (scanner rewire)
- ✓ 18-04 (retag rewire + 13 call sites)
- ✓ 18-05 (LEFT JOIN trend query + BSTORE-04)
- ✓ 18-06 (post-rewire gate — PASS)

Phase 18 may now be marked complete. Requirements BSTORE-02, BSTORE-03, BSTORE-04, BSTORE-06 are all satisfied. The phase verifier can run final checks.
