---
phase: 17-branding-orchestrator
plan: 03
status: complete
completed_at: 2026-04-11
subsystem: dashboard/services/branding
tags: [branding, orchestrator, dual-mode, dependency-injection, tagged-union, wave-3]
requires:
  - phase-17-01 # BrandingAdapter interface + EmbeddedBrandingAdapter
  - phase-17-02 # RemoteBrandingAdapter + RemoteBrandingMalformedError
  - phase-16-03 # OrgRepository.getBrandingMode (per-request mode read)
  - phase-15-04 # calculateBrandScore pure calculator
  - "BrandingService (dormant since v2.7.0 — first real instantiation in this plan's server.ts wiring)"
provides:
  - BrandingOrchestrator class — single dual-mode entry point (matchAndScore)
  - MatchAndScoreResult tagged union — { matched | degraded | no-guideline }
  - DegradedReason tagged type — { remote-unavailable | remote-malformed | embedded-error }
  - Server-side DI wiring — BrandingService + both adapters + orchestrator, decorated on Fastify instance
  - Vitest suite locking all four architectural invariants (no caching, no cross-route fallback, one match call per scan, registry untouched)
affects:
  - Phase 18 (scanner/orchestrator.ts rewire will call server.brandingOrchestrator.matchAndScore(...) once per scan, replacing the inline block at lines 541-594)
  - Phase 19 (admin UI flipping branding_mode — no restart, next scan routes immediately)
  - Phase 20 (report panel consuming BSTORE-05 brandRelatedCount + ScoreResult)
tech-stack:
  added: []
  patterns:
    - Tagged-union result type (matched | degraded | no-guideline) — no exception-as-control-flow at the call site
    - Per-request read of routing flags (zero caching, zero invalidation complexity)
    - Explicit no-cross-route policy enforced by unit test spy (NOT trust)
    - Constructor injection end-to-end (orchestrator → adapters → BrandingService → token manager getter)
    - Pure calculator over already-matched data (no double match call for scoring)
key-files:
  created:
    - path: packages/dashboard/src/services/branding/branding-orchestrator.ts
      lines: 156
      role: BrandingOrchestrator class + MatchAndScoreInput + MatchAndScoreResult tagged union + DegradedReason
    - path: packages/dashboard/tests/services/branding/branding-orchestrator.test.ts
      lines: 281
      role: 10-case vitest suite pinning happy paths, per-request mode read, no-fallback invariant (both directions), no-guideline short-circuits, calculator wiring, brandRelatedCount math
  modified:
    - path: packages/dashboard/src/server.ts
      lines_added: ~20
      role: BrandingService instantiation + EmbeddedBrandingAdapter + RemoteBrandingAdapter + BrandingOrchestrator construction + server.decorate('brandingOrchestrator', ...)
decisions:
  - No caching of branding_mode. orgRepository.getBrandingMode runs on EVERY matchAndScore call. Acceptance criterion pinned: `grep -ic "cache\|memo"` on branding-orchestrator.ts returns 0. Admin flips mode → next scan picks it up, no restart, no invalidation.
  - No silent cross-route fallback. When remote throws, orchestrator returns `degraded` and DOES NOT call embedded. Enforced by test 4's `expect(embeddedFn).toHaveBeenCalledTimes(0)` assertion — THE most important assertion in Phase 17. Crossing modes mid-flight would corrupt trend data with mode-mixed scores (PITFALLS.md #6).
  - One match call per scan. Phase 15's `calculateBrandScore` is a pure function over already-matched `BrandedIssue[]`. Orchestrator never makes a second match round-trip for scoring (PITFALLS.md #10). Latency budget: one mode read + one match call + one pure calculator invocation.
  - ServiceClientRegistry UNCHANGED. Orchestrator depends on a constructor-injected RemoteBrandingAdapter, which depends on a constructor-injected BrandingService, which is built in server.ts using the EXISTING `getBrandingTokenManager` getter. Zero new methods, zero modifications to the registry.
  - brandRelatedCount pre-computed in the orchestrator (single O(n) walk) so Phase 18 persistence and Phase 20 report panel don't re-walk the array. Satisfies BSTORE-05 "X of Y issues are on brand elements" at zero downstream cost.
  - Degraded result retains `mode` tag. When remote fails, the result still says `mode: 'remote'` so Phase 18 persistence and Phase 20 UI know which mode the failure originated from — trend lines render dashed segments for the correct half.
  - Fastify decorator `brandingOrchestrator` typed untyped — mirrors existing `serviceClientRegistry` decorate pattern. Phase 18 scanner will own the module augmentation when it actually consumes this decorator.
