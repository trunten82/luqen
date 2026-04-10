---
phase: 15-scoring-model-contract
plan: 02
subsystem: scoring
tags: [typescript, wcag, contrast, luminance, tdd, vitest, fs-guard, d-07, boundary-fixtures]

# Dependency graph
requires:
  - phase: 15-scoring-model-contract
    plan: 01
    provides: scoring/ directory exists with types.ts and weights.ts (no threshold literal conflicts with D-07 guard)
  - package: "@luqen/branding"
    provides: normalizeHex (3-digit / mixed-case hex normalization, reused in hexToRgb)
provides:
  - wcagContrastPasses(ratio, level, isLargeText) — single source of truth predicate for WCAG 2.1 SC 1.4.3 / 1.4.6 / 1.4.11
  - relativeLuminance(r, g, b) — W3C relative luminance formula
  - contrastRatio(hexA, hexB) — symmetric hex-pair contrast ratio with normalizeHex handling
  - classifyLargeText(fontSizePt, isBold) — WCAG large-text classification
  - LARGE_TEXT_PT_THRESHOLD = 18 (named constant)
  - LARGE_TEXT_BOLD_PT_THRESHOLD = 14 (named constant)
  - fs-based D-07 enforcement guard test in scoring/ test dir
affects:
  - Phase 15 Plan 03 (color-score.ts imports wcagContrastPasses + contrastRatio, never writes raw thresholds)
  - Phase 15 Plan 04 (brand-score-calculator.ts — indirect via color-score)
  - All future scoring/ additions: D-07 guard runs on every vitest invocation and fails the build if a threshold literal leaks

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source-of-truth predicate for WCAG thresholds — callers never write literal 4.5/3/7"
    - "fs-based architectural enforcement test (node:fs only, zero child_process surface)"
    - "Sentinel-value error semantics (NaN ratio, false predicate) instead of exceptions at pure-function boundaries"
    - "Off-by-none boundary fixtures at every threshold (both sides + exact value)"

key-files:
  created:
    - packages/dashboard/src/services/scoring/wcag-math.ts
    - packages/dashboard/tests/services/scoring/wcag-math.test.ts
  modified: []

key-decisions:
  - "D-07 enforced at test time via fs-walk of scoring/ directory (no shell, no child_process)"
  - "D-18 boundary fixtures locked at 4.49/4.50/4.51/6.99/7.00/7.01/2.99/3.00/3.01 plus AAA large text 4.49/4.50"
  - "LARGE_TEXT_PT_THRESHOLD=18 and LARGE_TEXT_BOLD_PT_THRESHOLD=14 exported as named constants per CONTEXT specifics"
  - "Boundary semantics use >= (inclusive) — a ratio of exactly 4.5 passes AA; proven by test at exact boundary"
  - "NaN ratio → predicate returns false; malformed hex → contrastRatio returns NaN; no exceptions thrown anywhere"
  - "D-07 guard uses two regex families: decimal-form (always forbidden) + comparison-context bare integers; deliberately does NOT block bare `sum / 3` arithmetic used by typography-score.ts"

requirements-completed:
  - BSCORE-01

# Metrics
duration: ~8min
completed: 2026-04-10
---

# Phase 15 Plan 02: WCAG Math Single Source of Truth Summary

**Locked all WCAG 2.1 contrast threshold comparisons behind a single `wcagContrastPasses()` predicate, with off-by-none boundary fixtures at every threshold and an automated fs-based enforcement guard that fails the build if a literal `4.5 / 3 / 7` leaks into any other scoring/ file.**

## Performance

- **Duration:** ~8 minutes
- **Tasks:** 2/2 completed
- **Files created:** 2
- **Files modified:** 0

## Accomplishments

- Created `wcag-math.ts` as the single source of truth for WCAG 2.1 SC 1.4.3 / 1.4.6 / 1.4.11 threshold comparisons
- Exported the full public surface planned in Wave 1's interfaces section: `relativeLuminance`, `contrastRatio`, `wcagContrastPasses`, `classifyLargeText`, `LARGE_TEXT_PT_THRESHOLD`, `LARGE_TEXT_BOLD_PT_THRESHOLD`
- Routed malformed hex (`normalizeHex` returns empty string) through sentinel `NaN` so callers route to `unscorable` instead of silently scoring a malformed color
- Wrote 31 unit tests covering every boundary in D-18 plus W3C luminance reference values (white, black, pure R/G/B) and classifyLargeText inclusive-boundary edge cases
- Built an fs-based D-07 enforcement guard that walks `packages/dashboard/src/services/scoring/` (skipping wcag-math.ts), opens every `.ts` file with `node:fs`, and asserts zero threshold literal occurrences in executable (non-comment) lines
- Guard uses two regex families: decimal-form (always forbidden: `4.5`, `4.50`, `7.0`, `3.0`) plus comparison-context bare integers (`>= 3`, `< 7`, `<= 4.5`) — and deliberately does NOT block bare integer arithmetic like `sum / 3` (which typography-score.ts will legitimately need for the D-02 three-heuristic mean)
- Vacuous-pass guard (`expect(files.length).toBeGreaterThan(0)`) proves the guard actually scanned real files — holds from this plan onward because Wave 1 already placed types.ts + weights.ts under scoring/

