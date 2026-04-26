---
phase: 17-branding-orchestrator
plan: 02
subsystem: dashboard/services/branding
tags: [branding, adapter, remote, type-guard, wave-2]
requires:
  - phase-17-01 # BrandingAdapter interface + BrandingMatchContext
  - "@luqen/branding BrandedIssue, BrandGuideline, MatchableIssue, BrandMatchResult, MatchStrategy"
  - "BrandingService (dormant since v2.7.0 — first consumer lands in Plan 17-03)"
provides:
  - RemoteBrandingAdapter class — second BrandingAdapter implementation, HTTP-backed
  - RemoteBrandingMalformedError class — typed shape-violation error with row index
  - isMatchableIssue type guard — runtime validation of the loose BrandedIssueResponse.issue field
  - Vitest suite proving request shape, response translation, malformed throws, network-error propagation, no-fallback invariant
affects:
  - Phase 17-03 (BrandingOrchestrator injects both adapters and branches on branding_mode)
  - Phase 18 (scanner rewire — orchestrator consumes the unified BrandingAdapter contract)
tech-stack:
  added: []
  patterns:
    - Adapter pattern (interface + two concrete implementations — embedded + remote)
    - Runtime type guards at external trust boundaries (never silent casts)
    - Explicit discriminated-union validation (BrandMatch matched=true requires full field set)
    - Dependency injection (constructor-injected BrandingService, zero module singletons)
key-files:
  created:
    - path: packages/dashboard/src/services/branding/remote-branding-adapter.ts
      lines: 143
      role: RemoteBrandingAdapter class + RemoteBrandingMalformedError + isMatchableIssue guard + translateBrandMatch/translateResponse helpers
    - path: packages/dashboard/tests/services/branding/remote-branding-adapter.test.ts
      lines: 225
      role: 10-case vitest suite pinning request shape, round-trip translation, 4 malformed-shape throws, network error propagation, empty array passthrough, no-fallback assertion, indexed error
  modified: []
decisions:
  - Constructor-injected BrandingService (not a registry getter, not a module singleton). Plan 17-03 will instantiate the adapter as `new RemoteBrandingAdapter(new BrandingService(config, () => registry.getBrandingTokenManager()))`. The adapter itself depends only on the BrandingService public API, which is what makes test isolation trivial — the test uses `{ matchIssues } as unknown as BrandingService` as the mock.
  - Type guard throws, never coerces. `isMatchableIssue` validates all 5 required fields plus the `type` literal set; `translateBrandMatch` validates the discriminated union (matched=true requires `strategy` in `{color-pair, font, selector}` plus all three branded fields as strings). Any deviation throws `RemoteBrandingMalformedError` with the row index. This is the second line of defense after OAuth authentication — a malicious or drifted branding service cannot feed unsound values into Phase 15's scoring.
  - Network errors propagate UNCHANGED. Test 7 pins this: a `new Error('ECONNREFUSED 127.0.0.1:4300')` from the mock matchIssues surfaces as the same error message through the adapter, and `rejects.not.toBeInstanceOf(RemoteBrandingMalformedError)`. The orchestrator (Plan 17-03) is the single catch point for both shape errors AND network errors — it tags the scan as `degraded` with different reasons but both paths lead to the same "scan completes, branding data absent" outcome.
  - Local guideline argument ignored on the remote path. The `BrandingAdapter.matchForSite` signature takes a `BrandGuideline` because the embedded adapter needs it. The remote adapter has an `_guideline` parameter prefixed with underscore to silence the unused-arg warning — the remote `/api/v1/guidelines/match-issues` endpoint resolves the guideline server-side from `siteUrl + orgId`, which is authoritative for service-mode orgs. Documented inline.
  - ServiceClientRegistry is UNCHANGED. No import, no method call, no modification. Verified by `grep -c service-client-registry remote-branding-adapter.ts = 0`. The registry's `getBrandingTokenManager()` getter will be called exactly once in Plan 17-03's server.ts wiring, not from inside this adapter.
metrics:
  duration: "2m 11s"
  completed: 2026-04-11
  tasks: 2
  commits: 2
  tests_added: 10
  tests_passing: "10/10"
  regression_suite: "2465 passed / 40 skipped / 0 failed"
---

# Phase 17 Plan 02: RemoteBrandingAdapter Summary

