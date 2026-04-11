# Phase 17 Plan Check — Branding Orchestrator

**Checked:** 2026-04-10
**Phase:** 17 — Branding Orchestrator
**Plans:** 17-01 (Wave 1), 17-02 (Wave 2), 17-03 (Wave 3)
**Verdict:** **PLAN CHECK PASSED**

---

## Executive Summary

All three plans are goal-backward coherent, complete, and aligned with the ROADMAP success criteria, the REQUIREMENTS.md traceability matrix, and the locked architectural decisions from research (no caching, no silent cross-route, ServiceClientRegistry unchanged). The most load-bearing invariant of v2.11.0 — "a failing remote adapter MUST NOT invoke the embedded adapter" — is explicitly pinned by a vitest unit test with a `toHaveBeenCalledTimes(0)` assertion in plan 17-03, Test 4. The plans are ready for execution.

---

## Requirements Coverage (Dimension 1)

| Requirement | ROADMAP trace | Plan(s) covering (frontmatter) | Covering task(s) | Status |
|---|---|---|---|---|
| BMODE-01 | Phase 17 | 17-01 (`requirements: [BMODE-01]`), 17-02 (`requirements: [BMODE-01]`) | 17-01/T1 (interface), 17-01/T2 (EmbeddedBrandingAdapter), 17-02/T1 (RemoteBrandingAdapter) | COVERED |
| BMODE-02 | Phase 17 | 17-03 (`requirements: [BMODE-02, BMODE-05]`) | 17-03/T1 (BrandingOrchestrator + per-request `getBrandingMode`), 17-03/T3 (server.ts DI) | COVERED |
| BMODE-05 | Phase 17 | 17-03 (`requirements: [BMODE-02, BMODE-05]`) | 17-03/T1 (`kind: 'degraded'` tagged-union return), 17-03/T2 tests 4/5/6 (no cross-route, reason tags) | COVERED |

Every ROADMAP requirement ID for Phase 17 appears in at least one plan's `requirements:` frontmatter. REQUIREMENTS.md rows for BMODE-01/02/05 all map to Phase 17 exclusively — no out-of-phase drift.

---

## ROADMAP Success Criteria — Goal-Backward Trace

| # | ROADMAP Success Criterion | Addressed By | Evidence |
|---|---|---|---|
| 1 | `BrandingAdapter` interface, both adapters return same `BrandedIssue[]` shape | 17-01 T1 + T2, 17-02 T1 | Interface at `branding-adapter.ts` with single `matchForSite` method; both adapters declare `implements BrandingAdapter`. 17-01 grep acceptance pins the interface, 17-02 grep acceptance pins the implements clause. |
| 2 | `EmbeddedBrandingAdapter` is mechanical extraction, same output | 17-01 T2 + T3 | Task 2 replicates scanner/orchestrator.ts:541-594 semantics with static import. Task 3 contract test compares `adapter.matchForSite()` to `new BrandingMatcher().match()` with `toEqual` — proves transparent wrapper. |
| 3 | `RemoteBrandingAdapter` instantiates `BrandingService` via `ServiceClientRegistry.getBrandingTokenManager()`; registry UNCHANGED | 17-02 T1 (adapter), 17-03 T3 (wiring) | 17-03/T3 action: `new BrandingService(config, getBrandingTokenManager)`; 17-03 acceptance pins `git diff packages/dashboard/src/services/service-client-registry.ts` returns empty. No plan's `files_modified` includes the registry. |
| 4 | `matchAndScore` reads `orgs.branding_mode` per-request, calls calculator, returns unified result; NO caching | 17-03 T1 + T2 Test 3 | Orchestrator body reads `this.orgRepository.getBrandingMode(input.orgId)` at start of every call. Test 3 flips mode between two calls via `makeMockOrgRepo(['embedded', 'remote'])` and asserts both adapters called once + `getBrandingMode` called twice. Acceptance criterion: `grep -ic "cache\|memo"` on orchestrator file returns 0 (doc-only mention allowed with strict regex). |
| 5 | Remote adapter throw returns `degraded` tagged with mode + reason; explicit unit test proves embedded NOT invoked | 17-03 T1 (try/catch with no else branch) + T2 Test 4 | Test 4: mocks remote to throw `ECONNREFUSED`, asserts `result.kind === 'degraded'`, `result.reason === 'remote-unavailable'`, AND `expect(embeddedFn).toHaveBeenCalledTimes(0)`. Test 5 repeats for `RemoteBrandingMalformedError` with `reason='remote-malformed'` and the same 0-calls assertion. |