## Task Commits

Each task was committed atomically:

1. **Task 1: Create wcag-math.ts with luminance, ratio, threshold predicate** — `d57fdb1` (feat)
2. **Task 2: Create wcag-math.test.ts with boundary fixtures + fs-based D-07 enforcement guard** — `b46e906` (test)

## Files Created/Modified

- `packages/dashboard/src/services/scoring/wcag-math.ts` — single source of truth for WCAG thresholds; exports `relativeLuminance`, `contrastRatio`, `wcagContrastPasses`, `classifyLargeText`, `LARGE_TEXT_PT_THRESHOLD`, `LARGE_TEXT_BOLD_PT_THRESHOLD`; 115 lines
- `packages/dashboard/tests/services/scoring/wcag-math.test.ts` — 31 vitest unit tests + fs-based D-07 enforcement guard; 231 lines

## Public Surface Exported (for Plan 15-03 consumption)

```typescript
export const LARGE_TEXT_PT_THRESHOLD = 18;       // normal weight ≥18pt is "large"
export const LARGE_TEXT_BOLD_PT_THRESHOLD = 14;  // bold ≥14pt is "large"

export function classifyLargeText(fontSizePt: number, isBold: boolean): boolean;
export function relativeLuminance(r: number, g: number, b: number): number;
export function contrastRatio(hexA: string, hexB: string): number;
export function wcagContrastPasses(
  ratio: number,
  level: 'AA' | 'AAA',
  isLargeText: boolean,
): boolean;
```

## Boundary Fixtures (D-18)

| Boundary         | Level | Large text | Below (fails) | Exact (passes) | Above (passes) |
|------------------|-------|-----------:|--------------:|---------------:|---------------:|
| AA normal text   | AA    | no         | 4.49          | 4.50           | 4.51           |
| AAA normal text  | AAA   | no         | 6.99          | 7.00           | 7.01           |
| AA large text    | AA    | yes        | 2.99          | 3.00           | 3.01           |
| AAA large text   | AAA   | yes        | 4.49          | 4.50           | —              |

Off-by-none proved at every boundary: `>=` is inclusive, a ratio exactly at the threshold passes.

## WCAG Reference Luminance Values

Tests assert these W3C-documented values within 1e-4 / 1e-5 tolerance:

| Color          | RGB            | Relative luminance |
|----------------|----------------|--------------------|
| white          | (255,255,255)  | 1.0                |
| black          | (0,0,0)        | 0.0                |
| pure red       | (255,0,0)      | 0.2126             |
| pure green     | (0,255,0)      | 0.7152             |
| pure blue      | (0,0,255)      | 0.0722             |

Also asserted: `contrastRatio('#FFFFFF', '#000000') === 21` (maximum), `contrastRatio('#777777', '#777777') === 1` (minimum), symmetry, 3-digit hex normalization via `normalizeHex`, lowercase hex handling.

## D-07 Enforcement Test Location

`packages/dashboard/tests/services/scoring/wcag-math.test.ts`, describe block `D-07 enforcement — no literal WCAG thresholds outside wcag-math.ts`.

**Mechanism:**
1. `listScoringSourceFiles()` — `node:fs` walk of `packages/dashboard/src/services/scoring/` returning every `.ts` file except `wcag-math.ts`
2. Vacuous-pass guard: `expect(files.length).toBeGreaterThan(0)` — currently ≥2 (types.ts + weights.ts from Plan 15-01)
3. Comment-line skip: lines starting with `//`, `*`, or `/*` are excluded (comments may reference WCAG threshold numbers in documentation)
4. Forbidden pattern families:
   - **Decimal forms (always forbidden):** `/(?<![\w.])4\.50?(?![\w.])/`, `/(?<![\w.])7\.0?(?![\w.\d])/`, `/(?<![\w.])3\.0?(?![\w.\d])/`
   - **Comparison-context bare integers:** `/([<>]=?\s*)3(?![\w.\d])/`, `/([<>]=?\s*)4\.5(?![\w.\d])/`, `/([<>]=?\s*)7(?![\w.\d])/`
