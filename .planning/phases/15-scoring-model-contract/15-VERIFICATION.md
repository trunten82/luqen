---
phase: 15-scoring-model-contract
verified: 2026-04-10T22:30:00Z
status: passed
score: 26/26 must-haves verified
overrides_applied: 0
requirements_verified:
  - BSCORE-01
  - BSCORE-02
  - BSCORE-03
  - BSCORE-04
  - BSCORE-05
test_run:
  command: "npx vitest run scoring"
  test_files: 6
  tests_total: 84
  tests_passed: 84
  tests_failed: 0
typecheck:
  command: "npm run lint (tsc --noEmit)"
  exit_code: 0
---

# Phase 15: Scoring Model & Contract — Verification Report

**Phase Goal:** Dashboard has a single pure brand score calculator that produces
identical output across embedded and remote modes, with an unambiguous
"unscorable" distinction from "scored zero".

**Verified:** 2026-04-10
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### ROADMAP Success Criteria (primary contract)

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | `calculateBrandScore(brandedIssues, guideline)` returns tagged-union `{kind:'scored',...} \| {kind:'unscorable',reason}` — no `null → 0` coercion | PASSED | `src/services/scoring/types.ts:76-85` (ScoreResult discriminated union); `src/services/scoring/brand-score-calculator.ts:86-125` (public entry point); grep `??  0 \| \|\| 0` across `src/services/scoring/` → **0 matches**; grep `number \| null \| null \| number` in executable code → **0 matches** (two hits in `types.ts` lines 5 and 10 are inside JSDoc block comments documenting the rule). Tests: `brand-score-calculator.test.ts` D-06 invariants block. |
| 2 | Color sub-score aggregates 1_4_3 / 1_4_6 / 1_4_11 matched issues via single `wcagContrastPasses(ratio, level, isLargeText)` — no literal `4.5/3/7` thresholds in other scoring files | PASSED | `src/services/scoring/wcag-math.ts:104-115` is the sole threshold predicate; `src/services/scoring/color-score.ts:14,51` imports + uses it; no other scoring file contains threshold literals (verified by the fs-based D-07 guard test in `wcag-math.test.ts:167-230` walking the real directory — 6 files enumerated, not vacuous). Dashboard-wide grep for `ratio (>=\|>\|<=\|<) (4.5\|7\|3)` → only `wcag-math.ts:111,114`. |
| 3 | Typography sub-score reflects brand-font availability + ≥16px body text + ≥1.5 line-height derived from declared CSS values | PASSED | `src/services/scoring/typography-score.ts:83-119` implements D-02 equal-weight boolean mean over the three heuristics; regex-based extraction of `font-family / font-size / line-height` from `issue.context`; `typography-score.test.ts` tests each heuristic independently (fontOk substring/case, sizeOk 16px/14px/13.5pt, lineHeightOk 1.5/1.49 boundary). |
| 4 | Component sub-score returns `unscorable` (not `0`) when guideline has no component tokens; otherwise pure set-diff | PASSED | `src/services/scoring/token-score.ts:42-44` returns `{kind:'unscorable', reason:'no-component-tokens'}` when `brandTokens.size === 0`; `token-score.ts:55-69` computes pure set intersection `matched / total`; `token-score.test.ts` includes dedicated "returns unscorable when guideline has zero colors" case and malformed-hex-filtering test. |
| 5 | Composite uses locked weights `{color:0.50, typography:0.30, components:0.20}` from single `weights.ts`, not per-org overridable | PASSED | `src/services/scoring/weights.ts:12-18` exports `Object.freeze`d `Readonly<Record<WeightKey, number>>`; `brand-score-calculator.ts:38,79-81` imports and uses `WEIGHTS.color / .typography / .components`; `weights.test.ts` asserts exact values, sum == 1.0, `Object.isFrozen === true`, and proves runtime mutation throws in strict mode. |

**Score: 5/5 Success Criteria verified**

### Plan must-haves (merged across 15-01 .. 15-04)

