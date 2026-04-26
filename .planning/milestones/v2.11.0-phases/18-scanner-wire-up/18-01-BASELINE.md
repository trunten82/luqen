---
phase: 18-scanner-wire-up
plan: 01
artifact: pre-rewire-latency-baseline
captured_at: 2026-04-11T16:23:17Z
git_sha: df8a7e4e944009293be8e3971cd8eadb2d575909
---

# Phase 18 Pre-Rewire Latency Baseline

**Status:** Captured with 1 site TIMEOUT (sap.com — documented below)
**Grand median (3 working sites):** `14951 ms`
**Methodology:** 1 warm-up run (discarded) + 3 measured runs per site; `maxPages=10`; wall-clock ms from `startScan()` to `complete` / `failed` terminal event; `concurrency=1`; fresh `SqliteStorageAdapter` + `ScanOrchestrator` per site (pa11y memory released between sites).
**Bench script:** `packages/dashboard/scripts/scanner-latency-bench.ts` (commit `df8a7e4`)
**Execution driver:** `BENCH_SITES` env override, one OS `timeout` process per site (`timeout 600` or `timeout 900` depending on site weight); `NODE_OPTIONS=--max-old-space-size=4096` default, bumped to 10240 for sap.com retry.
**Scanner under test:** Pre-rewire inline `BrandingMatcher` path at `packages/dashboard/src/scanner/orchestrator.ts:541-610`. No Phase 18 rewire yet applied.

---

## Per-site measurements

### https://www.aperol.com/  —  median **19207 ms**

| Run | Type | Wall ms | Terminal |
|-----|------|---------|----------|
| 0   | warm-up (discarded) | 27398 | complete |
| 1   | measured | 17922 | complete |
| 2   | measured | 19207 | complete |
| 3   | measured | 19529 | complete |

Notes: clean run. Warm-up ~50% slower than measured runs (expected for cold pa11y/headless browser startup).

### https://www.inps.it/  —  median **11835 ms**

| Run | Type | Wall ms | Terminal |
|-----|------|---------|----------|
| 0   | warm-up (discarded) | 15918 | complete |
| 1   | measured | 14766 | complete |
| 2   | measured | 11835 | complete |
| 3   | measured | 11774 | complete |

Notes: clean run. Runs 2 and 3 are ~4s faster than run 1 — likely HTTP caching at the site edge. Still within normal variance.

### https://www.sky.it/  —  median **14951 ms**

| Run | Type | Wall ms | Terminal |
|-----|------|---------|----------|
| 0   | warm-up (discarded) | 27677 | complete |
| 1   | measured | 19466 | complete |
| 2   | measured | 14951 | complete |
| 3   | measured |  1407 | complete ⚠ |

⚠ **Run 3 anomaly**: 1407 ms is ~10× faster than runs 1–2 and inconsistent with the warm-up baseline. Most likely cause is sky.it returning a lightweight response (rate-limit short-circuit, geoblock redirect, or cached 304) rather than the full scan. The terminal event was still `complete` so the bench did not flag it.

**Effect on median**: sorted measured values are `[1407, 14951, 19466]` → median `14951` is taken from the middle value, unaffected by the outlier. Had the anomaly been a run 2 instead of run 3, the median would have landed differently. For apples-to-apples post-rewire comparison, Phase 18-06 should also exclude any run where `wallMs < 3000` as an anomaly and rely on the middle of the sorted 3.

### https://www.sap.com/  —  **TIMEOUT / N/A**

| Attempt | Heap cap | OS timeout | Outcome |
|---------|----------|-----------|---------|
| 1       | 6144 MB  | 10 min    | OOM on warm-up run — `FATAL ERROR: Reached heap limit Allocation failed` inside pa11y/headless-browser |
| 2       | 10240 MB | 10 min    | Process terminated by OS `timeout 600` — pa11y still running past 10 minutes |

**Interpretation:** sap.com's page weight + pa11y's synchronous Puppeteer evaluation exhausts the dev machine's memory and event loop at `maxPages=10`. This is a **legitimate limit of the current (pre-rewire) scanner on this hardware**, not a flaw in the bench methodology. The previous executor agent hit the same wall during the first 18-01 attempt (documented in commit `fc09e61` motivation and in the bench script's design notes around BENCH_SITES + settled flag).

**Why this is acceptable**: The 15% latency gate in Plan 18-06 compares **per-site** medians and the **grand median**. sap.com cannot participate in either direction — it would be excluded from the post-rewire run too, because Phase 18's rewire does NOT touch pa11y or headless-browser memory behavior. The apples-to-apples comparison uses the 3 sites that DO complete on both sides.

