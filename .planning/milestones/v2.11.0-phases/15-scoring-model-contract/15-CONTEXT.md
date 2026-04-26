# Phase 15: Scoring Model & Contract - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 15 delivers a **pure TypeScript brand score calculator** in the dashboard that takes `BrandedIssue[]` + `BrandGuideline` and returns a tagged-union `ScoreResult`. No database writes, no UI, no scanner wiring. Every layer downstream of this phase depends on the type shape and math locked here.

**In scope:**
- `packages/dashboard/src/services/scoring/wcag-math.ts` — WCAG 2.1 relative luminance, contrast ratio, `wcagContrastPasses(ratio, level, isLargeText)` — single source of truth for thresholds
- `packages/dashboard/src/services/scoring/typography-score.ts` — pure function `(BrandedIssue[], BrandGuideline) → SubScore`
- `packages/dashboard/src/services/scoring/token-score.ts` — pure set-diff function `(BrandedIssue[], BrandGuideline) → SubScore`
- `packages/dashboard/src/services/scoring/color-score.ts` — pure contrast aggregation `(BrandedIssue[], BrandGuideline) → SubScore`
- `packages/dashboard/src/services/scoring/weights.ts` — locked constants `{color: 0.50, typography: 0.30, components: 0.20}`
- `packages/dashboard/src/services/scoring/types.ts` — `ScoreResult`, `SubScore`, `CoverageProfile`, `UnscorableReason` tagged unions
- `packages/dashboard/src/services/scoring/brand-score-calculator.ts` — public entry point `calculateBrandScore(issues, guideline): ScoreResult`
- Unit tests per module, including explicit WCAG threshold boundary fixtures

**Out of scope (explicitly NOT this phase):**
- Migration 043 and `brand_scores` table (Phase 16)
- `BrandingAdapter` / `BrandingOrchestrator` (Phase 17)
- Scanner/retag rewire, persistence of scores (Phase 18)
- Admin UI, report panel, dashboard widget (Phases 19/20/21)
- Any scanner change for typography extraction (stays inside `issue.context` parsing)

</domain>

<decisions>
## Implementation Decisions

### Scoring Math

- **D-01: Color sub-score formula.** `score = 100 × passes / (passes + fails)` — simple pass ratio. Matches Siteimprove-style norms; stable under small deltas; easy to explain. No severity-weighting, no log scale.
- **D-02: Typography sub-score formula.** Equal-weight boolean mean of three heuristics: (a) brand font family present, (b) body text ≥16px, (c) line-height ≥1.5. Each heuristic is 0 or 100; sub-score = (sum / 3). Predictable; matches "pass all 3" mental model.
- **D-03: Component sub-score formula.** `score = 100 × |brand_tokens ∩ used_tokens| / |brand_tokens|` — brand token coverage (answers "what % of my brand tokens actually appear on the site"). Returns `unscorable` when `|brand_tokens| === 0`.
- **D-04: Composite formula.** `overall = Σ(weight_i × sub_i) / Σ(weight_i)` over only the **scored** sub-scores. When a sub is `unscorable`, its weight drops out and remaining weights are proportionally renormalized. Composite is itself `unscorable` only when ALL three subs are unscorable.
- **D-05: Weights are locked constants.** `{color: 0.50, typography: 0.30, components: 0.20}` exported from a single `weights.ts`. Not per-org overridable. A later milestone can bump via schema version — never via runtime config.
- **D-06: No `null → 0` coercion anywhere.** Absence of data is `unscorable` with a `reason`. Zero is a legitimate score only when there is at least one data point and all of it failed.
- **D-07: No literal WCAG thresholds outside `wcag-math.ts`.** Every `4.5 / 3 / 7` comparison routes through `wcagContrastPasses(ratio: number, level: 'AA' | 'AAA', isLargeText: boolean): boolean`.

### Data Sources (Phase 15 boundary)

- **D-08: Typography data comes from `BrandedIssue.context` parsing.** Phase 15 opportunistically extracts `font-family`, `font-size`, `line-height` declarations from `issue.context` HTML/CSS strings using regex. No scanner change. If context yields no typography data, typography sub-score returns `unscorable` with reason `'no-typography-data'`.
- **D-09: Component "used tokens" are the hex colors extracted from `issue.context` across all branded issues.** Reuses the existing `extractColorsFromContext()` helper from `@luqen/branding/src/utils/color-utils.ts` (hex + rgb regex). In v2.11.0 the "component" sub-score is effectively "brand color coverage" — this must be documented explicitly in the calculator source comments and surfaced in downstream panel/widget tooltip copy so users aren't misled.
- **D-10: "Brand tokens" for component scoring are `guideline.colors[]`.** Font families and component selectors are NOT part of the v2.11.0 component set-diff — they are typography-domain and component-selector-domain respectively and belong to future milestones.
- **D-11: Phase 15 adds ZERO scanner changes.** If `BrandedIssue.context` doesn't have the data we want, we return `unscorable` — we do NOT reach into the scanner or extend its output.