**One-liner:** RemoteBrandingAdapter — second `BrandingAdapter` implementation wrapping the dormant `BrandingService` with a runtime type guard (`isMatchableIssue`), a discriminated-union validator for `BrandMatch`, and a typed `RemoteBrandingMalformedError` thrown at the translation boundary; 10-test vitest suite pins happy-path translation, four malformed-shape throws, network error propagation (unchanged), empty array passthrough, and the no-fallback invariant — zero modifications to `ServiceClientRegistry`.

## What Was Built

### File 1: `packages/dashboard/src/services/branding/remote-branding-adapter.ts` (143 lines)

Three exported symbols plus two private helpers:

1. **`RemoteBrandingAdapter` class** — implements `BrandingAdapter`. Constructor takes a single `BrandingService` instance. `matchForSite(issues, _guideline, context)` casts `issues` through `unknown[]` to match the loose `BrandingService.matchIssues` signature, delegates, then funnels the response through `translateResponse`. The `_guideline` argument is intentionally ignored — the remote branding service resolves the guideline authoritatively from `siteUrl + orgId`.

2. **`RemoteBrandingMalformedError` class** — extends `Error`, carries a numeric `index` field pointing to the offending row. Message format: `"RemoteBrandingMalformedError at issue index N: <reason>"`. The orchestrator (Plan 17-03) will catch this and tag the scan as `degraded` with reason `remote-malformed`.

3. **`isMatchableIssue` type guard** — returns `value is MatchableIssue`. Validates:
   - `value !== null && typeof value === 'object'`
   - `code` is `string`
   - `type` is `string` AND in `VALID_ISSUE_TYPES` (`'error' | 'warning' | 'notice'`)
   - `message`, `selector`, `context` are all `string`

4. **`translateBrandMatch` private helper** — passthrough for `matched === false`; for `matched === true` requires `strategy` in `VALID_STRATEGIES` (`'color-pair' | 'font' | 'selector'`) plus all three branded fields as `string`, else throws `RemoteBrandingMalformedError` with the caller-supplied index.

5. **`translateResponse` private helper** — iterates the `BrandedIssueResponse[]`; for each row runs `isMatchableIssue` on `r.issue` (throws on failure with a JSON-truncated debug string), then `translateBrandMatch` on `r.brandMatch`, then constructs the strict `BrandedIssue`.

### File 2: `packages/dashboard/tests/services/branding/remote-branding-adapter.test.ts` (225 lines)

Vitest suite with the same Aperol-brand fixture shape as the Plan 17-01 suite for parallel structure. Mock `BrandingService` constructed as `{ matchIssues: vi.fn(...) } as unknown as BrandingService` — full isolation, zero network.

**Ten tests, all passing:**

| # | Pin |
|---|---|
| 1 | `matchIssues` is called exactly once with `(issues, 'https://aperol.example.com', 'org-aperol')` — proves request plumbing |
| 2 | Happy path: well-formed response containing one `matched=true` (color-pair) row and one `matched=false` row round-trips to deeply-equal typed `BrandedIssue[]`; `result[0].brandMatch.strategy === 'color-pair'`, `result[1].brandMatch.matched === false` |
| 3 | Missing `code` field → `RemoteBrandingMalformedError` |
| 4 | `type: 'critical'` (outside the literal set) → `RemoteBrandingMalformedError` |
| 5 | `matched: true` but `strategy` field absent → `RemoteBrandingMalformedError` |
| 6 | `matched: true, strategy: 'wildcard'` (outside `{color-pair, font, selector}`) → `RemoteBrandingMalformedError` |
| 7 | Mock `matchIssues` throws `new Error('ECONNREFUSED 127.0.0.1:4300')` → adapter rejects with the same message AND `rejects.not.toBeInstanceOf(RemoteBrandingMalformedError)` — proves network errors are UNWRAPPED |
| 8 | Empty `[]` response → empty `[]` result (legitimate no-matches, not an error) |
| 9 | Mock with `matchIssues` + `listGuidelines` + `getGuideline` + `getGuidelineForSite`; adapter calls ONLY `matchIssues`, zero calls to the other three — proves no embedded fallback path inside the class |
| 10 | 3-row response where rows 0-1 are well-formed and row 2 is malformed; thrown error has `.index === 2` AND message contains `'index 2'` — proves the iterator stops at the first offending row and reports its position |

## What This Unlocks for Downstream Plans

**Plan 17-03 (BrandingOrchestrator)** now has both concrete implementations of the `BrandingAdapter` contract on disk:

- `EmbeddedBrandingAdapter` from Plan 17-01 for `branding_mode='embedded'` orgs
- `RemoteBrandingAdapter` from Plan 17-02 for `branding_mode='remote'` orgs

The orchestrator will:
1. Take both adapters via constructor (`new BrandingOrchestrator({ embedded, remote, orgRepository })`)
2. On each call, consult `orgRepository.getBrandingMode(orgId)` from Phase 16-03
3. Route to the matching adapter
4. Catch `RemoteBrandingMalformedError` (this plan) OR generic `Error` (network) from the remote path and tag the scan as `degraded`
5. Never call an adapter it did not construct with — the `BrandingAdapter` interface is the only abstract dependency

The exact constructor signature Plan 17-03 will consume:
```typescript
new RemoteBrandingAdapter(new BrandingService(config, () => registry.getBrandingTokenManager()))
```

The exact error type Plan 17-03 will catch:
```typescript
import { RemoteBrandingMalformedError } from './remote-branding-adapter.js';

try {
  return await this.remote.matchForSite(issues, guideline, context);
} catch (err) {
  if (err instanceof RemoteBrandingMalformedError) {
    // degraded reason: 'remote-malformed' — tag with err.index for diagnostics
  } else {
    // degraded reason: 'remote-unreachable' — network / OAuth / HTTP 5xx
  }
}
```

## ServiceClientRegistry Integrity

**`packages/dashboard/src/services/service-client-registry.ts` was NOT modified in this plan.** Verified by `git diff master...HEAD -- packages/dashboard/src/services/service-client-registry.ts` returning empty. The registry's `getBrandingTokenManager()` getter is the only call site Plan 17-03 will touch, and that call site is read-only.

`grep -c "service-client-registry" packages/dashboard/src/services/branding/remote-branding-adapter.ts` returns **0** — the adapter has zero imports and zero references to the registry.

## Verification

| Check | Result |
|---|---|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | Clean, 0 errors |
| `cd packages/dashboard && npx vitest run tests/services/branding/remote-branding-adapter.test.ts` | 10/10 passing (189ms) |
| `cd packages/dashboard && npx vitest run tests/services/branding/` (both adapter files) | 16/16 passing (17-01 + 17-02 combined, 430ms) |
| `cd packages/dashboard && npx vitest run` (full dashboard suite) | 2465 passed / 40 skipped / 0 failed (151 files, 155.58s). Baseline after 17-01 was 2455 passing → +10 from this plan, exact match. |
| `git diff master...HEAD -- packages/dashboard/src/services/service-client-registry.ts \| wc -l` | 0 (file untouched) |
| `grep -c "service-client-registry" packages/dashboard/src/services/branding/remote-branding-adapter.ts` | 0 (zero registry refs) |
| `grep -c "export class RemoteBrandingAdapter" remote-branding-adapter.ts` | 1 |
| `grep -c "implements BrandingAdapter" remote-branding-adapter.ts` | 1 |
| `grep -c "export class RemoteBrandingMalformedError" remote-branding-adapter.ts` | 1 |
| `grep -c "function isMatchableIssue" remote-branding-adapter.ts` | 1 |
| `grep -c "this.brandingService.matchIssues" remote-branding-adapter.ts` | 1 |
| `grep -c "VALID_ISSUE_TYPES" remote-branding-adapter.ts` | 2 (declaration + use) |
| `grep -c "describe('RemoteBrandingAdapter" remote-branding-adapter.test.ts` | 1 |
| `grep -c "RemoteBrandingMalformedError" remote-branding-adapter.test.ts` | 13 (import + 12 assertions/instance checks across malformed/indexed/network tests) |

## Deviations from Plan

### Minor — documented, no fix needed

**1. [Rule 3 — Plan self-contradiction] `grep -ic "embedded"` acceptance criterion**

- **Found during:** Task 1 post-write verification
- **Issue:** The plan's `<verification>` block says `grep -ic "embedded" remote-branding-adapter.ts returns 1 only (in the JSDoc explaining we never call it)` — but the verbatim source content the plan prescribes for Task 1 contains TWO occurrences of the word `embedded`:
  - Line 15 (class-level JSDoc): `"We never call the embedded matcher from inside this class"`
  - Line 129 (inline comment on the `_guideline` parameter): `"the embedded adapter NEEDS it; the remote adapter ignores it"`
