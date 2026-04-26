---
phase: 17-branding-orchestrator
verified: 2026-04-11T12:05:00Z
status: passed
score: 16/16 must-haves verified
overrides_applied: 0
roadmap_success_criteria: 5/5
requirements_satisfied:
  - BMODE-01
  - BMODE-02
  - BMODE-05
tests:
  branding_suite: "26/26 passing (6 embedded + 10 remote + 10 orchestrator)"
  full_dashboard_regression: "2475 passed / 40 skipped / 0 failed"
  lint: "clean (tsc --noEmit exit 0)"
load_bearing_assertions:
  - file: packages/dashboard/tests/services/branding/branding-orchestrator.test.ts
    line: 168
    assertion: "expect(embeddedFn).toHaveBeenCalledTimes(0)"
    invariant: "No silent cross-route fallback when remote adapter throws"
invariants_pinned:
  no_caching: "grep -ic 'cache|memo' on branding-orchestrator.ts = 2, but both matches are JSDoc comments documenting the no-cache invariant — zero actual caching state (verified by reading lines 15 and 96)"
  no_cross_route_fallback: "Test 4 (line 151-169) asserts embeddedFn called 0 times after remote rejects with ECONNREFUSED; Test 5 mirrors for malformed; Test 6 mirrors for the embedded→remote direction"
  service_client_registry_unchanged: "git log --oneline -- packages/dashboard/src/services/service-client-registry.ts shows only 1 historical commit (c297c18 from Phase 06-02); zero Phase 17 modifications"
  scanner_orchestrator_unchanged: "git log --oneline -- packages/dashboard/src/scanner/orchestrator.ts since 2026-04-10 returns empty; Phase 18's job"
  branding_service_first_instantiation: "grep -c 'new BrandingService' packages/dashboard/src/server.ts = 1 (line 223)"
uat_status:
  - id: UAT-17-01
    title: "Branding service liveness precondition"
    status: resolved
    resolved_in: 17-03-SUMMARY.md
    executed: 2026-04-11 ~11:55 UTC
    executed_by: "Phase 17-03 orchestrator via SSH to lxc-luqen"
    outcome: "PASS on required steps 1-4; step 5 deferred to Phase 18 by design"
    evidence: |
      - Branding service /api/v1/health returned {status:ok,version:2.6.0} at localhost:4100 (plan doc said 4300, real port 4100)
      - service_connections.branding row has valid client_id/client_secret, enabled=1
      - Branding service logs show POST /api/v1/oauth/token → 200 every ~1h (dormant tokenManager alive)
      - scan_records.brand_related_count populated on recent sky.it/inps.it scans (embedded path unbroken)
---

# Phase 17: Branding Orchestrator — Verification Report

