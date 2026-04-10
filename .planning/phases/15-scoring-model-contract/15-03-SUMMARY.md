---
phase: 15-scoring-model-contract
plan: 03
subsystem: scoring
tags: [typescript, scoring, wcag, contrast, typography, brand-tokens, tdd, vitest, d-07, bounded-regex, set-diff]

# Dependency graph
requires:
  - phase: 15-scoring-model-contract
    plan: 01
    provides: SubScore / SubScoreDetail / UnscorableReason types from scoring/types.ts
  - phase: 15-scoring-model-contract
    plan: 02
    provides: wcagContrastPasses + contrastRatio from scoring/wcag-math.ts (D-07 single source of truth) and fs-based D-07 guard
  - package: "@luqen/branding"
    provides: normalizeHex, extractColorsFromContext, BrandedIssue, BrandGuideline, BrandColor
provides:
  - calculateColorSubScore(issues, guideline) — contrast pass-ratio sub-score (D-01)
  - calculateTypographySubScore(issues, guideline) — equal-weight 3-heuristic boolean mean (D-02)
  - calculateTokenSubScore(issues, guideline) — brand color coverage set-diff (D-03)
affects:
  - Phase 15 Plan 04 (brand-score-calculator composes these three sub-scores into ScoreResult)
  - Phase 16 brand_scores persistence (reads dimension-specific detail shapes from SubScore returns)
  - Phase 17 BrandingOrchestrator (indirect — through Plan 04 calculator)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function per file convention: one public calculator + private helpers, zero I/O, zero mutation outside locals"
    - "Conservative fail on malformed data: NaN contrast ratio or fewer-than-2 extractable hexes counts as a fail, never upgrades a flagged issue"
    - "Bounded regex + MAX_CONTEXT_LEN truncation for ReDoS-safe CSS declaration extraction"
    - "normalizeHex-based filter for guideline hex validation — calculator never throws on bad guideline data"

key-files:
  created:
    - packages/dashboard/src/services/scoring/color-score.ts
    - packages/dashboard/src/services/scoring/typography-score.ts
    - packages/dashboard/src/services/scoring/token-score.ts
    - packages/dashboard/tests/services/scoring/color-score.test.ts
    - packages/dashboard/tests/services/scoring/typography-score.test.ts
    - packages/dashboard/tests/services/scoring/token-score.test.ts
  modified: []

key-decisions:
  - "D-01 color sub-score formula implemented as Math.round(100 * passes / (passes + fails)) over brand-matched contrast issues"
  - "D-02 typography sub-score implemented as equal-weight boolean mean over fontOk + sizeOk + lineHeightOk"
  - "D-03 component sub-score implemented as brand-color set-diff with normalizeHex + extractColorsFromContext reuse"
  - "D-06 enforced: no ?? 0 or || 0 anywhere — absence of data returns unscorable with a reason"
  - "D-07 enforced: zero literal WCAG thresholds in any of the three new files; every comparison routes through wcagContrastPasses"
  - "D-09 token-score reuses @luqen/branding extractColorsFromContext helper (no duplication)"
  - "D-10 token-score scoped to brand colors only in v2.11.0 — mandatory source comment documents exclusion of fonts and selectors"
  - "D-11 zero scanner imports across all three files"

requirements-completed:
  - BSCORE-01
  - BSCORE-02
  - BSCORE-03

# Metrics
duration: ~15min
completed: 2026-04-10
---

# Phase 15 Plan 03: Three Pure Sub-Score Calculators Summary

**Delivered the three dimension calculators — color contrast pass ratio, typography 3-heuristic boolean mean, and brand color coverage set-diff — as independently testable pure functions that each return a SubScore tagged union (never null, never a coerced zero), with every WCAG threshold still routed exclusively through wcag-math.ts.**

## Performance

- **Duration:** ~15 minutes
- **Tasks:** 3/3 completed
- **Files created:** 6 (3 sources + 3 test files)
- **Files modified:** 0

## Accomplishments

