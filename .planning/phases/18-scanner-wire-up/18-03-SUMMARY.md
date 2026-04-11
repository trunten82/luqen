---
phase: 18-scanner-wire-up
plan: 03
subsystem: scanner
status: complete
started_at: 2026-04-11T16:55Z
completed_at: 2026-04-11T17:06Z
requirements:
  - BSTORE-02
  - BSTORE-06
tags:
  - scanner
  - branding
  - orchestrator-dispatch
  - hot-path-rewire
  - invariant-pinning
dependency_graph:
  requires:
    - 18-02 (ScanOrchestrator constructor DI for brandingOrchestrator + brandScoreRepository)
    - 17-03 (BrandingOrchestrator.matchAndScore tagged-union contract)
    - 16-02 (BrandScoreRepository.insert + StorageAdapter.brandScores plumbing)
  provides:
    - Scanner that calls brandingOrchestrator.matchAndScore exactly ONCE per scan
    - Append-only persistence of ScoreResult (scored + unscorable) via brandScoreRepository
  affects:
    - 18-05 (LEFT JOIN trend query can now assume brand_scores rows flow from live scans)
    - 18-06 (latency gate measures the rewired hot path)
tech_stack:
  added: []
  patterns:
    - tagged-union dispatch (match / degraded / no-guideline)
    - explicit narrowing binding (liveGuideline) instead of non-null assertions
    - nested non-blocking try/catch for persistence failures
key_files:
  created:
    - packages/dashboard/tests/scanner/branding-rewire.test.ts
  modified:
    - packages/dashboard/src/scanner/orchestrator.ts
decisions:
  - "Replaced `brandGuideline!` non-null assertions with an explicit `liveGuideline` narrowing binding (WARN-4 fix from 18-CHECK.md). Inside the `if (brandGuideline?.active && .colors && .fonts && .selectors)` narrowing block, `liveGuideline = brandGuideline` captures the alias; the projection to the `@luqen/branding` BrandGuideline shape is built from the original `brandGuideline` reference (TypeScript cannot carry property narrowings through an alias). Later references in the `matched` branch use `liveGuideline.id` / `.name` / `.version` (non-null columns), gated by an explicit `if (!liveGuideline) throw ...` invariant check rather than a `!` assertion."
  - "Degraded branch reuses `UnscorableReason: 'no-branded-issues'` since Phase 15's enum has no `'service-degraded'` literal. Documented as a known compromise in the plan's scope_clarification; Phase 16 repository round-trips any unscorable variant via subscore_details=null, so the row is recoverable. Phase 20 UI renders unscorable rows with an empty-state panel regardless of reason."
  - "Outer guard `if (this.brandingOrchestrator !== undefined && this.brandScoreRepository !== undefined)` leaves both deps optional on the constructor (unchanged from 18-02). Callers that omit the deps get the pre-18 behavior of zero branding enrichment — this keeps the existing scanner integration suite (59 tests in tests/scanner/orchestrator.test.ts) green without needing DI scaffolding for every test."
metrics:
  duration_minutes: ~11
  tasks_completed: 2
  files_touched: 2
  tests_added: 7
  tests_passing: 2484 (dashboard suite; was 2477 pre-plan, +7 new from this plan)
---

# Phase 18 Plan 03: Scanner Hot-Path Rewire Summary

**One-liner:** Replaced the inline BrandingMatcher block in `scanner/orchestrator.ts` with a single `brandingOrchestrator.matchAndScore()` call that dispatches on the Phase 17 tagged-union (`matched` / `degraded` / `no-guideline`), persisting the ScoreResult via `brandScoreRepository.insert()` for matched + degraded branches and skipping persist for no-guideline — all wrapped in nested non-blocking try/catch so scan completion is never gated on scoring persistence.

## Objective (recap)