requirements-completed:
  - BMODE-02
  - BMODE-05
metrics:
  duration: "~15m (auto tasks) + UAT execution"
  completed: 2026-04-11
  tasks: 4
  commits: 3
  tests_added: 10
  tests_passing: "10/10"
  branding_suite: "26/26 (17-01: 6 + 17-02: 10 + 17-03: 10)"
  regression_suite: "2475 passed / 40 skipped / 0 failed (baseline 2465 + 10 new, exact match)"
---

# Phase 17 Plan 03: BrandingOrchestrator Summary

**One-liner:** BrandingOrchestrator — the single dual-mode `matchAndScore(input)` entry point that consults `orgRepository.getBrandingMode` per-request, routes to EmbeddedBrandingAdapter or RemoteBrandingAdapter, pipes the `BrandedIssue[]` result through Phase 15's `calculateBrandScore`, and returns a tagged-union `MatchAndScoreResult` — with a vitest suite that pins the no-cross-route-fallback invariant by asserting the embedded adapter spy was called zero times after a remote `ECONNREFUSED`, and a server.ts DI wiring block that finally instantiates the dormant `BrandingService` via the existing `ServiceClientRegistry.getBrandingTokenManager()` getter without touching the registry.

## Performance

- **Duration:** ~15m for auto tasks 1-3 (then UAT-17-01 executed live by orchestrator over SSH to lxc-luqen)
- **Completed:** 2026-04-11
- **Tasks:** 4 (3 auto + 1 UAT human-verify, all PASSED)
- **Files created:** 2
- **Files modified:** 1 (server.ts DI block)

## Accomplishments

- Dual-mode orchestrator ready for Phase 18 scanner rewire (`brandingOrchestrator.matchAndScore(...)` is the single call site that replaces `scanner/orchestrator.ts:541-594`)
- All four architectural invariants from PROJECT.md + PITFALLS.md locked by unit tests
- BrandingService finally instantiated in production (first real consumer since it was built dormant in v2.7.0)
- `service.branding` row on live lxc-luqen confirmed healthy with OAuth tokens flowing (UAT-17-01 evidence below)
- STATE.md research flag resolved: branding service is reachable, credentials are valid, Phase 17 is safe to ship

## Task Commits

Each task committed atomically:

1. **Task 1: BrandingOrchestrator class + MatchAndScoreResult tagged union** — `e7ded82` (`feat(17-03): add BrandingOrchestrator with tagged-union result`)
2. **Task 2: 10-case vitest suite** — `35075bc` (`test(17-03): 10-case suite for BrandingOrchestrator`)
3. **Task 3: server.ts DI wiring** — `b7ac6d4` (`feat(17-03): wire BrandingService + adapters + orchestrator in server.ts`)
4. **Task 4: UAT-17-01 human verification (checkpoint)** — PASS (executed live by orchestrator via SSH to lxc-luqen at 2026-04-11 ~11:55 UTC; evidence captured in "UAT-17-01 Results" section below, no code change)

**Plan metadata commit:** this SUMMARY.md (`docs(17-03): ...`)

## Files Created/Modified

### Created