### Type Shape

- **D-12: Top-level tagged union.**
  ```typescript
  type ScoreResult =
    | { kind: 'scored'; overall: number; color: SubScore; typography: SubScore; components: SubScore; coverage: CoverageProfile }
    | { kind: 'unscorable'; reason: UnscorableReason }
  ```
- **D-13: Nested per-dimension tagged union.**
  ```typescript
  type SubScore =
    | { kind: 'scored'; value: number; detail: SubScoreDetail }
    | { kind: 'unscorable'; reason: UnscorableReason }
  ```
  Where `SubScoreDetail` is a per-category discriminated structure (e.g. `{ passes: number; fails: number }` for color, `{ fontOk: boolean; sizeOk: boolean; lineHeightOk: boolean }` for typography, `{ matched: number; total: number }` for components).
- **D-14: `CoverageProfile` JSON shape.**
  ```typescript
  interface CoverageProfile {
    color: boolean;          // did we have any contrast issues to score?
    typography: boolean;     // did we extract any typography data?
    components: boolean;     // did guideline.colors[] have entries?
    contributingWeight: number; // sum of weights for scored sub-scores (0..1)
  }
  ```
- **D-15: `UnscorableReason` union.** `'no-guideline' | 'empty-guideline' | 'no-branded-issues' | 'no-typography-data' | 'no-component-tokens' | 'all-subs-unscorable'`. No free-text reasons — downstream persistence needs enum discipline.
- **D-16: No `number | null` anywhere in the type surface.** The nullable-number shape is rejected explicitly. Every place a number might be missing, use the tagged union.

### Testing Strategy

- **D-17: Unit tests per module.** One test file per source file: `wcag-math.test.ts`, `color-score.test.ts`, `typography-score.test.ts`, `token-score.test.ts`, `weights.test.ts`, `brand-score-calculator.test.ts`.
- **D-18: WCAG threshold boundary fixtures inside `wcag-math.test.ts`.** Explicit cases at 4.49 / 4.50 / 4.51 / 6.99 / 7.00 / 7.01 proving AA and AAA boundaries are off-by-none, plus large-text variants at 3.0 boundary. These are part of the unit test — NOT a separate test file.
- **D-19: Calculator unit tests cover all 6 unscorable reasons.** Each `UnscorableReason` enum value must have at least one dedicated test case proving the calculator returns it under the right condition. No catch-all "unscorable" assertion.
- **D-20: Calculator unit tests include the composite renormalization paths.** Three scored subs; two scored + one unscorable; one scored + two unscorable; zero scored. Assert that weights are renormalized correctly and `contributingWeight` reflects the actual denominator.
- **D-21: No fuzz tests, no property-based tests, no golden fixtures in Phase 15.** Deliberately kept to focused unit tests. If regressions later justify it, add fuzz tests in a retroactive `/gsd-validate-phase` pass — not upfront.

### Claude's Discretion

- Internal helper names inside each scoring module (e.g. `relativeLuminance`, `contrastRatio`, `classifyLargeText`) — pick idiomatic TypeScript names consistent with the rest of the dashboard.
- Whether `typography-score.ts` internally uses a small regex-per-rule approach or a single pass with a field accumulator — either is fine as long as the public function is pure and the unit tests prove each rule independently.
- Exact regex patterns for typography extraction from `issue.context` (font-family declarations, numeric pt/px/em/rem parsing, line-height unitless vs numeric) — use well-known CSS regex idioms and cover with unit tests.
- File-internal sub-score detail field names, as long as they're typed with discriminants and unit-tested.

### Folded Todos

None — no pending todos matched Phase 15 at cross-reference time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research
- `.planning/research/SUMMARY.md` — synthesis; locks scoring location, weights, tagged-union rule, no-backfill policy
- `.planning/research/STACK.md` — confirms zero new npm deps, in-tree `wcag-math.ts` approach
- `.planning/research/FEATURES.md` — scoring dimension definitions, anti-features, MVP scope
- `.planning/research/ARCHITECTURE.md` — why scoring lives in dashboard (not `@luqen/branding`)
- `.planning/research/PITFALLS.md` — Pitfalls #1, #2, #4 directly inform D-06, D-07, D-12..D-16

### Milestone-wide planning
- `.planning/PROJECT.md` — goal + key decisions table
- `.planning/REQUIREMENTS.md` — BSCORE-01..05 mapped to this phase; Traceability table
- `.planning/ROADMAP.md` — Phase 15 goal, dependencies, 5 success criteria