Flip the scanner hot path from in-process matcher instantiation to the Phase 17 orchestrator. This is the first Phase 18 plan that changes scan runtime behavior. Every subsequent plan (18-04 retag rewire, 18-05 trend query, 18-06 latency gate) builds on the invariants pinned here.

## Tasks Completed

| # | Task | Commit  | Status |
|---|------|---------|--------|
| 1 | Rewire scanner branding block (delete inline, call matchAndScore + insert) | `c058975` | done |
| 2 | Invariant-pinning test suite (7 tests) | `1ea4f4b` | done |

## Exact Code Changes

### `packages/dashboard/src/scanner/orchestrator.ts`

**Imports added (2 new lines, after the 18-02 imports):**

```typescript
import type { ScoreResult } from '../services/scoring/types.js';
import type { BrandGuideline } from '@luqen/branding';
```

**Constructor markers removed** — the `void this.brandingOrchestrator; void this.brandScoreRepository;` plumbing markers from Plan 18-02 were deleted (the fields are now consumed by the runScan code path).

**Inline BrandingMatcher block deleted** — the entire block at lines 572-641 of the post-18-02 file (pre-18-03 position) was replaced. The deleted code included:
- The dynamic `const { BrandingMatcher } = await import('@luqen/branding');` import (now gone entirely from the file)
- The `new BrandingMatcher()` instantiation and `matcher.match(...)` call
- The inline projection of `brandGuideline` into the `@luqen/branding` BrandGuideline shape, coupled with matcher instantiation
- The enrichment loop that attached `brandMatch` to page issues (this loop is preserved in the new matched branch — display layer stays identical)
- The `brandRelatedCount`, `brandingGuidelineId`, `brandingGuidelineVersion`, and `reportData.branding` population

**New dispatch block added** (~180 lines) structured as:

1. **Outer guard** `if (this.brandingOrchestrator !== undefined && this.brandScoreRepository !== undefined)` — keeps both deps optional on the constructor so legacy test fixtures without DI continue to work (the scanner simply skips all branding logic).
2. **Outer try/catch** around the entire block — preserves the pre-rewire non-fatal semantics for pre-matchAndScore failures (guideline lookup throws, orchestrator throws a non-tagged error).
3. **Guideline resolution** — same `this.storage.branding.getGuidelineForSite(...)` call as the pre-rewire block. Same narrowing condition (`active && colors && fonts && selectors`).
4. **Explicit `liveGuideline` narrowing binding** — captures the narrowed record for later use in the matched branch without non-null assertions. The projection to `@luqen/branding` BrandGuideline shape is built from the original `brandGuideline` variable inside the narrowing block (TypeScript cannot carry the property narrowings through an alias, so the projection uses `brandGuideline.colors.map(...)` directly).
5. **Single `matchAndScore` call** — INVARIANT: one call per scan (Pitfall #10). Receives the projected `orchestratorGuideline` (or `null` when guideline is inactive/missing). Returns a tagged-union `MatchAndScoreResult`.
6. **Dispatch:**
   - **`result.kind === 'matched'`:** enrich `reportData.pages[*].issues` with `brandMatch` (display layer preserved), set `brandRelatedCount`, `brandingGuidelineId`, `brandingGuidelineVersion`, `reportData.branding`, then persist `result.scoreResult` via `this.brandScoreRepository.insert()` inside a nested try/catch (non-blocking). Invariant check: `if (!liveGuideline) throw ...` rather than `!` assertion.
   - **`result.kind === 'degraded'`:** construct a degraded `ScoreResult` of shape `{ kind: 'unscorable', reason: 'no-branded-issues' }`, emit a `scan_error` event with the mode/reason/error string, then persist via `this.brandScoreRepository.insert()` with `mode: result.mode`, `brandRelatedCount: 0`, `totalIssues: allIssues.length` inside a nested try/catch (non-blocking). `brandingGuidelineId` and `brandingGuidelineVersion` are populated from `brandGuideline?.id` / `?.version` (may be undefined if guideline lookup succeeded but narrowing failed).
   - **`result.kind === 'no-guideline'`** (final `else`): no persist, no enrichment. Comment documents the contract (absence of a row is the signal for "not measured"; pre-v2.11.0 scans fall into the same bucket).

**The `updateScan(...)` call at the end of runScan is UNCHANGED.** The three local variables `brandRelatedCount`, `brandingGuidelineId`, `brandingGuidelineVersion` are still populated with the same semantics, so the existing spread into `updateScan({ ..., brandRelatedCount, ... })` works without modification.

### `packages/dashboard/tests/scanner/branding-rewire.test.ts` (NEW FILE, 458 lines)

New file, separate from the existing `tests/scanner/orchestrator.test.ts`, containing 7 invariant-pinning tests under a single `describe('Phase 18 rewire invariant — scanner branding integration', ...)` block. Each test:

- Uses `vi.hoisted()` to mock `@luqen/core`, `../../src/compliance-client.js`, and `node:fs/promises` (same pattern as the existing scanner test)
- Constructs a `ScanOrchestrator` with real typed stubs for `BrandingOrchestrator` and `BrandScoreRepository` (NOT module-level mocks — the DI contract lives at the constructor, not at import time)
- Runs a single-page scan via `runScanAndWait` and inspects the terminal event + insert spy

**Fixture `setupCoreMockForSinglePage()`** — mocks `createScanner.mockReturnValue({ scan: vi.fn().mockResolvedValue(scanResult) })` with a `{ pages, summary: { pagesScanned, byLevel } }` shape. The 18-03 plan's draft of the helper mocked `discoverUrls` + `scanUrls` instead, which is wrong for the Standard (non-incremental) scan path used by `scanMode: 'single'` — the executor caught this during TDD RED (all 7 tests initially failed with `expected 'failed' to be 'complete'`) and fixed the mock to match the `.scan()` entry point pattern used by the rest of `tests/scanner/orchestrator.test.ts`.

## Verification

### Final grep counts (from scanner/orchestrator.ts)

| Invariant | Count | Expected |
|-----------|-------|----------|
| `this.brandingOrchestrator.matchAndScore` | **1** | exactly 1 (Pitfall #10) |
| `this.brandScoreRepository.insert` | **2** | exactly 2 (matched + degraded branches) |
| `BrandingMatcher` | **0** | 0 (inline class reference deleted; JSDoc mention scrubbed) |
| `await import('@luqen/branding')` | **0** | 0 (dynamic import deleted) |
| `result.kind === 'matched'` | **1** | 1 (the matched branch dispatch) |
| `result.kind === 'degraded'` | **1** | 1 (the degraded branch dispatch) |
| `totalIssues: allIssues.length` | **2** | 2 (both insert call sites) |

### Test results

- `cd packages/dashboard && npm run lint` → **exit 0** (tsc clean)
- `cd packages/dashboard && npx vitest run tests/scanner/branding-rewire.test.ts` → **7/7 passed**
- `cd packages/dashboard && npx vitest run tests/scanner/orchestrator.test.ts` → **59/59 passed** (pre-existing suite, no regression)
- `cd packages/dashboard && npx vitest run` (full dashboard suite) → **2484 passed / 40 skipped / 0 failed** (was 2477 before — +7 new tests from this plan; baseline from Phase 18-02 preserved)

### Critical test — Test 4 (degraded-still-persists)

The CRITICAL invariant asserted by Test 4:

```typescript
const brandingOrchestrator = makeMockBrandingOrchestrator({
  kind: 'degraded',
  mode: 'remote',
  reason: 'remote-unavailable',
  error: 'ECONNREFUSED 127.0.0.1:4100',
});
// ...
const terminal = await runScanAndWait(orchestrator, 'scan-04');

expect(terminal.type).toBe('complete');                        // scan still completes
expect(brandScoreRepository.insert).toHaveBeenCalledTimes(1);  // row STILL written
const [writtenResult, writtenContext] = (
  brandScoreRepository.insert as ReturnType<typeof vi.fn>
).mock.calls[0];
expect(writtenResult.kind).toBe('unscorable');   // with unscorable variant
expect(writtenContext.mode).toBe('remote');       // mode tag preserved
expect(writtenContext.brandRelatedCount).toBe(0); // zero matches recorded
expect(writtenContext.scanId).toBe('scan-04');    // correct scan id
```

This pins the BSTORE-02 + Phase 17 unified result contract: a remote outage is **recorded** as a degraded row, not erased. The trend query in Plan 18-05 will render this as a dashed segment rather than a gap.

### Plan 18-04 isolation

`packages/dashboard/src/services/branding-retag.ts` is UNTOUCHED by this plan. The retag rewire is Plan 18-04's job. Verified via `git diff master~2 HEAD -- packages/dashboard/src/services/branding-retag.ts` → empty.

## Deviations from Plan

**One executor-side deviation (Rule 1 - Bug): test helper mock pattern corrected.**

The plan's draft of `setupCoreMockForSinglePage()` mocked `mockDiscoverUrls.mockResolvedValue(...)` + `mockScanUrls.mockResolvedValue(...)` and set `mockCreateScanner.mockReturnValue({})`. This is the correct mock pattern for the **incremental** scan path (`config.incremental === true && scanMode === 'site'`), which calls `discoverUrls + scanUrls` directly. But `BASE_CONFIG` uses `scanMode: 'single'`, which goes through the **Standard (non-incremental)** branch at `scanner/orchestrator.ts:428-481`, where the scanner is built via `const scanner = createScanner(...)` and its `scanner.scan(url)` method is called — matching the canonical pattern at `tests/scanner/orchestrator.test.ts:468` (`const mockScanner = { scan: vi.fn().mockResolvedValue(scanResult) }; mockCreateScanner.mockReturnValue(mockScanner);`).

The plan's helper returned `{}` from `createScanner`, so `scanner.scan(url)` threw `TypeError: scanner.scan is not a function`, which surfaced as terminal event `'failed'`. TDD-RED caught this on first run — all 7 tests failed with `expected 'failed' to be 'complete'` or `expected 1 calls, got 0`. The fix: `mockCreateScanner.mockReturnValue({ scan: vi.fn().mockResolvedValue(scanResult) })` with a `scanResult = { pages: [...], summary: { pagesScanned: 1, byLevel: { error: 1, warning: 0, notice: 0 } } }` shape matching `makeScanResult()` from the existing scanner test. The `discoverUrls` + `scanUrls` + `computeContentHashes` mocks are kept for belt-and-braces (in case a future test inside this file flips `scanMode` to `'site'`).

Tracked as `[Rule 1 - Bug] Fixed setupCoreMockForSinglePage to mock createScanner().scan() for standard single-mode path`. No plan rewrite — this is a test-helper-only fix internal to the new test file.

**One executor-side deviation (Rule 1 - Bug): TypeScript narrowing through liveGuideline alias.**

The plan's action block specified using `liveGuideline.colors.map(...)`, `liveGuideline.fonts.map(...)`, `liveGuideline.selectors.map(...)` inside the projection to `@luqen/branding` BrandGuideline shape. TypeScript lost the property-level narrowing (`brandGuideline.colors &&` etc.) when passing through the `liveGuideline = brandGuideline` alias, because `NonNullable<typeof brandGuideline>` only removes the top-level `undefined` — it does not narrow `colors?: ... | undefined` to `colors: ...`. Lint failed with:

```
src/scanner/orchestrator.ts(611,23): error TS18048: 'liveGuideline.colors' is possibly 'undefined'.
src/scanner/orchestrator.ts(618,22): error TS18048: 'liveGuideline.fonts' is possibly 'undefined'.
src/scanner/orchestrator.ts(625,26): error TS18048: 'liveGuideline.selectors' is possibly 'undefined'.
```

Fix: inside the narrowing `if` block, use `brandGuideline.colors.map(...)` / `.fonts.map(...)` / `.selectors.map(...)` directly (the narrowing holds on the original variable), while still keeping `liveGuideline = brandGuideline` as the alias for later references in the matched branch (which use `.id`, `.name`, `.version` — unconditionally non-null). The explicit narrowing binding still delivers the WARN-4 fix (no `!` assertions anywhere, explicit `if (!liveGuideline) throw ...` invariant check in the matched branch).

Tracked as `[Rule 1 - Bug] Fix TypeScript property-level narrowing in guideline projection — use brandGuideline.X directly inside the narrowing block; keep liveGuideline alias only for post-matched-dispatch .id/.name/.version references`.

**Also scrubbed two `BrandingMatcher` references in JSDoc/comments** (not deviations — grep acceptance requires 0 matches; both references were documentation of "the former inline block" which was scrubbed to "the former inline branding enrichment block").

## Handoff to Plan 18-04

**Ready state:**
- Scanner runtime behavior flipped: `brandingOrchestrator.matchAndScore` is the entry point; `brandScoreRepository.insert` is the persistence path.
- `branding-retag.ts` is still the 3-arg legacy shape (not yet flipped to 5-arg signature) — Plan 18-04's job.
- Plan 18-04 and 18-03 are both in Wave 2 with `depends_on: [18-02]`. No file overlap: 18-03 touches `scanner/orchestrator.ts` + `tests/scanner/branding-rewire.test.ts`; 18-04 will touch `services/branding-retag.ts` + `tests/services/branding-retag-rewire.test.ts` + 13 caller files per BLOCKER-1 fix.
- The 7 invariant-pinning tests in `branding-rewire.test.ts` establish the pattern for 18-04's `tests/services/branding-retag-rewire.test.ts`: separate invariant file with `describe('Phase 18 rewire invariant — ...')`, vi.hoisted mocks for external IO, real typed stubs for the DI contract.

**Latency note for Plan 18-06:**
The rewire adds ONE function call (`matchAndScore`) and ONE DB insert per scan vs the pre-rewire two-object-allocation + one-match-call pattern. Net new work is bounded: the orchestrator's internal `matchAndScore` also calls `matcher.match` exactly once (Phase 17 orchestrator is a thin dispatcher, not a separate matcher invocation). Plan 18-06 will compare this post-rewire measurement against Plan 18-01's 14951 ms grand-median baseline using the binding `<15% regression` gate.

## Self-Check: PASSED

Files verified:
- `packages/dashboard/src/scanner/orchestrator.ts` — FOUND
- `packages/dashboard/tests/scanner/branding-rewire.test.ts` — FOUND
- `.planning/phases/18-scanner-wire-up/18-03-SUMMARY.md` — FOUND (this file)

Commits verified:
- `c058975` — refactor(18-03): replace inline BrandingMatcher with orchestrator dispatch — FOUND
- `1ea4f4b` — test(18-03): invariant-pinning suite for scanner rewire — FOUND

All acceptance criteria in PLAN.md satisfied:
- Scanner calls `this.brandingOrchestrator.matchAndScore` exactly 1 time per scan
- Scanner calls `this.brandScoreRepository.insert` exactly 2 times (matched + degraded branches)
- `BrandingMatcher` reference count: 0 (class reference + JSDoc both deleted)
- `await import('@luqen/branding')` reference count: 0 (dynamic import deleted)
- 7 invariant-pinning tests all passing (including Test 4 CRITICAL degraded-still-persists)
- Full dashboard test suite green: 2484 passed / 40 skipped / 0 failed (no regression)
- Lint clean
- `branding-retag.ts` untouched (Plan 18-04's job)