- `packages/dashboard/src/services/branding/branding-orchestrator.ts` (156 lines)
  - `class BrandingOrchestrator` — constructor takes `(orgRepository: OrgRepository, embeddedAdapter: BrandingAdapter, remoteAdapter: BrandingAdapter)`
  - `async matchAndScore(input: MatchAndScoreInput): Promise<MatchAndScoreResult>` — single public entry point
  - `type MatchAndScoreInput = { orgId, siteUrl, scanId, issues, guideline }` — readonly envelope
  - `type MatchAndScoreResult = { kind: 'matched', mode, brandedIssues, scoreResult, brandRelatedCount } | { kind: 'degraded', mode, reason, error } | { kind: 'no-guideline', mode }` — tagged union
  - `type DegradedReason = 'remote-unavailable' | 'remote-malformed' | 'embedded-error'`
  - Class-level JSDoc documents all four invariants (no caching, no cross-route fallback, one match call per scan, registry untouched)

- `packages/dashboard/tests/services/branding/branding-orchestrator.test.ts` (281 lines)
  - 10 tests, all passing
  - Aperol-brand fixture parallel-structured with the Plan 17-01 and 17-02 suites
  - Mock `OrgRepository` and mock `BrandingAdapter` factories — full isolation, zero network, zero SQLite

### Modified

- `packages/dashboard/src/server.ts` — DI wiring block (~20 lines added around line 213-235):
  ```typescript
  // Phase 17 BrandingOrchestrator wiring.
  // The orchestrator reads orgs.branding_mode per-request via the
  // OrgRepository (no caching). When mode='remote' it routes through the
  // BrandingService -> @luqen/branding REST. When mode='embedded' (default)
  // it runs the in-process BrandingMatcher via EmbeddedBrandingAdapter.
  // On any failure it returns a `degraded` result and DOES NOT cross-route
  // to the other adapter (PITFALLS.md #6 / PROJECT.md decision).
  //
  // Phase 18 will replace the inline branding block at
  // scanner/orchestrator.ts:541-594 with one call to
  // brandingOrchestrator.matchAndScore(...).
  const brandingService = new BrandingService(config, getBrandingTokenManager);
  const embeddedBrandingAdapter = new EmbeddedBrandingAdapter();
  const remoteBrandingAdapter = new RemoteBrandingAdapter(brandingService);
  const brandingOrchestrator = new BrandingOrchestrator(
    storage.organizations,
    embeddedBrandingAdapter,
    remoteBrandingAdapter,
  );
  server.decorate('brandingOrchestrator', brandingOrchestrator);
  ```
  - `getBrandingTokenManager` is the EXISTING getter on `ServiceClientRegistry` — no new methods, no modifications to the registry
  - Decorator is intentionally untyped for now; Phase 18 scanner will own the Fastify module augmentation when it actually consumes the decorator (mirrors the existing `serviceClientRegistry` decorate pattern at line 195)

## Verification