#### Plan 15-01 — Types + Weights (7 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | types.ts exports `ScoreResult` tagged union matching D-12 | VERIFIED | `types.ts:76-85` |
| 2 | types.ts exports `SubScore` tagged union matching D-13 | VERIFIED | `types.ts:57-59` |
| 3 | types.ts exports `CoverageProfile` matching D-14 (4 fields, non-nullable) | VERIFIED | `types.ts:65-70` |
| 4 | types.ts exports `UnscorableReason` union with exactly 6 values (D-15) | VERIFIED | `types.ts:17-23` — all 6 literals present |
| 5 | weights.ts exports immutable `WEIGHTS = {color:0.50, typography:0.30, components:0.20}` | VERIFIED | `weights.ts:14-18` — `Object.freeze` + `Readonly<Record>` |
| 6 | No exported type contains `number \| null` (D-16 enforcement) | VERIFIED | grep of executable code → 0 matches; two JSDoc-only mentions in `types.ts:5,10` explicitly forbidding the pattern |
| 7 | weights.test.ts proves weights sum to 1.0 and are frozen | VERIFIED | 7 tests in `weights.test.ts` — all pass |

#### Plan 15-02 — WCAG Math (5 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `wcagContrastPasses(ratio, level, isLargeText)` is single source of truth | VERIFIED | `wcag-math.ts:104-115`; `color-score.ts:14,51` only importer of thresholds in scoring/ |
| 2 | No literal 4.5, 3, 7, 7.0 anywhere in scoring/ except wcag-math.ts (D-07) | VERIFIED | fs-based guard in `wcag-math.test.ts:167-230` walks real directory at runtime; 6 source files enumerated (not vacuous); test passes |
| 3 | Boundary tests at 4.49/4.50/4.51/6.99/7.00/7.01/2.99/3.00/3.01 (off-by-none) | VERIFIED | `wcag-math.test.ts:65-115` — 11 boundary assertions across AA normal, AAA normal, AA large, AAA large |
| 4 | `LARGE_TEXT_PT_THRESHOLD = 18` and `LARGE_TEXT_BOLD_PT_THRESHOLD = 14` exported constants | VERIFIED | `wcag-math.ts:28,31`; `wcag-math.test.ts:124-127` asserts exact values |
| 5 | `classifyLargeText(fontSizePt, isBold)` returns boolean per SC 1.4.3 | VERIFIED | `wcag-math.ts:33-38`; `wcag-math.test.ts:123-150` covers 18/17.99/14/13.99/NaN cases |

#### Plan 15-03 — Sub-score calculators (10 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `calculateColorSubScore` returns scored with `value = 100 × passes/(passes+fails)` (D-01) | VERIFIED | `color-score.ts:83`; `color-score.test.ts` 100/0/50 cases |
| 2 | `calculateColorSubScore` returns `unscorable:no-branded-issues` when no matched contrast issues | VERIFIED | `color-score.ts:62-64`; `color-score.test.ts:42-54` |
| 3 | Every WCAG threshold comparison routes through `wcagContrastPasses` (D-07) | VERIFIED | `color-score.ts:51` only call site; no literal thresholds in file |
| 4 | `calculateTypographySubScore` returns `value = 100 × (fontOk+sizeOk+lineHeightOk)/3` (D-02) | VERIFIED | `typography-score.ts:106-107`; test cases for 100/67/33 |
| 5 | `calculateTypographySubScore` returns `unscorable:no-typography-data` when no CSS data (D-08) | VERIFIED | `typography-score.ts:89-91`; `typography-score.test.ts:32-43` |
| 6 | `calculateTokenSubScore` returns `value = 100 × \|brand∩used\|/\|brand\|` (D-03, D-09, D-10) | VERIFIED | `token-score.ts:55-69`; scored 100/50/0 test cases |
| 7 | `calculateTokenSubScore` returns `unscorable:no-component-tokens` when `guideline.colors.length === 0` | VERIFIED | `token-score.ts:42-44`; `token-score.test.ts:38-41` |
| 8 | token-score.ts contains the D-09/D-10 scoping source comment | VERIFIED | `token-score.ts:9` ("v2.11.0 component sub-score is brand color coverage only"); guardrail test in `token-score.test.ts:133-142` asserts the literal string |
| 9 | Typography regex uses bounded quantifiers; 10KB input < 100ms (ReDoS safety) | VERIFIED | `typography-score.ts:20-24` uses `{1,64}` / `{1,4}` bounded quantifiers; `typography-score.test.ts:151-161` runs 10,000-repetition pathological input under 100ms |
| 10 | Zero scanner changes (D-11) — no imports from packages/scanner | VERIFIED | grep `@luqen/scanner\|packages/scanner` in scoring/ → 0 matches |

