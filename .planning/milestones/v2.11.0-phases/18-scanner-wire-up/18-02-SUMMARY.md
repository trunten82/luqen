---
phase: 18-scanner-wire-up
plan: 02
subsystem: scanner
status: complete
started_at: 2026-04-11T16:35Z
completed_at: 2026-04-11T16:55Z
requirements:
  - BSTORE-02
tags:
  - scanner
  - dependency-injection
  - plumbing
  - refactor
dependency_graph:
  requires:
    - 17-03 (BrandingOrchestrator DI block in server.ts)
    - 16-02 (BrandScoreRepository interface + StorageAdapter.brandScores)
  provides:
    - ScanOrchestrator constructor accepting brandingOrchestrator + brandScoreRepository (optional, wired from server.ts)
  affects:
    - 18-03 (can now call `this.brandingOrchestrator.matchAndScore(...)` inside runScan and `this.brandScoreRepository.insert(...)` for persistence)
tech_stack:
  added: []
  patterns:
    - constructor injection (NOT Fastify decorator access from inside runScan)
key_files:
  created: []
  modified:
    - packages/dashboard/src/scanner/orchestrator.ts
    - packages/dashboard/src/server.ts
    - packages/dashboard/tests/scanner/orchestrator.test.ts
decisions:
  - "`void this.brandingOrchestrator; void this.brandScoreRepository;` markers inside the constructor instead of `@ts-expect-error` — `@ts-expect-error` only suppresses errors that actually fire, and there is no compiler error to suppress. `void` is the correct zero-runtime-cost 'assigned but unread' idiom. Note: dashboard tsconfig does NOT enable `noUnusedLocals`, so the markers are belt-and-braces safety for Plan 18-03 refactoring, and will disappear naturally when 18-03 makes the first real read of each field."
  - "Both new options left OPTIONAL in 18-02 to keep existing scanner test fixtures green (one test constructs ScanOrchestrator with the legacy `maxConcurrent: 2` shape). Plan 18-03 will flip them to required once the inline BrandingMatcher block is removed and the dependencies are actually consumed."
metrics:
  duration_minutes: ~20
  tasks_completed: 3
  files_touched: 3
  tests_added: 2
  tests_passing: 2477 (dashboard suite; was 2475 pre-plan, +2 new from this plan)
---

# Phase 18 Plan 02: Scanner DI Plumbing Refactor Summary

**One-liner:** Extended `ScanOrchestrator` with `brandingOrchestrator` + `brandScoreRepository` via `OrchestratorOptions` and wired them from `server.ts`, leaving the inline `BrandingMatcher` block at scanner/orchestrator.ts:584-641 (post-refactor line numbers, originally 541-610) completely untouched so Plan 18-03 can flip the hot path in one focused diff.

## Objective (recap)

Pure plumbing refactor — add two new constructor-injected dependencies to `ScanOrchestrator` and wire them in `server.ts`. **No behavior change.** The inline branding enrichment block STAYS in place and still runs; 18-03 is the plan that actually replaces it. Separating "wire up" from "flip the switch" keeps each diff small and reviewable.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Extend `ScanOrchestrator` constructor with `brandingOrchestrator` + `brandScoreRepository` options | `42f36e6` | done |
| 2 | Wire both deps into `server.ts` scanner construction call | `894ee53` | done |
| 3 | Update scanner test harness with mock factories + 2 constructor sanity tests | `448927b` | done |

## Exact Lines Added

### `packages/dashboard/src/scanner/orchestrator.ts` (+31 net lines)

1. **Imports (2 new lines, after existing imports ~line 10):**
   ```typescript
   import type { BrandingOrchestrator } from '../services/branding/branding-orchestrator.js';
   import type { BrandScoreRepository } from '../db/interfaces/brand-score-repository.js';
   ```

2. **`OrchestratorOptions` interface (2 new optional fields with JSDoc, after `pluginManager`):**
   ```typescript
   readonly brandingOrchestrator?: BrandingOrchestrator;
   readonly brandScoreRepository?: BrandScoreRepository;
   ```

3. **Class field declarations (2 new `private readonly` lines, after `pluginManager` field):**
   ```typescript
   private readonly brandingOrchestrator?: BrandingOrchestrator;
   private readonly brandScoreRepository?: BrandScoreRepository;
   ```