All 5 criteria are addressed with named tasks and verifiable assertions.

---

## Critical Invariant Checks

### 1. No-silent-cross-route (the single most important test)

**Required:** Unit test in 17-03 that (a) sets remote mode, (b) makes remote adapter throw, (c) asserts `{ kind: 'degraded', mode: 'remote', ... }`, (d) asserts `embeddedAdapter.matchForSite` called 0 times.

**Verified:** 17-03 Plan Task 2, Test 4 (`"CRITICAL: remote throw does NOT invoke the embedded adapter"`):
- Mock `OrgRepository` returns `'remote'`
- Remote adapter rejects with `new Error('ECONNREFUSED 127.0.0.1:4300')`
- Asserts `result.kind === 'degraded'`, `result.mode === 'remote'`, `result.reason === 'remote-unavailable'`, `result.error.includes('ECONNREFUSED')`
- **`expect(embeddedFn).toHaveBeenCalledTimes(0)`** — explicitly labeled as "THE most important assertion in Phase 17"

Additionally Test 5 repeats the zero-call assertion for `RemoteBrandingMalformedError` → `reason='remote-malformed'`. Test 6 repeats for embedded-error → `reason='embedded-error'` with `expect(remoteFn).not.toHaveBeenCalled()`.

The orchestrator source in Task 1 has exactly one `try { ... } catch { return { kind: 'degraded', ... } }` block with **no else branch** trying the other adapter. The acceptance criterion `grep -c "kind: 'degraded'"` pins the return construction.

**PASS.**

### 2. No-cache invariant

**Required:** Acceptance criterion `grep -ic "cache|memo"` returning 0 on orchestrator file, AND a unit test that flips mode between two calls and asserts each adapter was called exactly once.

**Verified:**
- 17-03 Task 1 acceptance criterion: `grep -c "this\.\(cache\|memo\)\|const\s\+\(cache\|memo\)"` returns 0 (strict regex that excludes doc comments). The JSDoc contains "NO CACHING" directive, which the acceptance rule explicitly accepts as a documentation annotation.
- 17-03 Task 2 Test 3 ("per-request mode read"): constructs `makeMockOrgRepo(['embedded', 'remote'])` — a queue that returns embedded on call 1 and remote on call 2. Two back-to-back `matchAndScore(FIXTURE_INPUT)` calls. Asserts `getBrandingMode` called twice, embedded called once, remote called once. Cannot pass if the orchestrator memoizes mode.

**PASS.**

### 3. ServiceClientRegistry unchanged

**Required:** `files_modified` across all 3 plans must NOT include `service-client-registry.ts`; 17-03 must assert `git diff` returns empty.

**Verified:** Grepped all three plans' `files_modified` lists:
- 17-01: `branding-adapter.ts`, `embedded-branding-adapter.ts`, test file
- 17-02: `remote-branding-adapter.ts`, test file
- 17-03: `branding-orchestrator.ts`, `server.ts`, test file

Registry is absent from all three. 17-03 Task 3 acceptance criterion explicitly requires `git diff packages/dashboard/src/services/service-client-registry.ts` returns empty. 17-03 verification block repeats this. The registry's existing `getBrandingTokenManager()` getter is reused (grep-pinned) but not modified.

**PASS.**

### 4. scanner/orchestrator.ts unchanged in Phase 17

**Required:** `files_modified` across all 3 plans must NOT include `scanner/orchestrator.ts`; Phase 18 owns the rewire.

**Verified:**
- None of the three `files_modified` lists include `scanner/orchestrator.ts`.
- 17-01 explicitly creates the EmbeddedBrandingAdapter file that REPRODUCES the inline path with a contract test, and has an explicit `<scope_clarification>` block stating "This plan creates files in isolation. It does NOT touch scanner/orchestrator.ts."
- 17-03 verification block asserts `git diff packages/dashboard/src/scanner/orchestrator.ts` returns empty.
- 17-01 has an acceptance grep `grep -rn "scanner/orchestrator.ts" packages/dashboard/src/services/branding/` returning nothing — the adapter does not reference the scanner.