#### Plan 15-04 — Composite calculator (7 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `calculateBrandScore(issues, guideline \| null)` returns ScoreResult per D-12 | VERIFIED | `brand-score-calculator.ts:86-125` |
| 2 | All 6 UnscorableReason values tested with dedicated cases (D-19) | VERIFIED | `brand-score-calculator.test.ts:55-120` — 6 dedicated test blocks covering no-guideline, empty-guideline, all-subs-unscorable, no-branded-issues (inside .color), no-typography-data (inside .typography), no-component-tokens (inside .components) |
| 3 | Composite denominator = Σ weights of SCORED subs; all 4 paths tested (D-20) | VERIFIED | `brand-score-calculator.test.ts:124-250` — "3 scored", "2 scored + 1 unscorable" (×2, including unequal-values proof of renormalization), "1 scored + 2 unscorable", "0 scored" |
| 4 | `coverage.contributingWeight` reflects actual denominator used | VERIFIED | `brand-score-calculator.ts:62-63,83`; tests assert 1.0 / 0.70 / 0.50 values explicitly |
| 5 | All 6 UnscorableReason values have at least one dedicated test case (D-19) | VERIFIED | Same as #2 above — all 6 reached |
| 6 | No `.overall ?? 0` or `\|\| 0` coercion in calculator (D-06) | VERIFIED | grep across scoring/ → 0 matches |
| 7 | Composite unscorable ONLY when all 3 sub-scores unscorable | VERIFIED | `brand-score-calculator.ts:104-112`; test "0 scored (all three unscorable)" asserts `{kind:'unscorable', reason:'all-subs-unscorable'}` |

**Merged must-haves score: 29/29 VERIFIED (7 + 5 + 10 + 7)**

---

## Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `packages/dashboard/src/services/scoring/types.ts` | yes (86 lines) | yes — all 4 type exports present | yes — imported by all other scoring modules + tests | VERIFIED |
| `packages/dashboard/src/services/scoring/weights.ts` | yes (19 lines) | yes — frozen WEIGHTS + WeightKey | yes — imported by `brand-score-calculator.ts` | VERIFIED |
| `packages/dashboard/src/services/scoring/wcag-math.ts` | yes (116 lines) | yes — 5 exports (luminance, ratio, predicate, classify, constants) | yes — imported by `color-score.ts` | VERIFIED |
| `packages/dashboard/src/services/scoring/color-score.ts` | yes (90 lines) | yes — calculateColorSubScore + helpers | yes — imported by `brand-score-calculator.ts` | VERIFIED |
| `packages/dashboard/src/services/scoring/typography-score.ts` | yes (120 lines) | yes — calculateTypographySubScore + bounded regex | yes — imported by `brand-score-calculator.ts` | VERIFIED |
| `packages/dashboard/src/services/scoring/token-score.ts` | yes (71 lines) | yes — calculateTokenSubScore + guardrail-comment | yes — imported by `brand-score-calculator.ts` | VERIFIED |
| `packages/dashboard/src/services/scoring/brand-score-calculator.ts` | yes (126 lines) | yes — public calculateBrandScore entry point | yes (pure module — zero runtime imports into scanner/orchestrator yet; wiring arrives in Phase 17 per plan boundaries) | VERIFIED |
| `packages/dashboard/tests/services/scoring/weights.test.ts` | yes | yes (7 tests) | N/A test file | VERIFIED |
| `packages/dashboard/tests/services/scoring/wcag-math.test.ts` | yes | yes (22 tests incl. D-07 fs guard) | N/A test file | VERIFIED |
| `packages/dashboard/tests/services/scoring/color-score.test.ts` | yes | yes (9 tests) | N/A test file | VERIFIED |
| `packages/dashboard/tests/services/scoring/typography-score.test.ts` | yes | yes (13 tests incl. ReDoS guard) | N/A test file | VERIFIED |
| `packages/dashboard/tests/services/scoring/token-score.test.ts` | yes | yes (9 tests incl. source-comment guardrail) | N/A test file | VERIFIED |
| `packages/dashboard/tests/services/scoring/brand-score-calculator.test.ts` | yes | yes (24 tests: 6 reasons + 5 composite paths + D-06 invariants) | N/A test file | VERIFIED |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| weights.ts | types.ts | `WeightKey` discriminant | WIRED — same type referenced by `brand-score-calculator.ts:38` |
| wcag-math.ts | @luqen/branding | `normalizeHex` import | WIRED — `wcag-math.ts:21` |
| color-score.ts | wcag-math.ts | `wcagContrastPasses, contrastRatio` imports | WIRED — `color-score.ts:14`; call site line 49-51 |
| color-score.ts | @luqen/branding | `extractColorsFromContext` | WIRED — `color-score.ts:12`; call at line 47 |
| token-score.ts | @luqen/branding | `normalizeHex, extractColorsFromContext` | WIRED — `token-score.ts:26`; calls at lines 36, 49 |
| typography-score.ts | BrandedIssue.context CSS parsing | bounded regex | WIRED — `typography-score.ts:20-24,75` |
| brand-score-calculator.ts | weights.ts | `WEIGHTS` | WIRED — `brand-score-calculator.ts:38`; usage at 62, 79-81 |
| brand-score-calculator.ts | color-score.ts | `calculateColorSubScore` | WIRED — `brand-score-calculator.ts:39,100` |
| brand-score-calculator.ts | typography-score.ts | `calculateTypographySubScore` | WIRED — `brand-score-calculator.ts:40,101` |
| brand-score-calculator.ts | token-score.ts | `calculateTokenSubScore` | WIRED — `brand-score-calculator.ts:41,102` |

