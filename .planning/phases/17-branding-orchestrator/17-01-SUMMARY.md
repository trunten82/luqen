---
phase: 17-branding-orchestrator
plan: 01
subsystem: dashboard/services/branding
tags: [branding, adapter, interface, refactor, wave-1]
requires:
  - phase-16-03 # OrgRepository.getBrandingMode (for Plan 17-03 consumer)
  - "@luqen/branding BrandingMatcher + types (BrandedIssue, BrandGuideline, MatchableIssue)"
provides:
  - BrandingAdapter interface — the dual-mode contract both adapters satisfy
  - BrandingMatchContext type — per-call routing shape (orgId, siteUrl, scanId)
  - EmbeddedBrandingAdapter class — in-process BrandingMatcher behind the contract
  - Vitest contract suite proving adapter output equals direct BrandingMatcher.match()
affects:
  - Phase 17-02 (RemoteBrandingAdapter will implement the same interface)
  - Phase 17-03 (BrandingOrchestrator will depend on both adapters via this contract)
  - Phase 18 (scanner/orchestrator.ts rewire will call EmbeddedBrandingAdapter instead of the inline block at lines 541-594)
tech-stack:
  added: []
  patterns:
    - Adapter pattern (interface + two concrete implementations, one per phase)
    - Dependency injection (orchestrator receives both adapters, no module-level singletons)
    - Static import over dynamic import (bundler/typechecker visibility + test mockability)
key-files:
  created:
    - path: packages/dashboard/src/services/branding/branding-adapter.ts
      lines: 51
      role: BrandingAdapter interface + BrandingMatchContext shape
    - path: packages/dashboard/src/services/branding/embedded-branding-adapter.ts
      lines: 50
      role: EmbeddedBrandingAdapter class wrapping @luqen/branding BrandingMatcher
    - path: packages/dashboard/tests/services/branding/embedded-branding-adapter.test.ts
      lines: 116
      role: 6-test contract suite proving behavior preservation vs the inline path
  modified: []
decisions:
  - Static import of BrandingMatcher replaces the dynamic `await import()` used at scanner/orchestrator.ts:553 — gives bundler/typechecker visibility, enables trivial test mocking, removes per-scan dynamic-import overhead.
  - Adapter does NOT encapsulate the dashboard-record → BrandGuideline projection (lines 555-576 of the inline path). Projection is the caller's responsibility (Phase 18 rewire). Keeping I/O out of the adapter is what makes it testable in isolation and reusable by the orchestrator in Plan 17-03.
  - Adapter THROWS on failure — the orchestrator (Plan 17-03) catches and tags `degraded`. The inline path swallowed errors as "non-fatal" and returned empty; the new contract uses empty to mean "matched zero" and exceptions to mean "failed".
  - No caching at the adapter layer — honoring the PROJECT.md invariant end-to-end. Every call constructs fresh results.
metrics:
  duration: "6m 19s"
  completed: 2026-04-11
  tasks: 3
  commits: 3
  tests_added: 6
  tests_passing: "6/6"
  regression_suite: "2455 passed / 40 skipped / 0 failed"
---

# Phase 17 Plan 01: BrandingAdapter + EmbeddedBrandingAdapter Summary

**One-liner:** BrandingAdapter interface and EmbeddedBrandingAdapter class — a mechanical, static-import refactor of the inline branding matcher path at `scanner/orchestrator.ts:541-594`, with a 6-test contract suite proving byte-identical output to `new BrandingMatcher().match()` and zero modifications to the scanner itself.

## What Was Built

### File 1: `packages/dashboard/src/services/branding/branding-adapter.ts` (51 lines)

Defines two types:

- `BrandingMatchContext` — `{ orgId, siteUrl, scanId }` passed to every call. Embedded adapter uses it for logging; remote adapter forwards `orgId` as `X-Org-Id` header; `scanId` lets the Plan 17-03 orchestrator tag degraded results without a second lookup.
- `BrandingAdapter` — single-method interface:
  ```typescript
  matchForSite(
    issues: readonly MatchableIssue[],
    guideline: BrandGuideline,
    context: BrandingMatchContext,
  ): Promise<readonly BrandedIssue[]>;
  ```
  Both Phase 17 adapters (embedded and remote) return the **same** `readonly BrandedIssue[]` shape. Plan 17-03's orchestrator never branches on which adapter ran — the interface IS the boundary.