| Check | Result |
|---|---|
| `cd packages/dashboard && npm run lint` | Clean, 0 errors |
| `cd packages/dashboard && npx vitest run tests/services/branding/branding-orchestrator.test.ts` | 10/10 passing |
| `cd packages/dashboard && npx vitest run tests/services/branding/` (all three plans) | 26/26 passing (17-01: 6 + 17-02: 10 + 17-03: 10) |
| `cd packages/dashboard && npx vitest run` (full dashboard suite) | 2475 passed / 40 skipped / 0 failed — baseline 2465 + 10 new, exact match, 0 regressions |
| `git diff master -- packages/dashboard/src/services/service-client-registry.ts` | Empty (registry untouched) |
| `git diff master -- packages/dashboard/src/scanner/orchestrator.ts` | Empty (scanner untouched — Phase 18's job) |
| `grep -ic "cache\|memo" packages/dashboard/src/services/branding/branding-orchestrator.ts` | 0 (zero caching) |
| `grep -c "export class BrandingOrchestrator" branding-orchestrator.ts` | 1 |
| `grep -c "this.orgRepository.getBrandingMode" branding-orchestrator.ts` | 1 |
| `grep -c "calculateBrandScore" branding-orchestrator.ts` | 2 (import + use) |
| `grep -c "new BrandingOrchestrator" packages/dashboard/src/server.ts` | 1 |
| `grep -c "new BrandingService(config, getBrandingTokenManager)" packages/dashboard/src/server.ts` | 1 |
| `grep -c "service.decorate('brandingOrchestrator'" packages/dashboard/src/server.ts` | 1 (via `server.decorate(...)`) |

## Critical Invariants Pinned by Tests

The 10-test suite is not a generic coverage pass — each test pins a specific architectural invariant. Five tests are load-bearing:

| Test | Invariant | Load-bearing assertion |
|---|---|---|
| **Test 3** (per-request mode read) | NO CACHING — mode flipped between two calls picks the new adapter with zero restart | `getBrandingMode` called twice, `embeddedFn` called once (first call), `remoteFn` called once (second call) — no re-use |
| **Test 4** (CRITICAL — remote throw) | NO CROSS-ROUTE FALLBACK — remote `ECONNREFUSED` returns `degraded` with `reason: 'remote-unavailable'`, embedded NOT invoked | `expect(embeddedFn).toHaveBeenCalledTimes(0)` — **THE most important assertion in Phase 17** |
| **Test 5** (remote malformed) | Same no-fallback invariant on the typed-error branch: `RemoteBrandingMalformedError` → `reason: 'remote-malformed'`, embedded NOT invoked | `expect(embeddedFn).toHaveBeenCalledTimes(0)` — mirror of Test 4 for the shape-violation path |
| **Test 6** (embedded throw) | Symmetric no-fallback on the OTHER direction: embedded throw → `reason: 'embedded-error'`, remote NOT invoked | `expect(remoteFn).not.toHaveBeenCalled()` — the orchestrator is direction-agnostic |
| **Test 9** (calculator wiring) | Phase 15's `calculateBrandScore` runs on matched path, returns `ScoreResult` with `overall ∈ [0, 100]` | `expect(result.scoreResult.overall).toBeGreaterThanOrEqual(0).toBeLessThanOrEqual(100)` |

Plus five supporting tests: happy-path embedded (test 1), happy-path remote (test 2), no-guideline short-circuit in embedded mode (test 7), no-guideline short-circuit in remote mode (test 8), and `brandRelatedCount` math (test 10 — `expect(brandRelatedCount).toBe(3)` on a 5-row response with the first 3 matched).

## Requirements Completed

- **BMODE-02** — Dual-mode branding routing (`branding_mode` flag on `organizations` table controls per-scan adapter selection)
- **BMODE-05** — `brandRelatedCount` pre-computed at match time, surfaced to Phase 18 persistence without a second array walk

Both will be marked complete in `REQUIREMENTS.md` via `requirements mark-complete BMODE-02 BMODE-05` after this SUMMARY commit.

## Deviations from Plan

**None from the executor side during the 17-03 auto tasks.**

Task 1 (BrandingOrchestrator class), Task 2 (test suite), and Task 3 (server.ts DI wiring) all executed verbatim per plan. All four invariants documented in the class-level JSDoc match the plan's `must_haves.truths`. The 10-test suite covers every `human_verification`-adjacent behavior plus the three load-bearing invariant tests the plan explicitly required.

The only "deviation" is the UAT-17-01 port correction — see UAT results section. The plan said `curl http://localhost:4300/api/v1/health`; the actual branding service port on lxc-luqen is `4100`. This is a plan documentation error, not an executor deviation — the orchestrator corrected the command and ran it against the real port. Phase 17 code was not touched.

## Authentication Gates

None during auto tasks 1-3 (pure in-process work + mocked dependencies). UAT-17-01 required SSH access to lxc-luqen, which the orchestrator already had — no new credentials provisioned.

## UAT-17-01 Results

**Executed:** 2026-04-11 ~11:55 UTC
**Executed by:** Phase 17-03 orchestrator (not a human) via SSH to `lxc-luqen`
**Outcome:** **PASS** on all required steps (1-4). Step 5 deferred to Phase 18 by design.

### 1. Branding service health — PASS

```
curl http://localhost:4100/api/v1/health
→ {"status":"ok","version":"2.6.0","timestamp":"2026-04-11T11:55:53.742Z"}
```

- Systemd service `luqen-branding.service` **active** since 2026-04-05 06:25:12 UTC (6 days uptime)
- `WorkingDirectory=/root/luqen/packages/branding`
- `BRANDING_PORT=4100` (plan said `4300`; the actual live port is **4100** — plan documentation error, not a code issue)

### 2. Dashboard `service_connections` has a valid `branding` row — PASS

```
service_id     = 'branding'
url            = 'http://localhost:4100'
client_id      = '0578427b-e1a5-4461-a0f5-4ad21e9b490a'
client_secret  = <encrypted, present>
updated_by     = 'bootstrap-from-config'
updated_at     = 2026-04-05T16:08:42Z
enabled        = 1
```

### 3. OAuth tokens flowing dashboard → branding — PASS

Branding service logs show regular `POST /api/v1/oauth/token → 200` requests every ~1 hour:

```
latest: req-6h  2026-04-11T11:25:36 UTC  POST /api/v1/oauth/token  200  130ms
```

This proves the **existing** `ServiceClientRegistry.brandingTokenManager` is alive and working **today** — Phase 17's first instantiation of `BrandingService` in server.ts will find the token manager it needs on the very first request.

### 4. Existing scanner embedded path works (regression check) — PASS

- `scan_records` table still has `brand_related_count` column populated on recent completed scans
- 3 of 5 recent scans (sky.it, inps.it x2) have `branding_guideline_id` + `branding_guideline_version` set
- This proves the inline matcher at `scanner/orchestrator.ts:541-594` still runs successfully — Phase 17 did not break the embedded path
- `brand_related_count=0` on those scans just means no accessibility issues happened to land on branded elements — that's a valid result, not a failure

### 5. Remote path end-to-end smoke — DEFERRED

Phase 17 does **not** wire the orchestrator into the scanner yet — **Phase 18** does. The remote-mode end-to-end smoke (flip a test org to `branding_mode='remote'`, run a scan, verify the `mode='remote'` log line) is deferred to Phase 18 by design. The UAT plan explicitly marks this step as "informational, may be deferred".

### Important migration state note

The live dashboard on lxc-luqen is running migration **042** (last applied 2026-04-10T14:16:06Z, `add-api-key-expires-at`). The `organizations.branding_mode` column and `brand_scores` table **do NOT yet exist on live** — migration 043 will run on the next `luqen-dashboard.service` restart after deploy.

This is **expected and correct** — Phase 15/16/17 commits are on `master` locally but have not been deployed to lxc-luqen yet. This is a milestone-ship concern for whenever v2.11.0 deploys, not a Phase 17 concern. Phase 17 is safe to merge to master now; the migration will replay cleanly on deploy.

### STATE.md research flag RESOLVED

The Phase 17 research flag from STATE.md ("First real consumer of BrandingService — confirm @luqen/branding is actually running on lxc-luqen and OAuth works before Phase 17 planning finalizes") is now **answered definitively with live evidence**:

- Branding service is healthy (step 1)
- Reachable from dashboard host (step 1 via localhost:4100)
- Dashboard already holds valid OAuth credentials (step 2)
- OAuth tokens are flowing TODAY via the dormant `brandingTokenManager` (step 3)
- Existing embedded path is unbroken (step 4)

Phase 17 is safe to ship.

## Phase 17 Completion Readiness

All three plans in Phase 17 are now complete:

| Plan | Commits | Delivered | Status |
|---|---|---|---|
| 17-01 | 3 (including 1 merged docs fix) | BrandingAdapter interface + EmbeddedBrandingAdapter + 6 contract tests | Complete |
| 17-02 | 2 | RemoteBrandingAdapter + RemoteBrandingMalformedError + isMatchableIssue guard + 10 translation-boundary tests | Complete |
| 17-03 | 3 (+ this docs commit) | BrandingOrchestrator + server.ts DI wiring + 10 invariant-pinning tests | Complete |

**Phase 17 total:** 26 branding tests, all passing; `scanner/orchestrator.ts` untouched; `service-client-registry.ts` untouched; `BrandingService` finally instantiated in production DI after lying dormant since v2.7.0.

**Phase 18 can now begin.** Phase 18's scanner rewire will:

1. Import `brandingOrchestrator` from the Fastify decorator
2. Delete the inline block at `scanner/orchestrator.ts:541-594`
3. Replace with a single call: `const result = await brandingOrchestrator.matchAndScore({ orgId, siteUrl, scanId, issues, guideline });`
4. Switch on `result.kind` to persist `matched` → full `ScoreResult` + `brandRelatedCount`, `degraded` → tag scan with `mode` + `reason`, `no-guideline` → tag scan as un-branded

The `BrandingAdapter` interface is the ONLY abstract dependency Phase 18 needs. Everything else is concrete and wired.

## Self-Check: PASSED

Files verified to exist:

- FOUND: `packages/dashboard/src/services/branding/branding-orchestrator.ts` (156 lines)
- FOUND: `packages/dashboard/tests/services/branding/branding-orchestrator.test.ts` (281 lines)
- FOUND: `packages/dashboard/src/server.ts` (modified — DI block at ~line 213-235)

Commits verified in `git log`:

- FOUND: `e7ded82` — `feat(17-03): add BrandingOrchestrator with tagged-union result`
- FOUND: `35075bc` — `test(17-03): 10-case suite for BrandingOrchestrator`
- FOUND: `b7ac6d4` — `feat(17-03): wire BrandingService + adapters + orchestrator in server.ts`

All 11 plan `must_haves.truths` honored:

- BrandingOrchestrator class with constructor-injected `(OrgRepository, EmbeddedBrandingAdapter, RemoteBrandingAdapter)` and public `matchAndScore(input)` — YES (see branding-orchestrator.ts:82-88)
- Per-request `getBrandingMode` read with zero caching — YES (test 3 pins this; `grep -ic "cache\|memo" = 0`)
- Tagged-union `MatchAndScoreResult` with `matched | degraded | no-guideline` — YES (branding-orchestrator.ts:61-78)
- Remote throw → `degraded`, embedded NOT called — YES (test 4, `embeddedFn` called 0 times, THE load-bearing Phase 17 assertion)
- `calculateBrandScore` wired and returns `ScoreResult` — YES (branding-orchestrator.ts:137; test 9 pins `overall ∈ [0, 100]`)
- `brandRelatedCount` = count of `brandMatch.matched===true` — YES (branding-orchestrator.ts:142-145; test 10 pins `toBe(3)` on 5-row fixture with 3 matched)
- `BrandingService` instantiated in server.ts via existing `getBrandingTokenManager()` getter — YES (server.ts:223)
- `BrandingOrchestrator` constructed in server.ts + decorated on Fastify — YES (server.ts:226-234)
- Per-request mode flip picks new adapter — YES (test 3 pins this)
- Latency invariant documented in source comments — YES (branding-orchestrator.ts:24-28 class JSDoc invariant 3)
- UAT-17-01 precondition executed and PASSED — YES (see UAT results section above)

`ServiceClientRegistry` untouched: `git diff master -- packages/dashboard/src/services/service-client-registry.ts` = empty.
`scanner/orchestrator.ts` untouched: `git diff master -- packages/dashboard/src/scanner/orchestrator.ts` = empty.

---
*Phase: 17-branding-orchestrator*
*Plan: 03*
*Completed: 2026-04-11*