5. Violations array collected with `{file, line, text}`, asserted `.toEqual([])` with a formatted error message showing every offender

**Security:** Uses only `node:fs` (`readdirSync`, `readFileSync`, `statSync`) — zero `child_process` / `execSync` surface. Threat T-15-02-05 mitigated.

## Test Counts

- **wcag-math.test.ts:** 31 tests, 31 passed, 0 failed (`vitest run scoring/wcag-math`, ~435ms)

Breakdown by describe block:
- `relativeLuminance (WCAG 2.1)` — 5 tests (white, black, pure R/G/B)
- `contrastRatio` — 7 tests (21:1 max, symmetry, 1:1 identical, 3-digit, lowercase, 2× NaN guards)
- `wcagContrastPasses — AA normal text boundary (D-18)` — 3 tests (4.49/4.50/4.51)
- `wcagContrastPasses — AAA normal text boundary (D-18)` — 3 tests (6.99/7.00/7.01)
- `wcagContrastPasses — AA large text boundary at 3.0 (D-18)` — 3 tests (2.99/3.00/3.01)
- `wcagContrastPasses — AAA large text boundary at 4.5 (D-18)` — 2 tests (4.49/4.50)
- `wcagContrastPasses — non-finite inputs` — 1 test (NaN → false)
- `classifyLargeText` — 6 tests (constants export, 18pt inclusive, 17.99pt, 14pt bold inclusive, 13.99pt bold, non-finite / non-positive)
- `D-07 enforcement — no literal WCAG thresholds outside wcag-math.ts` — 1 test (scans types.ts + weights.ts, finds 0 violations)

## Verification

- `cd packages/dashboard && npm run lint` (tsc --noEmit) — exit 0, zero errors
- `cd packages/dashboard && npx vitest run scoring/wcag-math` — 1 test file passed, 31/31 tests passed, 435ms total
- D-07 guard scanned 2 files (`types.ts`, `weights.ts`) and found 0 violations — guard is active, not vacuous
- Full public surface (6 exports) present and compiles cleanly
- `grep -c "child_process" tests/services/scoring/wcag-math.test.ts` returns 0 (T-15-02-05 mitigation verified)

## Decisions Made

None beyond CONTEXT decisions (D-07, D-18, and the "specifics" section on LARGE_TEXT constants). All code was written verbatim from the plan's `<action>` blocks — no field renames, no regex edits, no reordering, no additions.

## Deviations from Plan

**[Rule 3 – Tooling]** The plan's `<verify>` blocks specify `pnpm build` and `pnpm test`, but this repo uses **npm** (see root `package.json` workspaces, `packages/dashboard/package.json` scripts). Wave 1 (Plan 15-01) already documented `tsc --noEmit` and `vitest run` as its verification commands — same pattern used here. Substituted `npm run lint` (which is `tsc --noEmit`) and `npx vitest run scoring/wcag-math`. Outcome is identical to the plan's intent: TypeScript build clean, target test suite green. No source or test file content changed.

## Observations

- The D-07 guard comment in the plan references Plan 15-01 (types.ts + weights.ts) as the initial 2-file population; both files were verified ahead of time to contain no forbidden patterns (no `4.5`, no `3`/`7` in comparison contexts — `0.30`/`0.50` decimal prefixes are correctly excluded by the `(?<![\w.])` lookbehind).
- Tests use `__dirname` via the `tests/services/scoring/` path; vitest 4.1.0 supports CJS `__dirname` in ESM test files via its transform — verified working in the passing test run.
- The classifyLargeText boundary test at 13.99pt bold intentionally uses the exact `>=` comparison (13.99 < 14, so returns `false`).

## Known Stubs

None. This plan creates pure numeric utility functions and their unit tests; no UI, no data fetching, no runtime paths that could carry placeholder data.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `packages/dashboard/src/services/scoring/wcag-math.ts`
- FOUND: `packages/dashboard/tests/services/scoring/wcag-math.test.ts`
- FOUND: `.planning/phases/15-scoring-model-contract/15-02-SUMMARY.md`

**Commits verified present:**
- FOUND: `d57fdb1` — feat(15-02): lock WCAG math as single source of truth for contrast thresholds
- FOUND: `b46e906` — test(15-02): add WCAG boundary fixtures and D-07 enforcement guard

**Build:** `tsc --noEmit` — exit 0, zero TS errors
**Tests:** `vitest run scoring/wcag-math` — 31/31 passing, 0 failed
**D-07 guard:** actively scanned 2 scoring/ source files (types.ts, weights.ts) and found 0 threshold literal violations