### File 2: `packages/dashboard/src/services/branding/embedded-branding-adapter.ts` (50 lines)

Wraps `BrandingMatcher` from `@luqen/branding` behind the `BrandingAdapter` contract. Three key differences from the inline path at `scanner/orchestrator.ts:541-594`:

1. **Static import** of `BrandingMatcher` (was per-call dynamic `import()`). Bundler/typechecker now see the dependency, tests can mock trivially, no per-scan dynamic-import overhead.
2. **No I/O.** The inline path called `storage.branding.getGuidelineForSite(...)` before matching. This adapter takes a pre-resolved `BrandGuideline` — keeping I/O out is what makes it independently testable and reusable by the orchestrator.
3. **Throws on failure.** The inline path swallowed errors as "non-fatal" and returned empty. The new contract: empty means "matched zero", exception means "failed".

Constructor instantiates one `BrandingMatcher`; `matchForSite` delegates to `this.matcher.match(issues, guideline)` and returns the result via the async interface signature (which the remote adapter will need).

### File 3: `packages/dashboard/tests/services/branding/embedded-branding-adapter.test.ts` (116 lines)

Vitest suite with a realistic Aperol-brand fixture:

- `FIXTURE_GUIDELINE` — 2 colors (Aperol Orange `#FF6900`, Aperol Cream `#FFF6E5`), 1 font (Helvetica Neue), 1 selector (`.btn-primary`)
- `FIXTURE_ISSUES` — 3 issues mirroring the shape the scanner produces:
  - WCAG2AA 1.4.3 contrast failure on `.hero-cta` whose inline style uses the Aperol hex values
  - WCAG2AA 1.4.4 text-resize warning on `body` styled `font-family: Helvetica Neue`
  - WCAG2AA 2.4.4 anchor-no-text notice on `.btn-primary`

Six tests, all passing:

1. **Contract test (the load-bearing one):** `expect(viaAdapter).toEqual(direct)` where `direct = new BrandingMatcher().match(FIXTURE_ISSUES, FIXTURE_GUIDELINE)`. Proves the adapter is a transparent wrapper. This is what gives Phase 18 confidence it can delete the inline block and call `embeddedAdapter.matchForSite(...)` with zero behavior change.
2. Empty issues list → empty array (no throw).
3. Guideline with zero colors/fonts/selectors → all `brandMatch.matched === false` (BrandingMatcher behavior, adapter does not filter).
4. `BrandedIssue.issue` references the original issue shapes (code, selector, context preserved).
5. `matchForSite` returns a `Promise` (interface contract requires async).
6. Errors propagate — a subclass that throws triggers `rejects.toThrow`, proving the adapter does NOT swallow. Backs up the documented contract that exceptions mean "failed", empty means "matched zero".

## What This Unlocks for Downstream Plans

- **Plan 17-02** (RemoteBrandingAdapter) — must declare `implements BrandingAdapter` and return the same `readonly BrandedIssue[]` shape. The interface signature is locked.
- **Plan 17-03** (BrandingOrchestrator) — will inject both adapters via constructor and pick one based on `this.orgRepository.getBrandingMode(orgId)`. The `BrandingMatchContext` shape defined here is what the orchestrator will construct from its input envelope.
- **Phase 18** (scanner rewire) — will replace lines 541-594 of `scanner/orchestrator.ts` with a single call to `brandingOrchestrator.matchAndScore(...)`. The contract test in this plan is the safety net: if Phase 18 later finds a difference in output, the test fixture can be extended rather than rediscovering the requirement from scratch.

## Scanner Integrity

