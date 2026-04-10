---
phase: 15-scoring-model-contract
plan: 01
subsystem: scoring
tags: [typescript, tagged-union, discriminated-union, branding, wcag, type-contract, weights, immutable, vitest]

# Dependency graph
requires:
  - phase: 09-branding-pipeline-completion
    provides: BrandedIssue / BrandGuideline / BrandColor shapes imported from @luqen/branding
provides:
  - ScoreResult tagged union (kind: 'scored' | 'unscorable') locked in types.ts (D-12)
  - SubScore tagged union with per-dimension SubScoreDetail discriminant (D-13)
  - CoverageProfile interface including contributingWeight: number (D-14)
  - UnscorableReason string-literal union with 6 locked values (D-15)
  - WEIGHTS immutable constant {color: 0.50, typography: 0.30, components: 0.20} (D-05)
  - WeightKey type for downstream discriminants
affects:
  - Phase 15 plans 02-05 (wcag-math, color-score, typography-score, token-score, calculator)
  - Phase 16 brand_scores persistence (column shape + unscorable_reason enum)
  - Phase 17 BrandingOrchestrator (calls calculateBrandScore → ScoreResult)
  - Phases 20/21 UI (empty-state rendering depends on SubScore discriminant)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated unions as idiomatic null-avoidance (no number | null anywhere)"
    - "Object.freeze + Readonly<Record<K, V>> pattern for compile-time + runtime immutability of constants"

key-files:
  created:
    - packages/dashboard/src/services/scoring/types.ts
    - packages/dashboard/src/services/scoring/weights.ts
    - packages/dashboard/tests/services/scoring/weights.test.ts
  modified: []

key-decisions:
  - "D-12 top-level ScoreResult locked as tagged union on kind: 'scored' | 'unscorable'"
  - "D-13 SubScore locked as tagged union; each dimension carries its own detail discriminator"
  - "D-14 CoverageProfile carries contributingWeight: number for renormalized composite denominator"
  - "D-15 UnscorableReason locked at exactly 6 string literals — no free-text reasons"
  - "D-16 no number | null in scoring type surface; absence routed through unscorable variant"
  - "D-05 WEIGHTS locked constants {color:0.50, typography:0.30, components:0.20} — frozen, not per-org overridable"

patterns-established:
  - "scoring/ module convention: pure TS, no I/O, types.ts as contract hub, constants in dedicated files"
  - "Test co-location: packages/dashboard/tests/services/scoring/*.test.ts mirrors src/services/scoring/*.ts"
  - "Locked-constants file header: 'DO NOT change ... schema version bump' pattern copies D-05 spec verbatim"

requirements-completed:
  - BSCORE-04
  - BSCORE-05

# Metrics
duration: ~5min
completed: 2026-04-10
---

# Phase 15 Plan 01: Score Type Contract & Locked Weights Summary

**Locked the discriminated-union brand score contract (ScoreResult / SubScore / CoverageProfile / UnscorableReason) and frozen composite weights before any calculator code is written — every downstream scoring, persistence, and UI plan now imports from a single immutable source.**

## Performance

- **Duration:** ~5 minutes
- **Started:** 2026-04-10T21:52:00Z
- **Completed:** 2026-04-10T21:57:43Z
- **Tasks:** 2/2 completed
- **Files created:** 3
- **Files modified:** 0

## Accomplishments

- Locked the entire v2.11.0 brand-score type surface in `types.ts`: `ScoreResult`, `SubScore`, `SubScoreDetail` (ColorSubScoreDetail, TypographySubScoreDetail, ComponentsSubScoreDetail), `CoverageProfile`, and `UnscorableReason` — all discriminated unions, all readonly, no `number | null` at the type level
- Locked the composite weights `{color: 0.50, typography: 0.30, components: 0.20}` in `weights.ts` with `Object.freeze` + `Readonly<Record<WeightKey, number>>` — compile-time **and** runtime immutability
- Proved immutability and key-set correctness with 7 passing vitest unit tests in `weights.test.ts` (exact values, floating-point sum, frozen-at-runtime, strict-mode mutation rejection, key enumeration)
- Dashboard TypeScript build (`tsc --noEmit`) is clean (0 errors) — downstream plans can now import from `./types.js` and `./weights.js`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create types.ts with tagged-union score contract (D-12..D-16)** — `9312c43` (feat)
2. **Task 2: Create weights.ts locked constants (D-05) with unit tests** — `0d0403f` (feat)

**Plan metadata:** (this SUMMARY commit — added after self-check)

## Files Created/Modified

- `packages/dashboard/src/services/scoring/types.ts` — tagged-union contract (ScoreResult / SubScore / CoverageProfile / UnscorableReason / per-dimension detail shapes); 85 lines
- `packages/dashboard/src/services/scoring/weights.ts` — frozen WEIGHTS constant + WeightKey type; mandatory "DO NOT change" source comment per CONTEXT specifics; 19 lines
- `packages/dashboard/tests/services/scoring/weights.test.ts` — 7 vitest unit tests proving exact values, sum, runtime freeze, mutation rejection, and key set; 37 lines