- Implemented `calculateColorSubScore` in `color-score.ts` with pass-ratio math (D-01): filters to `brandMatch.matched === true` AND contrast-code issues, extracts hex pairs via `extractColorsFromContext`, classifies each via `wcagContrastPasses(ratio, level, false)`, and returns `Math.round(100 * passes / (passes + fails))`. Returns `unscorable` with reason `no-branded-issues` when the filter yields nothing.
- Implemented `calculateTypographySubScore` in `typography-score.ts` with equal-weight boolean mean (D-02): extracts `font-family`, `font-size`, and `line-height` declarations via **bounded regexes**, aggregates across every issue's context, computes `fontOk` (case-insensitive substring match against `guideline.fonts[].family`), `sizeOk` (any observed px/pt size >= 16px body-text heuristic), and `lineHeightOk` (any observed line-height >= 1.5 ratio heuristic). Returns `unscorable` with reason `no-typography-data` when no declarations extractable.
- Implemented `calculateTokenSubScore` in `token-score.ts` with brand color coverage set-diff (D-03): normalizes every `guideline.colors[].hexValue` via `normalizeHex` (filters malformed), unions `extractColorsFromContext` across all issues to form `usedTokens`, returns `Math.round(100 * matched / total)`. Returns `unscorable` with reason `no-component-tokens` when guideline has zero valid colors.
- Locked the mandatory v2.11.0 scoping comment in `token-score.ts` per CONTEXT specifics — a dedicated unit test reads the source file and asserts both the "brand color coverage only" and "See Phase 15 CONTEXT D-09/D-10" strings remain present, guarding against silent drift.
- Added a ReDoS guard unit test that constructs a 10,000-repeat pathological `font-family: x, ` input and asserts extraction completes in under 100ms — proving the bounded regex + `MAX_CONTEXT_LEN = 10_000` truncation combo is effective against catastrophic backtracking.
- Verified the Plan 15-02 D-07 fs-based guard still finds **zero literal WCAG threshold occurrences** in the expanded scoring/ directory (now 5 `.ts` files under scan: types.ts, weights.ts, color-score.ts, typography-score.ts, token-score.ts).

## Task Commits

Each task was committed atomically:

1. **Task 1: color-score.ts — contrast pass ratio via wcag-math** — `918154d` (feat)
2. **Task 2: typography-score.ts — equal-weight 3-heuristic boolean mean with bounded regex** — `9792316` (feat)
3. **Task 3: token-score.ts — brand color coverage set-diff** — `ab3653e` (feat)

Commit hashes captured from `git log --oneline -6` after completion.

## Files Created

- `packages/dashboard/src/services/scoring/color-score.ts` — 89 lines; imports `wcagContrastPasses`, `contrastRatio` from `./wcag-math.js` and `extractColorsFromContext` from `@luqen/branding`; declares local `CONTRAST_CODES` and `isContrastIssue` helper (D-11 — no @luqen/branding surface change).
- `packages/dashboard/src/services/scoring/typography-score.ts` — 117 lines; three bounded regexes (`FONT_FAMILY_RE`, `FONT_SIZE_RE`, `LINE_HEIGHT_RE`) plus `MAX_CONTEXT_LEN = 10_000` truncation; pt-to-px conversion at `value * (4 / 3)`; em/rem/% sizes deliberately skipped (no parent context in Phase 15).
- `packages/dashboard/src/services/scoring/token-score.ts` — 72 lines; single public function `calculateTokenSubScore`; reuses `normalizeHex` + `extractColorsFromContext` from `@luqen/branding`; mandatory v2.11.0 scoping JSDoc.
- `packages/dashboard/tests/services/scoring/color-score.test.ts` — 9 vitest tests.
- `packages/dashboard/tests/services/scoring/typography-score.test.ts` — 13 vitest tests including the ReDoS guard.
- `packages/dashboard/tests/services/scoring/token-score.test.ts` — 10 vitest tests including the source-comment guard.

## Public Surface Exported (for Plan 15-04 consumption)