**`packages/dashboard/src/scanner/orchestrator.ts` was NOT modified in this plan.** Verified via `git diff packages/dashboard/src/scanner/orchestrator.ts` returning empty. That rewire belongs to Phase 18 and depends on Plan 17-03's orchestrator being in place first.

## Verification

| Check | Result |
|---|---|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | Clean, 0 errors |
| `cd packages/dashboard && npx vitest run tests/services/branding/embedded-branding-adapter.test.ts` | 6/6 passing |
| `cd packages/dashboard && npx vitest run` (full dashboard suite) | 2455 passed / 40 skipped / 0 failed |
| `git diff packages/dashboard/src/scanner/orchestrator.ts` | Empty (file untouched) |
| `grep -rc "await import" packages/dashboard/src/services/branding/` | 0 (no dynamic imports) |
| `grep -rn "scanner/orchestrator.ts" packages/dashboard/src/services/branding/` | No matches (adapter does not reference the scanner) |
| `grep -c "export interface BrandingAdapter" branding-adapter.ts` | 1 |
| `grep -c "export interface BrandingMatchContext" branding-adapter.ts` | 1 |
| `grep -c "export class EmbeddedBrandingAdapter" embedded-branding-adapter.ts` | 1 |
| `grep -c "implements BrandingAdapter" embedded-branding-adapter.ts` | 1 |
| `grep -c "^import { BrandingMatcher } from '@luqen/branding'" embedded-branding-adapter.ts` | 1 (static) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan self-contradiction between "exact content" and `grep "await import"` acceptance**

- **Found during:** Task 2 post-write verification
- **Issue:** Task 2's plan prescribed JSDoc text containing the literal string ``(was dynamic `await import(...)`)`` while Task 2's own acceptance criterion (and the phase-level success criterion in the executor prompt) required `grep -c "await import" embedded-branding-adapter.ts` to return `0`. The two requirements are mutually exclusive as written.
- **Fix:** Rewrote the JSDoc line to say `(was a per-call dynamic import() in the inline path)` — preserves the full semantic content (static replaces dynamic, reason explained) without the literal "await import" keyword pair that the grep pins. No behavior change; comment only.
- **Files modified:** `packages/dashboard/src/services/branding/embedded-branding-adapter.ts` (JSDoc lines 10-13)
- **Commit:** `14cedf0` (bundled into the Task 3 commit since it's a single-line doc tweak and Task 2 was already committed at `bdaa1be`)

No other deviations. Plan otherwise executed verbatim.

## Authentication Gates

None. Pure foundation work, no network, no secrets, no infrastructure.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 | `9346268` | `feat(17-01): add BrandingAdapter interface for dual-mode contract` |
| 2 | `bdaa1be` | `feat(17-01): add EmbeddedBrandingAdapter wrapping in-process BrandingMatcher` |
| 3 | `14cedf0` | `test(17-01): contract test proving adapter output equals direct matcher` |

## Self-Check: PASSED

Files verified to exist:
- FOUND: `packages/dashboard/src/services/branding/branding-adapter.ts`
- FOUND: `packages/dashboard/src/services/branding/embedded-branding-adapter.ts`
- FOUND: `packages/dashboard/tests/services/branding/embedded-branding-adapter.test.ts`

Commits verified to exist in `git log`:
- FOUND: `9346268`
- FOUND: `bdaa1be`
- FOUND: `14cedf0`

All 5 plan `must_haves.truths` honored:
- BrandingAdapter interface exists with a single typed method taking `(issues, guideline, context)` and returning `Promise<readonly BrandedIssue[]>` — YES
- EmbeddedBrandingAdapter implements `BrandingAdapter` and statically imports `BrandingMatcher` from `@luqen/branding` — YES
- EmbeddedBrandingAdapter output IDENTICAL to the inline path (proven by `toEqual` contract test) — YES
- `scanner/orchestrator.ts` NOT modified — YES (`git diff` empty)
- Both adapters return the same `readonly BrandedIssue[]` shape (the contract is the BrandingAdapter interface alone) — YES (only one adapter so far; shape is locked at the interface level for Plan 17-02)