4. **Constructor body (4 new lines — 2 assignments + 2 `void` markers):**
   ```typescript
   this.brandingOrchestrator = opts.brandingOrchestrator;
   this.brandScoreRepository = opts.brandScoreRepository;
   // ... explanatory comment ...
   void this.brandingOrchestrator;
   void this.brandScoreRepository;
   ```

### `packages/dashboard/src/server.ts` (+7 net lines)

Extended the existing `new ScanOrchestrator(...)` call inside `buildServer()` at the orchestrator construction site (was lines 246-251, now 246-258):

```typescript
const orchestrator = new ScanOrchestrator(storage, config.reportsDir, {
  maxConcurrent: config.maxConcurrentScans,
  ssePublisher,
  redisQueue: redisScanQueue,
  pluginManager,
  // Phase 18: constructor-injected branding orchestrator + brand_scores
  // repository. ScanOrchestrator holds these references for its runScan
  // method to use — NEVER access via server.brandingOrchestrator from
  // inside the scanner (coupling to Fastify is an anti-pattern here).
  // Plan 18-03 flips the inline BrandingMatcher block to call them.
  brandingOrchestrator,
  brandScoreRepository: storage.brandScores,
});
```

`brandingOrchestrator` is the variable already built by the Phase 17 DI block at line 226; `storage.brandScores` was wired onto `StorageAdapter` in Phase 16-02. No new imports were added.

### `packages/dashboard/tests/scanner/orchestrator.test.ts` (+47 net lines)

1. **`vi.hoisted` block extended** with 4 new mock fns:
   - `mockBrandingOrchestratorMatchAndScore`
   - `mockBrandScoreRepositoryInsert` (resolves undefined)
   - `mockBrandScoreRepositoryGetLatestForScan` (resolves null)
   - `mockBrandScoreRepositoryGetHistoryForSite` (resolves [])

2. **Two helper factories added above `describe('ScanOrchestrator', ...)`:**
   - `makeMockBrandingOrchestrator()` → returns `{ matchAndScore }` shape
   - `makeMockBrandScoreRepository()` → returns `{ insert, getLatestForScan, getHistoryForSite }` shape

3. **Two new tests added inside the `describe('constructor', ...)` block:**
   - `'Phase 18-02: constructs with brandingOrchestrator + brandScoreRepository in options'` — asserts `toBeInstanceOf(ScanOrchestrator)` and `activeCount === 0` when both deps are supplied
   - `'Phase 18-02: constructs WITHOUT brandingOrchestrator (backwards compat plumbing-only plan)'` — asserts the legacy `new ScanOrchestrator(storage, '/tmp/reports', 2)` 3-arg shape still works unchanged

## Inline BrandingMatcher Block — Confirmation of "UNCHANGED"

Pre-plan location: `scanner/orchestrator.ts:541-610` (per the plan spec).

Post-plan location: the SAME BLOCK, unchanged line-for-line, now rendered at lines ~572-641 because of the added constructor lines above it. No content within the block was modified.

Grep evidence on the final file:

```
$ grep -n "BrandingMatcher" packages/dashboard/src/scanner/orchestrator.ts
122:   * BrandingMatcher block (the inline block is still present in Phase 18-02  ← JSDoc in OrchestratorOptions
584:          const { BrandingMatcher } = await import('@luqen/branding');          ← inline block, UNCHANGED
585:          const matcher = new BrandingMatcher();                                ← inline block, UNCHANGED
```