### Existing codebase references (reuse)
- `packages/branding/src/matcher/color-matcher.ts` — `CONTRAST_CODES` set; canonical list of WCAG issue codes we aggregate
- `packages/branding/src/matcher/index.ts` — how the matcher produces `BrandedIssue[]`
- `packages/branding/src/utils/color-utils.ts` — `normalizeHex`, `extractColorsFromContext` (reused for token-score.ts)
- `packages/branding/src/types.ts` — `BrandedIssue<T>`, `MatchableIssue`, `BrandColor`, `BrandGuideline` shapes
- `packages/dashboard/src/services/` — existing service directory layout convention for new `scoring/` subdir

### WCAG spec (for unit test correctness)
- WCAG 2.1 SC 1.4.3 (Contrast Minimum, AA 4.5:1 / 3:1 large text)
- WCAG 2.1 SC 1.4.6 (Contrast Enhanced, AAA 7:1 / 4.5:1 large text)
- WCAG 2.1 SC 1.4.11 (Non-text Contrast, 3:1)
- WCAG 2.1 SC 1.4.12 (Text Spacing — line-height ≥1.5)
- WCAG 2.1 relative luminance formula (W3C Understanding §Relative Luminance)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`extractColorsFromContext(issue.context)`** (`packages/branding/src/utils/color-utils.ts`) — handles hex + rgb() regex; directly usable for component "used tokens" set in D-09
- **`normalizeHex()`** (same file) — already handles 3-digit expansion and case normalization; reuse for guideline brand token normalization
- **`CONTRAST_CODES`** (`packages/branding/src/matcher/color-matcher.ts`) — the canonical set of issue codes that count as "contrast-related"; color-score.ts should either import this or duplicate it with a comment pointing here
- **`BrandedIssue<T>`** (`packages/branding/src/types.ts`) — existing type already has `issue.code`, `issue.context`, `brandMatch` — no new cross-package types needed

### Established Patterns
- Dashboard services live in `packages/dashboard/src/services/*.ts` with sibling unit tests in `packages/dashboard/tests/services/*.test.ts`
- Pure calculator modules follow the "no I/O, no mutation, single-export-per-file" convention (e.g. existing retag + matcher helpers)
- TS strict mode — discriminated unions are the idiomatic null-avoidance pattern in this codebase

### Integration Points
- **Phase 16** imports `ScoreResult` + `SubScore` + `CoverageProfile` types from `scoring/types.ts` to define the `brand_scores` table column shape
- **Phase 17** `BrandingOrchestrator` calls `calculateBrandScore()` after each adapter returns `BrandedIssue[]`
- **Phases 20/21** UI reads persisted scores (phase 18 wrote them), but the display logic depends on the `SubScore` discriminant to decide empty-state rendering — so the type shape here is the contract for UI empty states too

</code_context>

<specifics>
## Specific Ideas

- Unit tests must assert the exact composite renormalization: if weights start at `{color:0.50, typography:0.30, components:0.20}` and typography is unscorable, the composite is `(0.50 × color + 0.20 × components) / 0.70` — NOT `(0.50 × color + 0.20 × components) / 1.0`. This is Pitfall #1 made concrete.
- `wcag-math.ts` should export a named constant `LARGE_TEXT_PT_THRESHOLD = 18` and `LARGE_TEXT_BOLD_PT_THRESHOLD = 14` — any future reader should find one canonical source for what "large text" means in this codebase.
- Source comments in `token-score.ts` must explicitly document "v2.11.0 component sub-score is brand color coverage only — font families and component selectors are NOT included. See Phase 15 CONTEXT D-09/D-10."
- Source comments in `weights.ts` must document "DO NOT change these values at runtime or per-org — weight changes corrupt historical trend data. Bump schema version if weights need to change in a future milestone."

</specifics>

<deferred>
## Deferred Ideas

- **Fuzz / property-based tests** — skipped in Phase 15 by D-21; reconsider via `/gsd-validate-phase 15` after Phase 18 if real-world data surfaces edge cases
- **Scanner typography extension** — D-11 explicitly forbids scanner changes in Phase 15; a broader typography-score upgrade (real CSS pull, x-height calc) is a v2.12.0 candidate
- **Font family + component selector set-diff** — D-10 limits v2.11.0 component scoring to brand colors only; widening to fonts + selectors is a v2.12.0 candidate
- **Per-org weight customization** — anti-feature; never
- **Severity-weighted or log-scaled color math** — rejected in D-01 for v2.11.0; could be revisited only with a schema version bump

</deferred>

---

*Phase: 15-scoring-model-contract*
*Context gathered: 2026-04-10*