- **Fix:** None applied. Both occurrences are in documentation comments — the semantic intent of the acceptance criterion ("NO actual call to EmbeddedBrandingAdapter from this file") is verifiably honored. Modifying the verbatim content the plan prescribed would be a larger deviation than the grep mismatch. The executor prompt's own `<success_criteria>` did NOT restate the "embedded returns 1" grep — it only pinned `service-client-registry returns 0`, which is satisfied.
- **Files modified:** None
- **Commit:** None (no code change)

**2. [Rule 3 — TDD ordering] Task 2 marked `tdd="true"` but the implementation is already on disk from Task 1**

- **Found during:** Task 2 start
- **Issue:** Task 2 is marked `tdd="true"` in the plan, but Task 1 creates the full production implementation first. The "RED → GREEN" cycle is not mechanically possible in this order — the tests would pass on their first execution (GREEN) rather than failing (RED) because the code they exercise already exists.
- **Fix:** Wrote the test file verbatim per plan, ran it once (10/10 passing immediately), committed as `test(17-02): ...`. The contract TDD principle is satisfied semantically — the tests pin the exact behavior the plan specified, and any future regression would fail the suite. The RED→GREEN cycle was effectively inverted: the production code's shape was locked by Task 1's verbatim prescription BEFORE Task 2 was written, so Task 2 acts as an acceptance suite rather than a driver.
- **Files modified:** None (Task 2 proceeded verbatim)
- **Commit:** `cd6c314` (Task 2 as planned)

No other deviations. Plan otherwise executed verbatim.

## Authentication Gates

None. Pure in-process work with fully-mocked `BrandingService` — no network, no secrets, no OAuth tokens exchanged at test time. Plan 17-03 will be the first plan in this phase to actually wire the real `BrandingService` to a live `ServiceTokenManager`, and that's where any auth gating will surface.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 | `e3be82e` | `feat(17-02): add RemoteBrandingAdapter wrapping BrandingService` |
| 2 | `cd6c314` | `test(17-02): 10-case suite for RemoteBrandingAdapter translation boundary` |

## Self-Check: PASSED

Files verified to exist:
- FOUND: `packages/dashboard/src/services/branding/remote-branding-adapter.ts`
- FOUND: `packages/dashboard/tests/services/branding/remote-branding-adapter.test.ts`

Commits verified in `git log`:
- FOUND: `e3be82e`
- FOUND: `cd6c314`

All 5 plan `must_haves.truths` honored:
- RemoteBrandingAdapter implements `BrandingAdapter` and returns `readonly BrandedIssue[]` — YES (`grep -c "implements BrandingAdapter" = 1`)
- Takes `BrandingService` as constructor-injected dependency — YES (`constructor(private readonly brandingService: BrandingService) {}`)
- Delegates to `brandingService.matchIssues` and translates via runtime validation, not silent cast — YES (`translateResponse` + `isMatchableIssue` + `translateBrandMatch`)
- Runtime validation throws `RemoteBrandingMalformedError` on shape violations — YES (tests 3, 4, 5, 6, 10 all pass)
- Network errors propagate as-is, NOT swallowed — YES (test 7 passes: `rejects.toThrow('ECONNREFUSED 127.0.0.1:4300')` AND `rejects.not.toBeInstanceOf(RemoteBrandingMalformedError)`)
- `ServiceClientRegistry` NOT touched — YES (`git diff master...HEAD -- service-client-registry.ts` empty, `grep service-client-registry = 0`)

All 3 plan `must_haves.key_links` honored:
- `remote-branding-adapter.ts → BrandingService.matchIssues` via pattern `this\.brandingService\.matchIssues` — YES (grep count 1)
- `remote-branding-adapter.ts → branding-adapter.ts BrandingAdapter interface` via `implements BrandingAdapter` — YES (grep count 1)
- `remote-branding-adapter.ts response handler → MatchableIssue type guard` via `isMatchableIssue` — YES (called on every row in `translateResponse`)

All phase-level success criteria in the executor prompt honored:
- Both tasks executed verbatim per plan — YES
- `npm run lint` exits 0 — YES
- 10/10 tests pass — YES
- Tests include happy path, multiple malformed variants, network-error propagation — YES
- `grep service-client-registry = 0` — YES
- Each task committed atomically — YES
- `SUMMARY.md` created — YES (this file)
- Smoke regression: `tests/services/branding/` — 16/16 passing (17-01 + 17-02 combined) — YES
- Full dashboard suite: 2465/2505 — YES (baseline 2455 + 10 new = 2465, exact match)