**If Phase 18-06 needs sap.com**: the post-rewire bench should run with `maxPages=5` on sap.com specifically, or the lxc-luqen production host (more RAM) should be used instead of the dev container. Both options are documented here for the 18-06 executor to consider.

---

## Grand median

Computed over per-site medians of sites that completed all measured runs successfully:

```
sorted([11835, 14951, 19207])  →  [11835, 14951, 19207]
median                          →  14951 ms
```

**`grandMedianMs = 14951`**

---

## Gate thresholds for Plan 18-06

Per the ROADMAP Success Criterion 5 and Plan 18-06 methodology:

- **PASS**: Post-rewire grand median ≤ `14951 × 1.15` = **`17194 ms`** AND each per-site post-rewire median ≤ pre-rewire × 1.25:
  - aperol.com ≤ `19207 × 1.25` = **`24009 ms`**
  - inps.it ≤ `11835 × 1.25` = **`14794 ms`**
  - sky.it ≤ `14951 × 1.25` = **`18689 ms`**
- **FAIL**: Any of the above exceeded — phase verification blocks, executor surfaces failure to orchestrator for replan. Gate failure must not be suppressed.
- **sap.com**: excluded from both sides if it TIMEOUTs again (likely). If 18-06 successfully benches sap.com (e.g., on lxc-luqen), document it as an additional data point but do NOT retroactively add it to the pre-rewire baseline — the comparison must be apples-to-apples.

---

## Raw JSON output (per-site runs)

For reference / automated parsing. Each run's machine-parseable JSON line is below.

```
{"kind":"scanner-latency-bench","site":"https://www.aperol.com/","gitSha":"df8a7e4e944009293be8e3971cd8eadb2d575909","date":"2026-04-11T16:20:40.857Z","runs":[{"runIndex":0,"measured":false,"wallMs":27398,"terminalEvent":"complete"},{"runIndex":1,"measured":true,"wallMs":17922,"terminalEvent":"complete"},{"runIndex":2,"measured":true,"wallMs":19207,"terminalEvent":"complete"},{"runIndex":3,"measured":true,"wallMs":19529,"terminalEvent":"complete"}],"perSiteMedianMs":19207}
{"kind":"scanner-latency-bench","site":"https://www.inps.it/","gitSha":"df8a7e4e944009293be8e3971cd8eadb2d575909","date":"2026-04-11T16:22:18.419Z","runs":[{"runIndex":0,"measured":false,"wallMs":15918,"terminalEvent":"complete"},{"runIndex":1,"measured":true,"wallMs":14766,"terminalEvent":"complete"},{"runIndex":2,"measured":true,"wallMs":11835,"terminalEvent":"complete"},{"runIndex":3,"measured":true,"wallMs":11774,"terminalEvent":"complete"}],"perSiteMedianMs":11835}
{"kind":"scanner-latency-bench","site":"https://www.sky.it/","gitSha":"df8a7e4e944009293be8e3971cd8eadb2d575909","date":"2026-04-11T16:23:17.725Z","runs":[{"runIndex":0,"measured":false,"wallMs":27677,"terminalEvent":"complete"},{"runIndex":1,"measured":true,"wallMs":19466,"terminalEvent":"complete"},{"runIndex":2,"measured":true,"wallMs":14951,"terminalEvent":"complete"},{"runIndex":3,"measured":true,"wallMs":1407,"terminalEvent":"complete","note":"anomaly — suspected rate-limit short-circuit"}],"perSiteMedianMs":14951}
{"kind":"scanner-latency-bench","site":"https://www.sap.com/","gitSha":"df8a7e4e944009293be8e3971cd8eadb2d575909","date":"2026-04-11T16:28:00Z","runs":[],"perSiteMedianMs":null,"error":"OOM on warm-up at 6144 MB heap; OS timeout at 10240 MB heap + 600s cap","terminalEvent":"timeout"}
```

---

## Total bench wall time

- aperol.com: ~90 seconds (4 runs)
- inps.it: ~55 seconds (4 runs)
- sky.it: ~65 seconds (4 runs)
- sap.com: ~600 seconds (OS-killed) + ~500 seconds (OOM) = ~18 minutes of wasted attempts
- **Total elapsed**: ~22 minutes end-to-end

---

*Captured by orchestrator agent inline (not via gsd-executor subagent) because the first 18-01 executor attempt hit rate-limit before Task 2 (bench run) could complete. Bench script commits `fc09e61` and `df8a7e4` contain the executor's prior work (initial script + hardening with BENCH_SITES override and settled timeout flag).*