**PASS.**

### 5. Type translation at the remote boundary

**Required:** 17-02 must have (a) an `isMatchableIssue` type guard, (b) a `RemoteBrandingMalformedError` typed error class, (c) a test proving a malformed response throws the typed error (not silent coerce).

**Verified:** 17-02 Task 1:
- `function isMatchableIssue(value: unknown): value is MatchableIssue` validates all 5 string fields plus `VALID_ISSUE_TYPES.has(o['type'])` (literal-set check).
- `export class RemoteBrandingMalformedError extends Error { constructor(message, public readonly index) }` with named class.
- `translateBrandMatch` separately validates `matched=true` discriminant requires `strategy` in `VALID_STRATEGIES` set and all 3 other string fields present — throws `RemoteBrandingMalformedError` on mismatch.
- Test 3 (missing `code` field), Test 4 (invalid `type`), Test 5 (matched=true missing strategy), Test 6 (strategy outside valid set), Test 10 (index points to offending row) — all assert `rejects.toBeInstanceOf(RemoteBrandingMalformedError)`.
- Test 7 proves network errors (`ECONNREFUSED`) propagate as-is and are NOT wrapped in `RemoteBrandingMalformedError` via `rejects.not.toBeInstanceOf(RemoteBrandingMalformedError)`.

Also: `BrandingService.matchIssues` signature confirmed from `branding-service.ts:59`: `async matchIssues(issues: unknown[], siteUrl: string, orgId: string): Promise<BrandedIssueResponse[]>` — the adapter passes `rawIssues: unknown[]` on the way out and validates on the way back, matching the existing `branding-client.ts` loose shape at line 45-47 (`readonly issue: Record<string, unknown>`).

**PASS.**

### 6. EmbeddedBrandingAdapter behavior preservation

**Required:** 17-01 contract test uses same fixture inputs as inline path, asserts adapter output matches direct `BrandingMatcher.match()` output.

**Verified:** 17-01 Task 3 Test 1:
```js
const direct = new BrandingMatcher().match(FIXTURE_ISSUES, FIXTURE_GUIDELINE);
const viaAdapter = await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
expect(viaAdapter).toEqual(direct);
```

The fixture uses the Aperol brand guideline + a WCAG contrast issue with the Aperol Orange hex (`#FF6900`) in the issue context — realistic shape matching what the scanner passes downstream. The adapter source confirms static import of `BrandingMatcher` (grep `^import { BrandingMatcher } from '@luqen/branding'` returns 1) vs. the dynamic `await import(...)` in the inline path (grep `await import` on the adapter file returns 0).

One note: the inline scanner path at 541-594 also performs a dashboard-record → `BrandGuideline` projection (colors/fonts/selectors shape mapping at 561-575). The plan's adapter does NOT encapsulate that projection — instead, the orchestrator's caller (Phase 18, not Phase 17) will be responsible for passing a pre-projected `BrandGuideline` to `matchForSite`. The 17-01 `<interfaces>` block explicitly calls this out: "The Embedded adapter encapsulates THIS projection PLUS the `matcher.match(...)` call" — but the actual implementation in Task 2 only delegates to `this.matcher.match(issues, guideline)` with `guideline` passed in as already-projected. This is a minor intra-plan documentation-vs-code discrepancy, not a blocker: the orchestrator pattern makes the projection the caller's responsibility, and Phase 18 will handle it when it rewires `scanner/orchestrator.ts`. Noted as an INFO item (see Recommendations) — the 17-01 `<interfaces>` doc-prose can be sharpened to say "the adapter encapsulates the matcher.match call; projection is the orchestrator's caller responsibility." No plan revision needed.

**PASS** (with info-level doc nit).

### 7. DI wiring in server.ts

**Required:** 17-03 Task 3 must (a) instantiate `BrandingService` with `() => serviceClientRegistry.getBrandingTokenManager()` via the existing getter, (b) construct all three objects with constructor injection, (c) avoid new module-level singletons.