```typescript
// color-score.ts
export function calculateColorSubScore(
  issues: readonly BrandedIssue[],
  _guideline: BrandGuideline,
): SubScore;

// typography-score.ts
export function calculateTypographySubScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline,
): SubScore;

// token-score.ts
export function calculateTokenSubScore(
  issues: readonly BrandedIssue[],
  guideline: BrandGuideline,
): SubScore;
```

All three are pure functions, return the `SubScore` tagged union from `./types.js`, never throw, never mutate input, and never return `number | null`.

## Test Counts

| File                         | Tests | Passed | Failed | Notes                                           |
| ---------------------------- | ----: | -----: | -----: | ----------------------------------------------- |
| color-score.test.ts          |     9 |      9 |      0 | pass-ratio, AA/AAA routing, conservative fails  |
| typography-score.test.ts     |    13 |     13 |      0 | 3-heuristic mean + pt->px + ReDoS guard         |
| token-score.test.ts          |    10 |     10 |      0 | set-diff + normalizeHex filter + comment guard  |
| **Plan 15-03 subtotal**      |  **32** |  **32** |  **0** |                                                 |
| wcag-math.test.ts (Plan 02)  |    31 |     31 |      0 | D-07 guard re-verified over expanded scoring/   |
| weights.test.ts   (Plan 01)  |     7 |      7 |      0 |                                                 |
| **scoring/ total**           |  **70** |  **70** |  **0** | `vitest run scoring` — 5 test files, 70 tests   |

Full vitest output: `Test Files  5 passed (5)`, `Tests  70 passed (70)`, duration ~575ms.

## Edge Cases Confirmed During TDD

- **1_4_11 conservative choice (confirmed).** The CONTRAST_CODES set includes `Guideline1_4.1_4_11` (non-text contrast, spec threshold 3:1), but Phase 15 deliberately classifies every 1_4_11 issue at `isLargeText=false` — meaning a ratio in the 3-4.5 window will count as a *fail* even though it satisfies the non-text spec. The final color-score test documents this choice; it under-credits some genuine passes in exchange for not inferring text classification from `issue.context`. A future milestone can revisit by passing text-kind metadata into `calculateColorSubScore`.
- **Unextractable hex pairs are conservative fails.** If `extractColorsFromContext(issue.context)` returns fewer than 2 distinct hex codes, `issuePasses` returns `false`. Rationale: the scanner already flagged the issue — a calculator that cannot verify the hex pair must not upgrade a flagged issue to a pass. Tested explicitly.
- **NaN ratio guard.** `contrastRatio` returns `NaN` on malformed hex; `issuePasses` checks `Number.isFinite(ratio)` before calling `wcagContrastPasses`, treating non-finite as a conservative fail (not a pass, not an unscorable — the issue is still counted in the denominator as a fail).
- **Typography: em/rem/% intentionally skipped.** These sizes imply a parent context that Phase 15 cannot resolve (no DOM, no cascade). The test `em/rem/% sizes are skipped (no parent context)` asserts that an issue containing only em/rem/% yields `{kind:'unscorable', reason:'no-typography-data'}` — matching D-06.
- **Typography aggregation is "any pass -> heuristic passes".** Multiple issues contribute to the same three booleans; if *any* issue declares a brand font (or a size ≥16px, or line-height ≥1.5), the heuristic passes. This matches D-02's "pass all 3" mental model applied across the aggregated view.
- **Token score: matched set uses normalized tokens.** Both `brandTokens` (via explicit `normalizeHex`) and `usedTokens` (via `extractColorsFromContext`, which calls `normalizeHex` internally) use the same 6-digit uppercase format, so set membership is exact. The 3-digit hex test (`#f00` -> `#FF0000`) proves this.
- **Token score: rgb() in context matches hex in guideline.** `extractColorsFromContext` converts `rgb(255,0,0)` to `#FF0000`, so a guideline with `#ff0000` matches issues containing `rgb(255, 0, 0)`. Tested explicitly.
- **Empty issues + non-empty guideline = scored 0 (not unscorable).** With no extracted used tokens but a valid brand palette, the sub-score is a legitimate zero (D-06: zero is a valid score when there is at least one data point — the brand tokens themselves — and none of them were found).