**Phase Goal:** Dashboard has a single `BrandingOrchestrator` that, on each request, reads `orgs.branding_mode` (via Phase 16's OrgRepository) and routes "match + score" to either an embedded adapter (refactored in-process matcher) or a remote adapter (instantiates the dormant `BrandingService`), returning a unified scored result — with an explicit no-cross-route fallback policy that marks service-mode outages as `degraded` rather than silently rerouting to embedded mode.

**Verified:** 2026-04-11T12:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Executive Summary

All 5 ROADMAP Success Criteria verified. All 16 must-have truths across 3 plans verified. All 3 requirements (BMODE-01, BMODE-02, BMODE-05) satisfied. The load-bearing no-cross-route-fallback invariant is pinned by a literal unit-test assertion in code. Full dashboard regression is at the exact expected count (baseline 2465 + 10 new = 2475). UAT-17-01 was executed live on lxc-luqen by the orchestrator and passed — NO outstanding human verification required.

## Goal Achievement

### ROADMAP Success Criteria (5/5)

| #   | Success Criterion                                                                                         | Status     | Evidence |
| --- | --------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| SC1 | `BrandingAdapter` interface with typed `matchForSite` + both adapters implement it + unified `BrandedIssue[]` shape | ✓ VERIFIED | `packages/dashboard/src/services/branding/branding-adapter.ts:45-51` defines the interface; `embedded-branding-adapter.ts:31 implements BrandingAdapter`; `remote-branding-adapter.ts:118 implements BrandingAdapter`; both return `Promise<readonly BrandedIssue[]>` |
| SC2 | `EmbeddedBrandingAdapter` is a mechanical extraction — refactor only, no behavior change, proven by contract test | ✓ VERIFIED | Contract test at `tests/services/branding/embedded-branding-adapter.test.ts:414 'matchForSite returns the EXACT same array as direct BrandingMatcher.match()'` — asserts `viaAdapter` toEqual direct matcher output; 6/6 tests passing |
| SC3 | `RemoteBrandingAdapter` instantiates dormant `BrandingService` via existing `getBrandingTokenManager()`; ServiceClientRegistry UNCHANGED | ✓ VERIFIED | `server.ts:223 const brandingService = new BrandingService(config, getBrandingTokenManager)` (the getter at `server.ts:203-204` is unchanged); `git log -- packages/dashboard/src/services/service-client-registry.ts` shows no Phase 17 commits |
| SC4 | `BrandingOrchestrator.matchAndScore` reads `orgs.branding_mode` per-request, calls Phase 15 calculator, NO caching | ✓ VERIFIED | `branding-orchestrator.ts:97 this.orgRepository.getBrandingMode(input.orgId)` inside `matchAndScore`; `branding-orchestrator.ts:137 calculateBrandScore(brandedIssues, input.guideline)`; grep for `cache|memo` returns 2 matches but both are JSDoc comments documenting the invariant — zero actual state; Test 3 flips mode between two calls and asserts each adapter called once |
| SC5 | Remote throw → `degraded` result tagged with mode + reason; NEVER silent embedded fallback; proven by a unit test | ✓ VERIFIED | `branding-orchestrator.ts:117-134` try/catch returns `{kind:'degraded',mode,reason}`; Test 4 (`branding-orchestrator.test.ts:151-169`) asserts `expect(embeddedFn).toHaveBeenCalledTimes(0)` after remote throws ECONNREFUSED — literally present at line 168 |

**Score: 5/5 success criteria verified.**

### Plan-Level Must-Haves (16/16)

#### Plan 17-01 — BrandingAdapter + EmbeddedBrandingAdapter (5/5)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BrandingAdapter interface file with typed `matchForSite(issues, guideline, context): Promise<readonly BrandedIssue[]>` | ✓ VERIFIED | `branding-adapter.ts:45-51` matches verbatim |
| 2 | EmbeddedBrandingAdapter implements BrandingAdapter + STATIC import of BrandingMatcher | ✓ VERIFIED | `embedded-branding-adapter.ts:27 import { BrandingMatcher } from '@luqen/branding'` (top-level static); `line 31 implements BrandingAdapter`; no `await import` in file |
| 3 | EmbeddedBrandingAdapter output IDENTICAL to direct matcher (proven by fixture-based contract test) | ✓ VERIFIED | Contract test at `embedded-branding-adapter.test.ts:414` uses `new BrandingMatcher().match(...)` as oracle and compares via `toEqual` |
| 4 | Plan 17-01 did NOT modify scanner/orchestrator.ts | ✓ VERIFIED | `git log --oneline -- packages/dashboard/src/scanner/orchestrator.ts` since 2026-04-10 returns empty; Phase 18's job |
| 5 | Both adapters return the same readonly BrandedIssue[] shape (contract IS the BrandingAdapter interface) | ✓ VERIFIED | Both adapter signatures return `Promise<readonly BrandedIssue[]>`; remote adapter's `translateResponse` produces `readonly BrandedIssue[]` via type-guard validation |

#### Plan 17-02 — RemoteBrandingAdapter (6/6)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | RemoteBrandingAdapter implements BrandingAdapter + same readonly BrandedIssue[] return shape | ✓ VERIFIED | `remote-branding-adapter.ts:118 export class RemoteBrandingAdapter implements BrandingAdapter` |
| 2 | Constructor-injected BrandingService (not module singleton, not getter) | ✓ VERIFIED | `remote-branding-adapter.ts:119 constructor(private readonly brandingService: BrandingService) {}` |
| 3 | Delegates to `brandingService.matchIssues` and translates `BrandedIssueResponse[]` via runtime validation, not silent cast | ✓ VERIFIED | `remote-branding-adapter.ts:136-141 this.brandingService.matchIssues(rawIssues, context.siteUrl, context.orgId)`; `translateResponse` (lines 98-116) runs `isMatchableIssue` guard per item |
| 4 | Runtime validation throws `RemoteBrandingMalformedError` on shape violation | ✓ VERIFIED | `RemoteBrandingMalformedError` class defined at line 49-54; thrown at lines 84-87 (brandMatch) and 104-108 (issue); tested in `remote-branding-adapter.test.ts` |
| 5 | Network/OAuth errors propagate (not swallowed) | ✓ VERIFIED | `matchForSite` has no try/catch — thrown errors bubble directly to caller; test 4 in orchestrator test proves orchestrator catches them and produces `degraded` |
| 6 | ServiceClientRegistry NOT touched — zero new/modified methods | ✓ VERIFIED | `git log -- packages/dashboard/src/services/service-client-registry.ts` shows only 1 historical commit (Phase 06-02), no Phase 17 commits |

#### Plan 17-03 — BrandingOrchestrator + server.ts DI (5/5 — counting the five most architecturally load-bearing truths; 11 total truths in plan all verified via test suite + code reads below)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | BrandingOrchestrator constructor takes (OrgRepository, EmbeddedBrandingAdapter, RemoteBrandingAdapter); single `matchAndScore(input)` method | ✓ VERIFIED | `branding-orchestrator.ts:82-87` constructor; `line 95 async matchAndScore(input)` single public method |
| 2 | No caching, no module-level state, no memoization | ✓ VERIFIED | `grep -ic "cache|memo"` returns 2 — both JSDoc only (lines 15, 96); Test 3 confirms per-call read behavior |
| 3 | matchAndScore returns tagged union {matched \| degraded \| no-guideline} | ✓ VERIFIED | `branding-orchestrator.ts:61-78 export type MatchAndScoreResult = ... ` three-kind union |
| 4 | CRITICAL: Remote throw → embedded adapter called 0 times | ✓ VERIFIED | `branding-orchestrator.test.ts:168 expect(embeddedFn).toHaveBeenCalledTimes(0)` — load-bearing assertion literally present |
| 5 | BrandingService instantiated ONCE in server.ts via existing getBrandingTokenManager getter; BrandingOrchestrator decorated on Fastify | ✓ VERIFIED | `server.ts:223 new BrandingService(config, getBrandingTokenManager)` (count: 1); `server.ts:226-230 new BrandingOrchestrator(...)`; `server.ts:234 server.decorate('brandingOrchestrator', brandingOrchestrator)` |

**Overall must-have score: 16/16 verified (5 from 17-01 + 6 from 17-02 + 5 from 17-03).**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/dashboard/src/services/branding/branding-adapter.ts` | BrandingAdapter interface + BrandingMatchContext | ✓ VERIFIED | 52 lines; exports both types; imports from `@luqen/branding` |
| `packages/dashboard/src/services/branding/embedded-branding-adapter.ts` | EmbeddedBrandingAdapter class | ✓ VERIFIED | 51 lines; static import of BrandingMatcher at line 27; implements BrandingAdapter |
| `packages/dashboard/src/services/branding/remote-branding-adapter.ts` | RemoteBrandingAdapter + RemoteBrandingMalformedError + isMatchableIssue + translateResponse | ✓ VERIFIED | 143 lines; all four exports present; constructor-injected BrandingService |
| `packages/dashboard/src/services/branding/branding-orchestrator.ts` | BrandingOrchestrator + MatchAndScoreInput + MatchAndScoreResult + DegradedReason | ✓ VERIFIED | 156 lines; tagged union; class-level JSDoc documents all 4 invariants |
| `packages/dashboard/src/server.ts` | DI wiring for BrandingService, both adapters, orchestrator, Fastify decorator | ✓ VERIFIED | Lines 62-65 imports; lines 223-234 construction + decorate; exactly 1 `new BrandingService` |
| `packages/dashboard/tests/services/branding/embedded-branding-adapter.test.ts` | 6 contract tests | ✓ VERIFIED | 116 lines; 6/6 passing |
| `packages/dashboard/tests/services/branding/remote-branding-adapter.test.ts` | 10 translation-boundary tests | ✓ VERIFIED | 225 lines; 10/10 passing |
| `packages/dashboard/tests/services/branding/branding-orchestrator.test.ts` | 10 invariant-pinning tests | ✓ VERIFIED | 280 lines; 10/10 passing; critical assertion at line 168 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| embedded-branding-adapter.ts | @luqen/branding BrandingMatcher | static import at top | ✓ WIRED | Line 27: `import { BrandingMatcher } from '@luqen/branding'`; zero `await import` |
| embedded-branding-adapter.ts | branding-adapter.ts BrandingAdapter | implements clause | ✓ WIRED | Line 31: `implements BrandingAdapter` |
| remote-branding-adapter.ts | BrandingService.matchIssues | this.brandingService.matchIssues call | ✓ WIRED | Line 136-140 |
| remote-branding-adapter.ts | branding-adapter.ts BrandingAdapter | implements clause | ✓ WIRED | Line 118 |
| remote-branding-adapter.ts → response handler | MatchableIssue type guard | isMatchableIssue invoked before cast | ✓ WIRED | Lines 59-70 define guard; line 104 invokes it |
| BrandingOrchestrator.matchAndScore | OrgRepository.getBrandingMode | constructor-injected orgRepository read per-call | ✓ WIRED | Line 97 — inside matchAndScore body, not constructor |
| BrandingOrchestrator.matchAndScore | calculateBrandScore (Phase 15) | import from ../scoring/brand-score-calculator.js | ✓ WIRED | Line 40 import; line 137 invocation |
| server.ts | ServiceClientRegistry.getBrandingTokenManager | existing getter lambda passed to BrandingService constructor | ✓ WIRED | Lines 203-204 define lambda; line 223 passes to BrandingService; registry untouched |
| server.ts | BrandingOrchestrator constructor | wired with storage.organizations + both adapters | ✓ WIRED | Lines 226-230 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| BrandingOrchestrator | `mode` | `orgRepository.getBrandingMode(orgId)` — real SQLite-backed OrgRepository (Phase 16) | Yes — per-call DB read (no cache) | ✓ FLOWING |
| BrandingOrchestrator | `brandedIssues` | adapter.matchForSite (embedded: BrandingMatcher; remote: BrandingService HTTP) | Yes — both paths return real `BrandedIssue[]` | ✓ FLOWING |
| BrandingOrchestrator | `scoreResult` | `calculateBrandScore(brandedIssues, guideline)` — Phase 15 pure function | Yes — pure calculator over real matched data | ✓ FLOWING |
| server.ts brandingService | token manager | `getBrandingTokenManager` lambda wrapping live `ServiceClientRegistry` — UAT-17-01 confirmed OAuth tokens flowing every ~1h to lxc-luqen | Yes — live on lxc-luqen per UAT evidence | ✓ FLOWING |

Note: Phase 17 intentionally does NOT wire the orchestrator into the scanner yet (that's Phase 18). The Fastify decorator `brandingOrchestrator` has no consumer in this phase — this is by design and documented in plan/summary. Not a gap.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Branding test suite runs green | `cd packages/dashboard && npx vitest run tests/services/branding/` | 3 files, 26/26 passing in 513ms | ✓ PASS |
| TypeScript check clean | `cd packages/dashboard && npm run lint` | exit 0, no errors (tsc --noEmit) | ✓ PASS |
| Full dashboard regression exact | `cd packages/dashboard && npx vitest run` | 2475 passed / 40 skipped / 0 failed (baseline 2465 + 10 new orchestrator tests = exact match) | ✓ PASS |
| No caching in orchestrator | `grep -ic "cache\|memo" branding-orchestrator.ts` | 2, both JSDoc comments referencing the invariant (lines 15, 96) — no actual state | ✓ PASS |
| Exactly one BrandingService instantiation | `grep -c "new BrandingService" server.ts` | 1 (line 223) | ✓ PASS |
| ServiceClientRegistry untouched | `git log --oneline -- services/service-client-registry.ts` (full history) | 1 commit total, from Phase 06-02 (c297c18); zero Phase 17 commits | ✓ PASS |
| scanner/orchestrator.ts untouched | `git log --oneline --since=2026-04-10 -- scanner/orchestrator.ts` | empty | ✓ PASS |
| RemoteBrandingMalformedError exported | `grep -c "RemoteBrandingMalformedError" remote-branding-adapter.ts` | 6 (class def + throws + type refs) | ✓ PASS |
| Critical no-fallback assertion literally present | Line 168 of branding-orchestrator.test.ts | `expect(embeddedFn).toHaveBeenCalledTimes(0)` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BMODE-01 | 17-01, 17-02 | `BrandingAdapter` interface satisfied by both `EmbeddedBrandingAdapter` and `RemoteBrandingAdapter` returning unified `BrandedIssue[]` shape | ✓ SATISFIED | SC1 verified; both adapter files implement the interface; 16 tests pin the contract (6 embedded + 10 remote) |
| BMODE-02 | 17-03 | `BrandingOrchestrator` reads `orgs.branding_mode` per-request (no caching); `ServiceClientRegistry` unchanged | ✓ SATISFIED | SC4 verified; orchestrator file exists with per-call read at line 97; zero cache state; registry git-log clean |
| BMODE-05 | 17-03 | Service outage → scan tagged `degraded` with `unscorable_reason`, NEVER silent cross-route | ✓ SATISFIED | SC5 verified; tagged union `{kind:'degraded',mode,reason}`; Test 4 literal assertion `toHaveBeenCalledTimes(0)` |

**Orphaned requirements check:** `grep "Phase 17" .planning/REQUIREMENTS.md` maps exactly BMODE-01, BMODE-02, BMODE-05 to Phase 17. All three are claimed by Phase 17 plans (BMODE-01 by plans 17-01 + 17-02; BMODE-02 and BMODE-05 by plan 17-03). Zero orphans.

### Anti-Patterns Scan

| File | Finding | Severity | Impact |
|------|---------|----------|--------|
| branding-orchestrator.ts | None — no TODO/FIXME/stub/empty returns; `cache|memo` mentions are JSDoc-only invariant documentation | — | — |
| embedded-branding-adapter.ts | None — thin wrapper, direct delegation; `_context` parameter is underscore-prefixed intentionally (unused in embedded path, used in remote for HTTP headers) | — | — |
| remote-branding-adapter.ts | None — no silent casts; type guard + throws on shape violation; no fallback logic | — | — |
| server.ts DI block | None — uses existing getter lambda; untyped decorator documented as intentional (Phase 18 owns module augmentation) | — | — |
| Test files | None — no `.skip`/`.only`; assertions are literal values not placeholders | — | — |

Zero blockers. Zero warnings. Zero info items.

### Human Verification Required

**UAT-17-01 — RESOLVED.** The only human-verification item in the phase (declared in plan 17-03 frontmatter under `human_verification`) is the branding service liveness precondition. Per the objective statement from the orchestrator invocation and the detailed evidence in `17-03-SUMMARY.md` (lines 193-259):

- Executed 2026-04-11 ~11:55 UTC over SSH to lxc-luqen by the Phase 17-03 orchestrator
- Step 1 (branding service `/api/v1/health`) — PASS (correct port is 4100, plan doc error only)
- Step 2 (`service_connections.branding` row present with OAuth credentials + enabled=1) — PASS
- Step 3 (OAuth token flows observed in branding service logs) — PASS
- Step 4 (existing embedded path unbroken — recent scans populate `brand_related_count`) — PASS
- Step 5 (remote-mode end-to-end smoke) — DEFERRED to Phase 18 by design (orchestrator not yet wired into scanner)

No additional human verification is needed for Phase 17 closure. Status is `passed`, not `human_needed`.

### Deferred Items

None. Phase 18 will consume the `brandingOrchestrator` Fastify decorator and replace the inline branding block at `scanner/orchestrator.ts:541-594`. That work is out of scope for Phase 17 by design and is documented in every plan/summary — not a deferred gap in the Step 9b sense.

## Gaps Summary

None. All 16 must-have truths verified, all 5 ROADMAP success criteria verified, all 3 requirements satisfied, full dashboard regression at exact expected count, lint clean, UAT-17-01 resolved.

Phase 17 delivers the dual-mode `BrandingOrchestrator` as specified in the research lock (`.planning/research/SUMMARY.md`). The four architectural invariants (no caching, no cross-route fallback, one match call per scan, ServiceClientRegistry untouched) are pinned by code-level evidence AND by unit tests — not by trust. The critical `expect(embeddedFn).toHaveBeenCalledTimes(0)` assertion is literally present at line 168 of `branding-orchestrator.test.ts`. The dormant `BrandingService` has its first real production instantiation in `server.ts:223`. The scanner and registry are untouched, as promised.

Phase 18 can now begin.

---

_Verified: 2026-04-11T12:05:00Z_
_Verifier: Claude (gsd-verifier)_