**Verified:** 17-03 Task 3:
- Uses the existing `getBrandingTokenManager` getter captured at server.ts:197-198 (read_first explicitly instructs reading lines 175-220 first).
- Construction: `new BrandingService(config, getBrandingTokenManager)` — passes the function reference, matching `BrandingService` constructor signature confirmed at `branding-service.ts:59` (takes `BrandingTokenManagerGetter`).
- `new EmbeddedBrandingAdapter()` zero-arg → `new RemoteBrandingAdapter(brandingService)` → `new BrandingOrchestrator(storage.organizations, embeddedBrandingAdapter, remoteBrandingAdapter)` — all in a single Fastify plugin scope (local `const`, not module-level).
- Exposed via `server.decorate('brandingOrchestrator', brandingOrchestrator)` — the existing Fastify decorator pattern (matches serviceClientRegistry decorate at line 191).
- Task explicitly states "Do NOT introduce a new fastify.d.ts module-augmentation file in this plan — Phase 18 will own that when it actually consumes the decorator," which defers type augmentation correctly.
- `grep -c "new BrandingService(config, getBrandingTokenManager)"` acceptance criterion pins the exact construction pattern.

`OrgRepository` injection: the orchestrator takes `storage.organizations` — this is the Phase 16 `OrgRepository` instance already attached to the storage object. The `<interfaces>` block confirms `getBrandingMode(orgId: string): Promise<'embedded' | 'remote'>` is the Phase 16-03 signature.

**PASS.**

### 8. UAT-17-01 Checkpoint structure

**Required:** The checkpoint should be a `<task type="checkpoint:...">` block (not an `auto` task with `autonomous: false`), with clear WHAT, HOW, and blocking-gate semantics.

**Verified:**
- 17-03 frontmatter has `autonomous: false` flag on the plan — correct for a plan that contains a human-verify checkpoint.
- Task 4 is declared as `<task type="checkpoint:human-verify" gate="blocking">` — correct GSD checkpoint syntax, not an auto task with autonomous override.
- WHAT is clear: "Before this phase is considered DONE, the user must manually verify the @luqen/branding service is running on lxc-luqen and the dashboard's BrandingService can reach its /api/v1/match endpoint via the existing OAuth client."
- HOW is concrete: 5 explicit steps with exact commands — curl to `http://localhost:4300/api/v1/health`, sqlite3 query for `service_connections` row, `journalctl` grep for registry startup log, manual UI scan, optional remote-mode flip via SQL.
- Gate is blocking: "Steps 1-4 MUST PASS for Phase 17 to be considered DONE. Step 5 is informational and may be deferred to Phase 19."
- `<resume-signal>` clearly documented: "Type 'approved' if steps 1-4 passed".
- Also documented in frontmatter as a `human_verification.id: UAT-17-01` block (redundant but helpful).

**PASS.**

### 9. Anti-shallow sampling

Sampled 2 tasks per plan:

| Task | `<read_first>`? | Concrete `<action>`? | Grep/test verifier? |
|---|---|---|---|
| 17-01 T1 (interface) | Yes — 3 files | Yes — full TypeScript source block | Yes — 5 grep assertions + `npm run lint` |
| 17-01 T3 (contract test) | Yes — 4 files incl. matcher | Yes — full 150-line test source | Yes — `vitest run` on test file + 2 grep assertions |
| 17-02 T1 (RemoteBrandingAdapter) | Yes — 4 files | Yes — full 120-line source with type guard | Yes — 8 grep assertions |
| 17-02 T2 (10 tests) | Yes — 4 files | Yes — full 200-line test with all 10 cases | Yes — `vitest run` + 4 grep assertions |
| 17-03 T1 (orchestrator class) | Yes — 6 files | Yes — full 180-line class source | Yes — 8 grep assertions + lint |
| 17-03 T3 (server.ts wiring) | Yes — 5 files incl. exact line range | Yes — exact insertion point + code block | Yes — 7 grep assertions + `git diff` empty assertion + full vitest run |

All sampled tasks have concrete code, explicit read_first, and runnable verify commands. No "follow the pattern" placeholders. Action blocks contain the exact source to write, not prose summaries.