## Locked Type Shapes (for downstream reference)

```typescript
// ScoreResult (D-12)
type ScoreResult =
  | { kind: 'scored'; overall: number; color: SubScore; typography: SubScore;
      components: SubScore; coverage: CoverageProfile }
  | { kind: 'unscorable'; reason: UnscorableReason };

// SubScore (D-13)
type SubScore =
  | { kind: 'scored'; value: number; detail: SubScoreDetail }
  | { kind: 'unscorable'; reason: UnscorableReason };

// SubScoreDetail (per-dimension discriminant)
type SubScoreDetail =
  | { dimension: 'color'; passes: number; fails: number }
  | { dimension: 'typography'; fontOk: boolean; sizeOk: boolean; lineHeightOk: boolean }
  | { dimension: 'components'; matched: number; total: number };

// CoverageProfile (D-14)
interface CoverageProfile {
  color: boolean;
  typography: boolean;
  components: boolean;
  contributingWeight: number; // 0..1
}

// UnscorableReason (D-15) — exactly 6 values
type UnscorableReason =
  | 'no-guideline' | 'empty-guideline' | 'no-branded-issues'
  | 'no-typography-data' | 'no-component-tokens' | 'all-subs-unscorable';
```

## Locked Weight Values (D-05)

| Dimension  | Weight |
|------------|--------|
| color      | 0.50   |
| typography | 0.30   |
| components | 0.20   |
| **Sum**    | 1.00   |

Frozen at module load via `Object.freeze`, typed `Readonly<Record<WeightKey, number>>`. TypeScript rejects assignment at compile time; strict-mode runtime throws on mutation attempt.

## Test Counts

- **weights.test.ts:** 7 tests, 7 passed, 0 failed (vitest run scoring/weights)

Test coverage per acceptance criteria:
1. `WEIGHTS.color === 0.50`
2. `WEIGHTS.typography === 0.30`
3. `WEIGHTS.components === 0.20`
4. Sum to 1.0 within `Number.EPSILON * 4`
5. `Object.isFrozen(WEIGHTS) === true`
6. Strict-mode assignment throws (`@ts-expect-error` on the mutation line proves TS readonly too)
7. Key set is exactly `['color', 'components', 'typography']` (sorted)

## Verification

- `tsc --noEmit` — exit 0, zero errors
- `vitest run scoring/weights` — 1 test file passed, 7/7 tests passed, 252ms total
- All 6 `UnscorableReason` literal values present in `types.ts`
- `contributingWeight: number` present exactly once in `types.ts`
- No type-level `number | null` / `null | number` anywhere in `packages/dashboard/src/services/scoring/` sources (see "Observations" below for the comment-block note)
- `Object.freeze` + `DO NOT change these values at runtime or per-org` source comment both present in `weights.ts`

## Decisions Made

None beyond the CONTEXT decisions (D-05, D-12..D-16) — this plan was pure contract locking. All internal helper names, file layout, and test structure followed the verbatim plan action blocks.

## Deviations from Plan

None — plan executed exactly as written. Both Task 1 and Task 2 source files were created with the exact verbatim content from the plan's `<action>` blocks (no field renames, no comment edits, no reordering, no additions).

## Observations

**Comment-block `number | null` substring in `types.ts` (intentional, not a deviation):**
The plan's verbatim `types.ts` content contains the substring "`number | null`" twice inside the JSDoc header block — explaining the D-16 rule. A naive `grep -cE "number \| null"` returns 2 matches, but these are **documentation of the rule**, not type-level occurrences. D-16 forbids `number | null` as a *type construct*; our scoring type surface contains zero such constructs (verified with a comment-excluding grep). The `must_haves.truths` in the plan frontmatter correctly frames this as "No exported type contains `number | null` or `null | number`" — which is satisfied. No deviation needed; the verbatim comment is preserved.

## Known Stubs

None. This plan creates pure type declarations and one immutable constant; no UI, no data fetching, no runtime paths that could carry placeholder data.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `packages/dashboard/src/services/scoring/types.ts`
- FOUND: `packages/dashboard/src/services/scoring/weights.ts`
- FOUND: `packages/dashboard/tests/services/scoring/weights.test.ts`
- FOUND: `.planning/phases/15-scoring-model-contract/15-01-SUMMARY.md`

**Commits verified present:**
- FOUND: `9312c43` — feat(15-01): lock brand score type contract
- FOUND: `0d0403f` — feat(15-01): lock brand score composite weights

**Build:** `tsc --noEmit` — exit 0
**Tests:** `vitest run scoring/weights` — 7/7 passing
