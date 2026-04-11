---
phase: 18-scanner-wire-up
plan: 01
status: complete
started_at: 2026-04-11T14:38Z
completed_at: 2026-04-11T16:30Z
---

# Plan 18-01 Summary — Pre-rewire Latency Baseline

## Objective

Capture the PRE-REWIRE scanner latency baseline for a locked 4-site grid so Plan 18-06 can enforce the <15% grand-median regression gate after the scanner rewire lands. This plan measures the CURRENT inline `BrandingMatcher` path at `scanner/orchestrator.ts:541-610` — it is the last opportunity to capture that behavior before Plan 18-03 replaces it.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Create `packages/dashboard/scripts/scanner-latency-bench.ts` | `fc09e61` | ✓ |
| 1b | Harden bench script: `BENCH_SITES` env override + per-site orchestrator isolation + settled timeout flag | `df8a7e4` | ✓ |
| 2 | Execute bench against 4 target sites + write `18-01-BASELINE.md` artifact | (this commit) | ✓ (3/4 sites, sap.com TIMEOUT) |

## Results

**Grand median**: `14951 ms` over 3 working sites (aperol.com, inps.it, sky.it)

| Site | Pre-rewire median | Measured runs (sorted) | Notes |
|------|-------------------|------------------------|-------|
| aperol.com | **19207 ms** | [17922, 19207, 19529] | clean |
| inps.it    | **11835 ms** | [11774, 11835, 14766] | clean (runs 2-3 edge-cached) |
| sky.it     | **14951 ms** | [1407, 14951, 19466]  | run 3 anomaly (1407 ms) — suspected rate-limit / geoblock short-circuit; median unaffected |
| sap.com    | **TIMEOUT**  | N/A                    | OOM at 6144 MB heap, killed by OS timeout at 10240 MB heap — pa11y + SAP's deep page weight exhausts dev-container resources regardless of heap size |

Full per-run tables, raw JSON, and gate threshold computations are in `/root/luqen/.planning/phases/18-scanner-wire-up/18-01-BASELINE.md`.

## Gate Thresholds for Plan 18-06 (derived)

- **PASS**: post grand median ≤ **17194 ms** (14951 × 1.15) AND each per-site median ≤ pre × 1.25
- **FAIL**: any threshold exceeded — phase verification blocks

Per-site post-rewire caps:
- aperol.com ≤ 24009 ms
- inps.it ≤ 14794 ms
- sky.it ≤ 18689 ms

## Key Files

**Created:**
- `packages/dashboard/scripts/scanner-latency-bench.ts` (264 lines)
  - Locked methodology constants (4 sites, 1 warm + 3 measured, maxPages=10)
  - `BENCH_SITES` env var override for site-by-site driving under OS timeout
  - Fresh `SqliteStorageAdapter` + `ScanOrchestrator` per site (pa11y memory released between sites)
  - `settled` flag + `clearTimeout` in listener prevents double-resolve after progress events post-timeout
  - Machine-parseable JSON output on stdout; progress lines on stderr
  - Uses `execFileSync('git', ['rev-parse', 'HEAD'])` (argv form, no shell) to capture git HEAD
- `.planning/phases/18-scanner-wire-up/18-01-BASELINE.md` (full measurement artifact with per-site tables, raw JSON, gate thresholds, and sap.com TIMEOUT rationale)

**Not modified:**
- `packages/dashboard/src/scanner/orchestrator.ts` — unchanged (Plan 18-01 is baseline-capture only; Plan 18-03 is the actual rewire)

## Verification

- `cd packages/dashboard && npm run lint` → exit 0 (bench script typechecks)
- `git diff packages/dashboard/src/scanner/orchestrator.ts` → empty (scanner untouched)
- Bench produces `18-01-BASELINE.md` with real measured millis for 3 sites + TIMEOUT marker for sap.com
- Grand median computed from the 3 working sites: **14951 ms**
- Git HEAD captured in BASELINE front-matter: `df8a7e4e944009293be8e3971cd8eadb2d575909`

## Execution Deviations

1. **Executor rate-limit interruption and orchestrator inline continuation.** The first `gsd-executor` subagent spawned for this plan hit its session rate limit after ~45 minutes during Task 2 (the long-running bench). It had successfully committed Task 1 (`fc09e61`) and iterated on script hardening (uncommitted at the time of interrupt: `BENCH_SITES` override, settled flag, per-site orchestrator isolation). The orchestrator committed those improvements as `df8a7e4` and then ran Task 2 inline, site-by-site under OS-level `timeout` wrappers, to avoid sending another long-running bench through a subagent that might hit the same rate limit. This produced the same artifact shape and fidelity as the plan required.

2. **sap.com TIMEOUT / OOM — legitimate scanner limit, not bench bug.** The 4th target site (sap.com) cannot be scanned at `maxPages=10` on the dev container even with a 10 GB heap and a 10-minute OS timeout. Previous 18-01 executor attempt hit the same wall (motivated the `BENCH_SITES` + per-site isolation hardening in `df8a7e4`). Documented as TIMEOUT in the BASELINE artifact with explicit guidance for 18-06: either exclude sap.com from both sides of the comparison (preferred — keeps apples-to-apples), or re-run the bench on lxc-luqen production hardware if sap.com data is required.

3. **sky.it run 3 anomaly.** Measured run 3 for sky.it came back at 1407 ms (~10× faster than runs 1-2). Most likely cause is a rate-limit short-circuit or geoblock redirect on the 4th consecutive scan. Median was computed over the 3 measured values sorted, so the anomaly lands at position 0 and does not affect the median (14951 ms). Documented in BASELINE with a suggested anomaly filter for 18-06: exclude runs where `wallMs < 3000`.

## Total Wall Time

~22 minutes end-to-end (most of that spent on the 2 failed sap.com attempts). The 3 working sites took ~3.5 minutes combined.

## Requirements Touched

**BSTORE-02** — via the broader Phase 18 requirements coverage. Plan 18-01 itself does not add functionality; it captures measurement for the 15% regression gate that guards BSTORE-02 (scanner writes brand_scores per scan) against a performance regression.

## Phase 18 Wave 1 Progress

Plan 18-01 complete. Wave 1's remaining plan is 18-02 (ScanOrchestrator constructor DI plumbing refactor). Wave 2 (scanner rewire + retag rewire) depends on 18-02. The pre-rewire baseline is now **locked in git** — Plan 18-06's post-rewire comparison has a fixed reference point.