## D-07 Guard Status

The Plan 15-02 fs-based guard now scans **5 files** under `packages/dashboard/src/services/scoring/` (excluding `wcag-math.ts`):

1. `types.ts`      (Plan 15-01)
2. `weights.ts`    (Plan 15-01)
3. `color-score.ts`       (Plan 15-03 — this plan)
4. `typography-score.ts`  (Plan 15-03 — this plan)
5. `token-score.ts`       (Plan 15-03 — this plan)

Result: **0 violations** across all 5 files. Every WCAG threshold comparison in the scoring subsystem is routed through `wcagContrastPasses`.

Source-level evidence:
- `grep -c "wcagContrastPasses" packages/dashboard/src/services/scoring/color-score.ts` → 2 (import + call site)
- `grep -c "from './wcag-math.js'" packages/dashboard/src/services/scoring/color-score.ts` → 1
- Neither `typography-score.ts` nor `token-score.ts` imports from `wcag-math.ts` — they have no need to compare against WCAG thresholds (typography uses body/line-height heuristics, tokens use set membership).

## Verification

- `cd packages/dashboard && npm run lint` (`tsc --noEmit`) — exit 0, zero TS errors
- `cd packages/dashboard && npx vitest run scoring` — 5 test files passed, **70/70 tests** passed, 575ms
- D-07 guard: 0 violations across 5 scoring/ source files (re-verified as part of the same vitest run)
- `grep -cE "\?\? 0|\|\| 0"` on all three new sources — returns 0/0/0 (D-06 enforced)
- `grep -rn "from '@luqen/scanner'"` on `scoring/` — returns 0 matches (D-11 enforced)
- `grep -c "v2.11.0 component sub-score is brand color coverage only" packages/dashboard/src/services/scoring/token-score.ts` — returns 1 (mandatory comment intact)
- `grep -c "See Phase 15 CONTEXT D-09/D-10" packages/dashboard/src/services/scoring/token-score.ts` — returns 1

## Decisions Made

None beyond CONTEXT decisions. The three calculators were implemented following the plan's verbatim `<action>` blocks with two targeted adjustments (see Deviations below) driven by the Plan 15-02 D-07 guard, not by any new design decision.

## Deviations from Plan

**[Rule 3 — Blocking issue] Removed trailing inline threshold-number comments from CONTRAST_CODES in color-score.ts**

- **Found during:** Task 1 (while writing `color-score.ts`)
- **Issue:** The plan's verbatim source block for `CONTRAST_CODES` had trailing inline comments like `'Guideline1_4.1_4_3',   // AA  (minimum)  normal 4.5, large 3`. The Plan 15-02 D-07 fs-based guard skips lines whose *trimmed start* is `//`, `*`, or `/*` — but trailing inline comments on a code line do NOT match that filter, so the literal `4.5` and end-of-line `3` in those comments would have triggered the forbidden-pattern regex at test time.
- **Fix:** Moved the threshold explanation into a block of leading `//` comments above the array (which the guard correctly skips) and removed all literal threshold numerics from inline positions on code lines. The `CONTRAST_CODES` entries themselves remain verbatim; only the annotations moved.
- **Verification:** `npx vitest run scoring/wcag-math` re-run after the change confirmed the D-07 guard returned `violations: []` for color-score.ts.
- **No semantic change:** The code block's runtime behaviour is identical; only the placement of explanatory comments changed.
- **Files modified:** `packages/dashboard/src/services/scoring/color-score.ts`
- **Commit:** `918154d`

**[Rule 3 — Tooling] Substituted `pnpm` with `npm`/`npx` in verification commands**

- **Found during:** Task 1 verification step
- **Issue:** The plan's `<verify>` blocks specify `pnpm test -- scoring/...`, but this repo uses npm (see `package.json` scripts). Plans 15-01 and 15-02 already documented the same substitution.
- **Fix:** Used `cd packages/dashboard && npm run lint` (which runs `tsc --noEmit`) for typecheck and `cd packages/dashboard && npx vitest run scoring/<pattern>` for tests. Outcome identical to plan intent.
- **Files modified:** None.