All key links verified. No orphan or stub modules.

---

## Data-Flow Trace (Level 4)

Phase 15 delivers **pure functions** with no persistence, no UI, no external data source beyond their formal parameters. Data flow is synchronous and local:

```
BrandedIssue[] + BrandGuideline (caller-supplied)
  └─> calculateBrandScore
       ├─> calculateColorSubScore  ──> wcagContrastPasses ──> ratio >= threshold
       ├─> calculateTypographySubScore  ──> regex over issue.context
       └─> calculateTokenSubScore  ──> set intersection over normalized hex
  └─> composite (numerator / contributingWeight) ──> ScoreResult
```

No hidden inputs (no I/O, no Date, no Math.random — verified by grep). The
calculator is deterministic by construction, which is what lets Success
Criterion #1's "identical output across embedded and remote modes" hold: a
pure function with identical inputs always produces identical output.
Persistence and orchestration arrive in Phases 16/17 — explicit Phase 15
boundary.

---

## Invariant Checks (D-06 / D-07 / D-11 / D-16 / D-19 / D-20)

| Invariant | Decision | Check | Result |
|-----------|----------|-------|--------|
| No `?? 0` or `\|\| 0` coercion in scoring sources | D-06 | grep `(\?\?\s*0\|\|\|\s*0)` in `src/services/scoring/` | **0 matches** |
| No literal WCAG threshold numerics outside wcag-math.ts | D-07 | fs-based guard test `wcag-math.test.ts:167-230` walks scoring/ directory; comparison-context regex `[<>]=?\s*(3\|4\.5\|7)` | **0 violations**; guard is non-vacuous (6 files enumerated) |
| No `number \| null` or `null \| number` in type surface | D-16 | grep in executable code | **0 matches** (the two JSDoc hits in `types.ts:5,10` are comment lines explicitly forbidding the pattern) |
| Zero scanner imports from scoring | D-11 | grep `@luqen/scanner\|packages/scanner` in scoring/ | **0 matches** |
| All 6 UnscorableReason values have dedicated test cases | D-19 | grep in `brand-score-calculator.test.ts` for the 6 literal reasons | **all 6 present** |
| All 4 composite renormalization paths tested | D-20 | `brand-score-calculator.test.ts:124-250` | **3 scored / 2+1 (×2) / 1+2 / 0 scored — all 4 present** |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| BSCORE-01 | 0-100 color contrast sub-score derived from WCAG 1.4.3/1.4.6/1.4.11 matched to brand colors | SATISFIED | `color-score.ts` CONTRAST_CODES set covers the three SCs; `calculateColorSubScore` returns `{kind:'scored', value}`; tests prove 100/0/50/AAA-differentiation cases |
| BSCORE-02 | 0-100 typography sub-score based on brand font + ≥16px body + line-height ≥1.5 | SATISFIED | `typography-score.ts` D-02 three-heuristic mean; `typography-score.test.ts` covers all three heuristics and boundary cases |
| BSCORE-03 | 0-100 component sub-score set-diff, N/A when guideline has no component selectors | SATISFIED | `token-score.ts` returns `{kind:'unscorable', reason:'no-component-tokens'}` when `guideline.colors.length === 0` (v2.11.0 scope = brand colors per D-09/D-10, documented in source comment) |
| BSCORE-04 | Composite via locked `{color:0.50, typography:0.30, components:0.20}` weights — not per-org customizable | SATISFIED | `weights.ts` frozen constant + `weights.test.ts` proves values, sum, and immutability; `brand-score-calculator.ts` is the only consumer |
| BSCORE-05 | Tagged-union score type — never `null → 0` coercion | SATISFIED | `types.ts` ScoreResult/SubScore discriminated unions; D-06 invariant check above; `brand-score-calculator.test.ts` "D-06 no null->0 coercion invariants" block |

