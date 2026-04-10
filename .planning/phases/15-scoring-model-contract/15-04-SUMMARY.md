---
phase: 15-scoring-model-contract
plan: 04
subsystem: scoring
tags: [typescript, scoring, brand-score, composite, renormalization, tagged-union, tdd, vitest, d-04, d-06, d-15, d-19, d-20, pitfall-1]

# Dependency graph
requires:
  - phase: 15-scoring-model-contract
    plan: 01
    provides: ScoreResult / SubScore / CoverageProfile / UnscorableReason type contract + WEIGHTS locked constant
  - phase: 15-scoring-model-contract
    plan: 02
    provides: wcagContrastPasses single-source predicate + D-07 fs-based guard that re-runs over this plan's new source file
  - phase: 15-scoring-model-contract
    plan: 03
    provides: calculateColorSubScore / calculateTypographySubScore / calculateTokenSubScore pure functions composed here
  - package: "@luqen/branding"
    provides: BrandedIssue / BrandGuideline / BrandColor / BrandFont types reused in tests and in the composite signature
provides:
  - calculateBrandScore(issues, guideline | null) — public entry point of the dashboard scoring module
  - Composite renormalization semantics locked (Pitfall #1 pinned by a test)
  - All 6 UnscorableReason values have dedicated test coverage (D-19)
  - All 4 composite renormalization paths have dedicated test coverage (D-20)
affects:
  - Phase 16 — `brand_scores` persistence table imports ScoreResult / SubScore / CoverageProfile shapes locked by 15-01 and exercised end-to-end here
  - Phase 17 — BrandingOrchestrator is the first caller of calculateBrandScore; this plan fixes the public signature it will import
  - Phases 20/21 — UI empty-state rendering depends on the SubScore discriminant, which is now end-to-end verified

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite-over-renormalized-denominator pattern (Pitfall #1) as the canonical way to combine optional weighted sub-metrics"
    - "Top-level vs. nested tagged-union: the composite can itself be 'scored' while one or more of its sub-scores are 'unscorable' — only all-three-unscorable collapses to a top-level 'unscorable'"
    - "Pre-guard against division-by-zero: all-subs-unscorable check runs BEFORE composite math, so contributingWeight > 0 is a static invariant of the composite() helper"

key-files:
  created:
    - packages/dashboard/src/services/scoring/brand-score-calculator.ts
    - packages/dashboard/tests/services/scoring/brand-score-calculator.test.ts
  modified: []

key-decisions:
  - "Composite denominator is Σ weights of SCORED subs (not 1.0) — Pitfall #1 pinned by the unequal-values test that asserts 50, failing any regression that drops renormalization (would give 35)"
  - "Composite is top-level unscorable ONLY when all three sub-scores are unscorable — otherwise it is a scored ScoreResult whose per-dimension SubScore may still be 'unscorable' with its own reason"
  - "CoverageProfile.contributingWeight is rounded to 2 decimals (rawSum * 100 / 100) to eliminate FP drift in downstream equality checks"
  - "No `?? 0` or `|| 0` coercion anywhere in brand-score-calculator.ts (D-06 invariant — scan returns 0)"
  - "Zero-literal-thresholds rule (D-07) still holds — brand-score-calculator.ts contains no 4.5 / 3 / 7, confirmed by the fs-based guard from 15-02 running over this new file"

requirements-completed:
  - BSCORE-01
  - BSCORE-02
  - BSCORE-03
  - BSCORE-04
  - BSCORE-05

# Metrics
duration: ~15min
completed: 2026-04-10
---

# Phase 15 Plan 04: Brand Score Calculator Composite Entry Point Summary

**Delivered the public `calculateBrandScore(issues, guideline)` entry point that composes the three dimension sub-scores into a top-level `ScoreResult`, renormalizes the composite over only the sub-scores that returned `{kind:'scored'}`, and handles every unscorable path via the tagged-union contract — with every one of the 6 `UnscorableReason` values and every one of the 4 composite renormalization paths pinned by a dedicated test.**

## Public API (final)

```typescript
import type { BrandedIssue, BrandGuideline } from '@luqen/branding';
import type { ScoreResult } from './types.js';

export function calculateBrandScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline | null,
): ScoreResult;
```

This is the **last calculator file in Phase 15**. After this plan the brand score contract is complete and ready for Phase 16 to persist it.

## Composite Math (D-04, Pitfall #1)

Let `S ⊆ {color, typography, components}` be the set of sub-scores that returned `{kind:'scored'}`.

- If `S` is empty → `ScoreResult = {kind:'unscorable', reason:'all-subs-unscorable'}`
- Else:
  - `contributingWeight = Σ_{k ∈ S} WEIGHTS[k]`
  - `overall = Math.round( (Σ_{k ∈ S} WEIGHTS[k] * subs[k].value) / contributingWeight )`

**Worked Pitfall #1 example** (now pinned by a test):
- Color: 50 (scored) — weight 0.50
- Typography: unscorable — weight drops out
- Components: 50 (scored) — weight 0.20
- Naive `/1.0` result: `(50*0.50 + 50*0.20) / 1.0 = 35` ← WRONG
- Correct `/0.70` result: `(50*0.50 + 50*0.20) / 0.70 = 50` ← RIGHT
- Any regression that drops the renormalization step fails this test.

## D-19 Coverage: All 6 UnscorableReason Values

| `UnscorableReason` value | Level | Test case (describe > it) |
|---|---|---|
| `'no-guideline'` | top-level | `calculateBrandScore — UnscorableReason coverage (D-19) > returns unscorable no-guideline when guideline is null` |
| `'empty-guideline'` | top-level | `calculateBrandScore — UnscorableReason coverage (D-19) > returns unscorable empty-guideline when guideline has no colors/fonts/selectors` |
| `'all-subs-unscorable'` | top-level | `calculateBrandScore — UnscorableReason coverage (D-19) > returns unscorable all-subs-unscorable when all three sub-scores are unscorable` (also cross-verified in the D-20 0-scored path test) |
| `'no-branded-issues'` | nested (inside `.color`) | `calculateBrandScore — UnscorableReason coverage (D-19) > surfaces no-branded-issues inside .color when color sub-score is unscorable but others are scored` |
| `'no-typography-data'` | nested (inside `.typography`) | `calculateBrandScore — UnscorableReason coverage (D-19) > surfaces no-typography-data inside .typography when typography sub-score is unscorable but others are scored` |
| `'no-component-tokens'` | nested (inside `.components`) | `calculateBrandScore — UnscorableReason coverage (D-19) > surfaces no-component-tokens inside .components when guideline has no colors but other data is present` |

Every value reachable by at least one dedicated case — no catch-all "unscorable" assertion.

## D-20 Coverage: All 4 Composite Renormalization Paths

| Scored subs | `contributingWeight` | Test case |
|---|---|---|
| 3 (color + typography + components) | `1.0` | `3 scored subs: denominator = 1.0, overall is weighted mean` |
| 2 (color + components, typography unscorable) — equal values | `0.70` | `2 scored + 1 unscorable: denominator renormalizes to partial sum (Pitfall #1 worked example)` |
| 2 (color + components, typography unscorable) — **unequal values** | `0.70` | `2 scored + 1 unscorable with unequal values proves renormalization (not naive average)` — **this is the Pitfall #1 proof (50 not 35)** |
| 1 (color only, typography + components unscorable) | `0.50` | `1 scored + 2 unscorable: denominator = single weight, overall = that sub value` |
| 0 (all three unscorable) | n/a — top-level unscorable | `0 scored (all three unscorable): returns top-level all-subs-unscorable` |

All four paths have explicit `contributingWeight` assertions. The unequal-values case is the regression trap: if the denominator is ever reverted to `1.0`, that test fails instantly with `expected 50 to be 35`.

## D-06 Invariants (no null → 0 coercion)

Two dedicated tests pin the invariant:

1. **`never returns overall = 0 when any sub-score is unscorable`** — a scenario where color fails (legitimate 0 via one data point, all failed) while typography + components are unscorable. Asserts that `overall === 0` is a real scored value, not a coerced null — the test checks `.color.kind === 'scored'` alongside `.typography.kind === 'unscorable'` and `.components.kind === 'unscorable'`.
2. **`top-level unscorable result never exposes an overall number`** — uses `// @ts-expect-error` to prove the TypeScript narrowing is sound: the `unscorable` variant has no `overall` field, so the discriminated union prevents any accidental `.overall ?? 0` pattern at the call site.

Source-file scan: `grep -rnE "\?\? 0|\|\| 0" packages/dashboard/src/services/scoring/` returns **0 hits**.

## D-07 Guard Compatibility

The fs-based D-07 guard from Plan 15-02 walks `packages/dashboard/src/services/scoring/` and scans every `.ts` file except `wcag-math.ts` for literal threshold numbers (`4.5 / 3 / 7`). After this plan:

- brand-score-calculator.ts joins the scanned set.
- It contains **zero** literal WCAG thresholds.
- The guard still passes (`31 passed` in `wcag-math.test.ts`, including the D-07 violations assertion).

The d07 trap from plan 15-03 was deliberately avoided: no contrast literals appear in brand-score-calculator.ts (composition-only; all contrast math stays inside color-score.ts + wcag-math.ts), and no inline trailing comment with the numbers `4.5 / 3 / 7` sits on the same line as code.

## Test Counts

| Module | Test file | Tests |
|---|---|---|
| WCAG math + D-07 guard | `wcag-math.test.ts` | 31 |
| Weights | `weights.test.ts` | (unchanged from 15-01) |
| Color sub-score | `color-score.test.ts` | (unchanged from 15-03) |
| Typography sub-score | `typography-score.test.ts` | (unchanged from 15-03) |
| Token sub-score | `token-score.test.ts` | (unchanged from 15-03) |
| **Brand score composite (this plan)** | **`brand-score-calculator.test.ts`** | **14** |
| **Total scoring suite** | **6 files** | **84 passed** |

`cd packages/dashboard && npx vitest run scoring` → `Test Files 6 passed (6) | Tests 84 passed (84)`.

`cd packages/dashboard && npm run lint` (tsc --noEmit) → exit 0.

## Phase 15 ROADMAP Success Criteria (all satisfied)

1. **`calculateBrandScore(issues, guideline)` returns tagged-union ScoreResult (BSCORE-05)** — locked by this plan's public entry point and its 14 tests.
2. **Color contrast sub-score routes through `wcagContrastPasses` (BSCORE-01)** — locked in 15-02 (wcag-math.ts) and 15-03 (color-score.ts); D-07 guard re-confirms after this plan.
3. **Typography sub-score reflects brand font + ≥16px + ≥1.5 line-height (BSCORE-02)** — locked in 15-03; end-to-end verified here via the 3-scored composite test.
4. **Components sub-score returns unscorable when `guideline.colors` empty (BSCORE-03)** — locked in 15-03; end-to-end verified here via the `no-component-tokens` surfacing test and the `all-subs-unscorable` top-level test.
5. **Composite uses locked weights from weights.ts (BSCORE-04)** — locked in 15-01; verified here via the WEIGHTS-integration sanity test and the explicit arithmetic assertions in every renormalization path test.

## Deviations from Plan

**None.** Plan executed verbatim: the source code and the test suite match the plan's exact content blocks.

Two tests initially failed on first run because the plan's 3-scored and 2-scored+1-unscorable contexts used `color: #ff0000; background: #ffffff` as the contrast pair — red-on-white measures ~4.0:1, which fails WCAG AA (threshold 4.5:1) and therefore produced color sub-score = 0, making the composite `overall` 50/29 instead of the asserted 100/100. The fix reordered the extracted hex values so the contrast pair is `#000000` on `#ffffff` (21:1, passes AA) with `#ff0000` placed in a later `border-color` declaration so it still enters the component used-tokens set without disturbing the `colors[0]/colors[1]` pair that `issuePasses()` reads. The assertions in the plan (contributingWeight, overall, sub-score values) were left unchanged — only the fixture contexts were adjusted to actually produce the state the plan intended. This is a Rule 1 fix (the plan's fixture contradicted its own assertions); no behavior change in production code.

## Known Stubs

None — this plan wires the composite entry point end-to-end with real sub-score calculators and verified data.

## Self-Check: PASSED

**Files verified present:**
- `/root/luqen/packages/dashboard/src/services/scoring/brand-score-calculator.ts` — FOUND
- `/root/luqen/packages/dashboard/tests/services/scoring/brand-score-calculator.test.ts` — FOUND

**Commits verified present:**
- `fc76e49` `feat(15-04): add brand-score-calculator composite entry point` — FOUND
- `57a3e31` `test(15-04): cover all 6 UnscorableReasons and 4 renormalization paths` — FOUND

**Verification runs:**
- `cd packages/dashboard && npm run lint` → exit 0 (no TS errors)
- `cd packages/dashboard && npx vitest run scoring` → 6 files, 84 tests passed
- `grep -rnE "\?\? 0|\|\| 0" packages/dashboard/src/services/scoring/` → 0 hits (D-06 ✓)
- D-07 guard (re-run via `wcag-math.test.ts`) → passes with brand-score-calculator.ts in scanned set (D-07 ✓)
- All 6 UnscorableReason values covered (D-19 ✓)
- All 4 composite renormalization paths covered (D-20 ✓)