## Observations

- The D-07 guard's regex family `/(?<![\w.])3\.0?(?![\w.\d])/` requires a literal `3.` (3 followed by a dot) — bare `3` without a dot does NOT trigger it. This is why `(100 * passes) / total` and `value * (4 / 3)` are safe even though they contain the integer `3` — there is no dot after the `3` in either expression. Plan 15-02's comment about "deliberately NOT blocking bare arithmetic forms like `sum / 3`" reflects this regex design precisely.
- The ReDoS guard test consistently completes in under 10ms locally (well under the 100ms budget). The bounded quantifiers (`{1,64}`, `{1,4}`) combined with the 10KB truncation make catastrophic backtracking structurally impossible on the patterns used here.
- `extractColorsFromContext` deduplicates within a single context call (the `!colors.includes(normalized)` check in `color-utils.ts`), so a context string containing `#ff0000` twice contributes a single token. Token-score aggregation therefore naturally forms a set union even without additional dedupe logic.
- The token-score source-comment guard test uses `readFileSync(__dirname + '...')` — `__dirname` works in vitest because it transforms ESM test files to provide CJS-style `__dirname`. Verified during the Plan 15-02 D-07 guard implementation; the same pattern is reused here.

## Known Stubs

None. All three files are pure TypeScript calculators with concrete formulas, unit-tested end-to-end. No placeholder data, no TODO comments, no mock implementations.

## Threat Flags

None. The threat surface added by this plan (regex on untrusted issue.context, set membership over guideline hex values, division by aggregated counts) is covered by the plan's existing `<threat_model>` entries T-15-03-01 through T-15-03-07 — all mitigated:

- **T-15-03-01 (ReDoS):** Bounded quantifiers + `MAX_CONTEXT_LEN = 10_000` + 100ms ReDoS guard test — **mitigated**
- **T-15-03-02 (Tampering via malformed guideline hex):** `normalizeHex` filter + explicit test for all-malformed case — **mitigated**
- **T-15-03-03 (Division by zero):** Explicit `brandedContrastIssues.length === 0`, `total === 0`, `brandTokens.size === 0` guards before every division — **mitigated**
- **T-15-03-04 (NaN propagation):** `Number.isFinite(ratio)` guard in `issuePasses` before `wcagContrastPasses` — **mitigated**
- **T-15-03-05 (Threshold literal injection):** D-07 fs-based guard from Plan 15-02 actively enforces across all 5 scoring/ source files — **mitigated**
- **T-15-03-07 (`?? 0` / `|| 0` coercion):** All three new files verified via grep to contain neither pattern — **mitigated**

## Self-Check: PASSED

**Files verified present:**
- FOUND: `packages/dashboard/src/services/scoring/color-score.ts`
- FOUND: `packages/dashboard/src/services/scoring/typography-score.ts`
- FOUND: `packages/dashboard/src/services/scoring/token-score.ts`
- FOUND: `packages/dashboard/tests/services/scoring/color-score.test.ts`
- FOUND: `packages/dashboard/tests/services/scoring/typography-score.test.ts`
- FOUND: `packages/dashboard/tests/services/scoring/token-score.test.ts`
- FOUND: `.planning/phases/15-scoring-model-contract/15-03-SUMMARY.md`

**Commits verified present:**
- FOUND: `918154d` — feat(15-03): add color sub-score calculator with WCAG pass-ratio
- FOUND: `9792316` — feat(15-03): add typography sub-score calculator with bounded-regex extraction
- FOUND: `ab3653e` — feat(15-03): add token sub-score calculator with brand-color coverage set-diff

**Build:** `tsc --noEmit` — exit 0, zero TS errors
**Tests:** `vitest run scoring` — 5 test files passed, 70/70 tests passed
**D-07 guard:** actively scanned 5 scoring/ source files and found 0 threshold literal violations
**D-06 (no-coerce):** 0 `?? 0` and 0 `|| 0` across all 3 new sources
**D-11 (no scanner imports):** 0 `@luqen/scanner` imports across scoring/