**No orphaned requirements** — REQUIREMENTS.md maps exactly BSCORE-01..05 to Phase 15, all five are claimed by at least one plan (15-01..15-04), and all five are satisfied by implementation evidence.

---

## Anti-Patterns Scan

| File | Finding | Severity | Disposition |
|------|---------|----------|-------------|
| All scoring source files | No `TODO / FIXME / XXX / HACK / PLACEHOLDER` matches | — | clean |
| All scoring source files | No `return null / return {} / return []` stub returns; all `return []` variants are legitimate empty arrays inside typed structures | — | clean |
| All scoring source files | No `console.log` | — | clean |
| `src/fix-suggestions.ts:91` (outside scoring/) | Literal `4.5:1` appears in a user-facing description string | info | **Not a violation of SC2/D-07** — this is explanatory prose telling users what WCAG requires, not a scoring threshold comparison. It predates Phase 15 and the D-07 guard explicitly skips comment/string content. |
| `src/routes/wcag-enrichment.ts:37` | Literal `4.5:1 / 3:1` in a WCAG info object | info | Same — descriptive text, not a threshold comparison |
| `src/static/style.css:4` | Comment noting contrast ratios | info | CSS comment |
| `src/manual-criteria.ts:142, 369` | Literal `3:1 ratio` in manual-check guidance text | info | Same — guidance text, not comparison logic |

All four info-level findings are **descriptive strings** (human-readable WCAG requirement text) not **threshold comparisons** (the actual pass/fail decision routing through `wcagContrastPasses`). The locked invariant (D-07) and Success Criterion #2 target the latter — "no literal thresholds in comparisons elsewhere" — which is held: the only comparison-context literals `ratio >= 4.5 / 7 / 3` exist in `wcag-math.ts:111,114`.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Scoring test suite runs green | `npx vitest run scoring` | `Test Files 6 passed, Tests 84 passed, duration 818ms` | PASS |
| Dashboard type-checks clean | `npm run lint` (= `tsc --noEmit`) | exit 0, no output | PASS |
| Determinism of calculator | grep `fetch\|http\|axios\|fs\.\|Date\.\|Math.random` in `src/services/scoring/` | 0 matches — pure functions only | PASS |
| D-07 fs guard is non-vacuous | Count source files walked by `wcag-math.test.ts:167` guard | 6 files (types / weights / color / typography / token / calculator) — not vacuous | PASS |
| WCAG threshold single-source | grep `ratio (>=\|<=\|>\|<) (4.5\|7\|3)` in `packages/dashboard/src` | only `wcag-math.ts:111,114` | PASS |

---

## Human Verification Required

None. Phase 15 is a pure-calculator / type-contract phase with zero UI, zero
persistence, zero external integration. All contracts are provable by
compilation and unit tests — no cross-persona flows, no visual rendering, no
real-time behavior, no external services to exercise. The next phase that
will require UAT is Phase 20/21 (report panel + dashboard widget), which
consumes the types and values locked here.

---

## Gaps Summary

No gaps. All 5 ROADMAP Success Criteria and all 29 plan-frontmatter must-haves
verified against the codebase. All 84 scoring unit tests pass; tsc --noEmit
exits clean. The D-07 enforcement guard is non-vacuous (walks 6 real source
files) and passes. All 5 requirement IDs (BSCORE-01..05) have satisfying
implementation evidence.

Phase 15 goal achieved: the dashboard now has a single pure brand score
calculator, deterministic by construction (therefore identical across embedded
and remote modes), with an unambiguous `{kind:'scored'} | {kind:'unscorable'}`
distinction that makes "no data" impossible to confuse with "all data failed".

Ready to proceed to Phase 16 (brand_scores persistence).

---

*Verified: 2026-04-10T22:30:00Z*
*Verifier: Claude (gsd-verifier)*