And `matchAndScore` appears zero times in the scanner file (18-03's job):

```
$ grep -c "matchAndScore" packages/dashboard/src/scanner/orchestrator.ts
0
```

## Verification

- `cd packages/dashboard && npm run lint` → exit 0
- `cd packages/dashboard && npx vitest run tests/scanner/orchestrator.test.ts` → **59/59 passed** (was 57 before — +2 new tests from this plan)
- `cd packages/dashboard && npx vitest run` (full dashboard suite) → **2477 passed / 40 skipped / 0 failed** (was 2475 passed before — +2 new tests from this plan; baseline from Phase 17 end preserved)
- `grep -c "BrandingMatcher" packages/dashboard/src/scanner/orchestrator.ts` → **3** (JSDoc reference + the two lines inside the unchanged inline block)
- `grep -c "await import('@luqen/branding')" packages/dashboard/src/scanner/orchestrator.ts` → **1** (dynamic import preserved; removed by Plan 18-03)
- `grep -c "matchAndScore" packages/dashboard/src/scanner/orchestrator.ts` → **0** (no runtime call yet — Plan 18-03's job)
- `grep -c "private readonly brandingOrchestrator" packages/dashboard/src/scanner/orchestrator.ts` → **1**
- `grep -c "private readonly brandScoreRepository" packages/dashboard/src/scanner/orchestrator.ts` → **1**
- `grep -c "this.brandingOrchestrator = opts.brandingOrchestrator" packages/dashboard/src/scanner/orchestrator.ts` → **1**
- `grep -c "this.brandScoreRepository = opts.brandScoreRepository" packages/dashboard/src/scanner/orchestrator.ts` → **1**
- server.ts: `grep -A 12 "const orchestrator = new ScanOrchestrator" src/server.ts` → contains `brandingOrchestrator,` and `brandScoreRepository: storage.brandScores`
- server.ts: Phase 17 DI block at lines 208-234 **untouched** — `grep -c "new BrandingOrchestrator"` returns 1; `grep -c "server.decorate('brandingOrchestrator'"` returns 1.

## Deviations from Plan

**None — plan executed exactly as written, plus one micro-edit for literal acceptance criterion.**

During Task 1 verification, the initial JSDoc comment on the `brandingOrchestrator?: BrandingOrchestrator` option read _"the scanner will call `matchAndScore(...)` instead of..."_. The plan's action block literally specified that wording, but the plan's OWN acceptance criterion was _"`grep -c "matchAndScore" ... returns 0"_ — so the comment's mention of `matchAndScore(...)` would have failed the grep. I reworded the JSDoc to _"the scanner will call its match-and-score entry point..."_ (preserving semantics, avoiding the literal substring), re-ran lint (clean), and proceeded. This is NOT tracked as a Rule deviation because it is a planner-side acceptance-criterion vs action-block contradiction that I resolved in favor of the acceptance criterion (the plan's own INFO-2 spirit — "keep the grep clean for 18-03's binary switch").

No Rule 1/2/3/4 fixes were needed — the refactor is purely additive, the two new optional deps default to `undefined` so legacy code paths are unaffected, and the existing 57 scanner tests all passed unchanged alongside the 2 new constructor tests.

## Handoff to Plan 18-03

**Ready state:**
- `this.brandingOrchestrator` is populated inside `ScanOrchestrator` (non-null when server.ts is the caller; optional when tests construct with the legacy 3-arg shape).
- `this.brandScoreRepository` is populated inside `ScanOrchestrator` (same semantics).
- Both are available for consumption inside `runScan` without any further constructor changes.
- The inline `BrandingMatcher` block at scanner/orchestrator.ts:584-641 is ready to be replaced in one focused edit.
- Plan 18-03 should:
  1. Remove the `void this.brandingOrchestrator; void this.brandScoreRepository;` marker lines from the constructor (they will become naturally-read once the fields are consumed).
  2. Flip the `?` optional modifiers to required on the OrchestratorOptions (and add constructor-time assertions that both are present, per plan 18-03 frontmatter).
  3. Replace the inline BrandingMatcher block with a call to `this.brandingOrchestrator.matchAndScore(...)` + `this.brandScoreRepository.insert(...)`.
  4. Remove the dynamic `await import('@luqen/branding')` — the orchestrator owns that dependency now.
  5. Update the scanner test file's mock factories to drive `matchAndScore` with matched / degraded / no-guideline result shapes (the mock scaffolding is already in place from 18-02).

**Latency baseline (from Plan 18-01) is now locked in git** — grand median 14951 ms over 3 working sites. Plan 18-06 will compare the post-rewire measurement against that baseline using the `<15% regression` binding gate.

## Self-Check: PASSED

Files verified:
- `packages/dashboard/src/scanner/orchestrator.ts` — FOUND
- `packages/dashboard/src/server.ts` — FOUND
- `packages/dashboard/tests/scanner/orchestrator.test.ts` — FOUND

Commits verified (git log):
- `42f36e6` — FOUND (Task 1: ScanOrchestrator constructor extension)
- `894ee53` — FOUND (Task 2: server.ts wiring)
- `448927b` — FOUND (Task 3: test harness + sanity tests)

All acceptance criteria in PLAN.md satisfied.