**PASS.**

### 10. Threat models

All three plans contain `<threat_model>` blocks with Trust Boundaries + STRIDE register:
- 17-01: 4 STRIDE rows (T-17.1-01..04)
- 17-02: 6 STRIDE rows (T-17.2-01..06) — covers tampering via malformed response, information disclosure via OAuth, DoS via unreachable service, spoofing, repudiation, elevation via orgId passthrough
- 17-03: 7 STRIDE rows (T-17.3-01..07) — including T-17.3-07 explicitly named "Cross-route data corruption" linked to Test 4 assertion

All threats have dispositions (accept/mitigate) with concrete mitigation links to code or tests.

**PASS.**

### 11. Build tooling convention

All plan acceptance criteria use `npm run lint` and `npx vitest run` — no `pnpm` or `yarn` references. Matches project convention.

**PASS.**

### 12. 17-03 task count and wave assignment

**Required:** Plan 17-03 has 4 tasks: 3 auto + 1 checkpoint.

**Verified:**
- Task 1 (`type="auto"`): BrandingOrchestrator class
- Task 2 (`type="auto" tdd="true"`): 10-test orchestrator suite
- Task 3 (`type="auto"`): server.ts DI wiring
- Task 4 (`type="checkpoint:human-verify" gate="blocking"`): UAT-17-01

Wave=3, depends_on=[17-01, 17-02] — correct (depends on both earlier waves). `autonomous: false` on the plan (because of the checkpoint).

**PASS.**

### 13. Dependency graph

- 17-01: wave 1, depends_on=[] → valid Wave 1
- 17-02: wave 2, depends_on=[17-01] → valid Wave 2 (needs the BrandingAdapter interface from 17-01)
- 17-03: wave 3, depends_on=[17-01, 17-02] → valid Wave 3 (needs both adapters)

No cycles. No forward references. Wave numbers match max(deps)+1.

**PASS.**

### 14. Context Compliance — locked research decisions

Checked against research/SUMMARY.md decisions implied in PROJECT.md and the plan-level invariants:

| Locked Decision | Plan Compliance |
|---|---|
| No caching of `branding_mode` | Pinned in 17-03 T1 JSDoc (INVARIANT 1), T2 Test 3, acceptance grep |
| No silent cross-route fallback | Pinned in 17-03 T1 JSDoc (INVARIANT 2), T2 Test 4, T2 Test 5 |
| ServiceClientRegistry unchanged | Pinned in 17-02 frontmatter + 17-03 T3 acceptance + `git diff` verify |
| scanner/orchestrator.ts unchanged in Phase 17 | Pinned in 17-01 scope_clarification + 17-03 verification + `git diff` verify |
| One match call per scan (Pitfall #10) | Pinned in 17-03 T1 INVARIANT 3 + T2 calculator test uses orchestrator result, no second match |

No scope reductions detected. No `v1`/`v2`/`simplified`/`static for now`/`stub` language in any task action. All decisions delivered in full.

**PASS.**

### 15. CLAUDE.md Compliance

Project CLAUDE.md rules checked:
- GSD workflow — all three plans follow the standard `<task>` + frontmatter structure. PASS.
- Tech stack (TypeScript, Fastify, existing capability/adapter patterns — no new frameworks) — all three plans use existing patterns: constructor injection, Fastify decorate, vitest, existing `BrandingService` class. No new frameworks introduced. PASS.
- Auth (OAuth2 client credentials) — RemoteBrandingAdapter reuses the existing `getBrandingTokenManager()` chain; no new auth surface. PASS.
- Fallback (graceful degradation when LLM unavailable) — NOTE: this Luqen rule is about LLM; the analogous Phase 17 rule is "graceful degradation when branding service unavailable" and is explicitly the `degraded` tagged-union return. PASS.
- Compatibility (no breaking changes to compliance/branding services) — verified: zero modifications to `compliance-service.ts`, `branding-service.ts`, or `service-client-registry.ts`. The only consumer of the new decorator is Phase 18. PASS.
- Immutability — orchestrator result types are all `readonly`. Test fixtures are `readonly`. No mutation. PASS.
- File organization (200-400 typical) — planned line counts: adapter ~50 + ~80 + ~120 + ~180 orchestrator + ~150 + ~200 + ~350 tests. All under 400. PASS.

**PASS.**

### 16. Scope Sanity

| Plan | Tasks | Files modified | Wave | Risk |
|---|---|---|---|---|
| 17-01 | 3 | 3 new files | 1 | Low |
| 17-02 | 2 | 2 new files | 2 | Low |
| 17-03 | 4 (3 auto + 1 checkpoint) | 2 new + 1 modified (server.ts delta ~20 lines) | 3 | Low-moderate (most load-bearing plan, but bounded) |

Total: 9 tasks across 3 plans, ~8 files, all scoped under the 4-task/plan soft cap (17-03 has 4 but one is a checkpoint). Context budget comfortable.

**PASS.**

---

## Minor Observations (non-blocking)

1. **17-01 `<interfaces>` doc-vs-code nit.** The `<interfaces>` prose says "The Embedded adapter encapsulates THIS projection PLUS the `matcher.match(...)` call — the whole 'given a dashboard guideline record, run the in-process matcher against issues' responsibility." But the Task 2 code takes a pre-projected `BrandGuideline` (the `@luqen/branding` shape) and does NOT encapsulate the dashboard-record projection. This is the correct design (keeps I/O out of the adapter, pushes projection to the caller in Phase 18), but the prose should be sharpened. **No revision required** — Phase 18's plan checker will catch it if the ambiguity surfaces there. Info only.

2. **17-03 Task 1 cache-grep acceptance.** The acceptance criterion is written in two forms: a case-insensitive `grep -ic "cache\|memo"` which is allowed to match the JSDoc "NO CACHING" directive, and a stricter positive regex `grep -c "this\.\(cache\|memo\)\|const\s\+\(cache\|memo\)"` which must return 0. The plan correctly notes the distinction. This is fine but slightly verbose; a simpler approach would be a single strict regex. Info only.

3. **Fastify decorator type augmentation deferred.** 17-03 Task 3 defers type augmentation for the `brandingOrchestrator` decorator to Phase 18, using `@ts-expect-error` in the interim. This is an acceptable deferral (Phase 18 is the first consumer) but Phase 18's plan checker should flag it as a MUST-FIX for that phase. Info for the Phase 18 planner.

None of these require plan revision before execution.

---

## Verification Dimension Summary

| Dimension | Status |
|---|---|
| 1. Requirement Coverage (BMODE-01/02/05) | PASS |
| 2. Task Completeness (read_first + action + verify + done) | PASS |
| 3. Dependency Correctness (acyclic, wave-consistent) | PASS |
| 4. Key Links Planned (interface → impls → orchestrator → server) | PASS |
| 5. Scope Sanity (3/2/4 tasks, ~8 files) | PASS |
| 6. Verification Derivation (user-observable truths in must_haves) | PASS |
| 7. Context Compliance (locked decisions honored) | PASS |
| 7b. Scope Reduction Detection (no v1/simplified/stub language) | PASS |
| 8. Nyquist Compliance | N/A (no VALIDATION.md; phase has unit-test-backed automated verify on every task) |
| 9. Cross-Plan Data Contracts (BrandedIssue[] shape consistent) | PASS |
| 10. CLAUDE.md Compliance | PASS |
| 11. Research Resolution | N/A (no RESEARCH.md Open Questions section) |

---

## Final Verdict

**PLAN CHECK PASSED.**

All three plans are execution-ready. The core behavioral-correctness invariants of Phase 17 — per-request mode read, no silent cross-route fallback, ServiceClientRegistry unchanged, scanner/orchestrator.ts unchanged, type-safe remote response translation — are all pinned by explicit acceptance criteria and vitest assertions. The UAT-17-01 checkpoint is properly structured as a blocking human-verify task gating phase completion on branding service liveness.

The orchestrator (17-03) is the highest-stakes plan in v2.11.0 and its Test 4 (`expect(embeddedFn).toHaveBeenCalledTimes(0)` after a remote rejection) is the load-bearing assertion for trend data integrity. That assertion is present, explicit, and labeled as critical in both the plan prose and the test source.

**Recommended next action:** `/gsd-execute-phase 17` — proceed to execution.

