# Phase 19 — Plan Check Report

**Phase:** 19 — Admin UI (Mode Toggle)
**Plans checked:** 19-01, 19-02, 19-03
**Verdict:** PLAN CHECK NEEDS REVISION (2 blockers, 3 warnings, 2 info)

---

## Verdict Summary

Phase 19 plans are overwhelmingly strong. The goal-backward trace from the ROADMAP's 5 success criteria lands on specific tasks in specific plans with verbatim action blocks, grep-based acceptance criteria, and test assertions that lock in the highest-stakes behaviors (Pitfall #5, two-step confirmation DB invariant, structural parity). The `<permission_decision>` block in 19-01 correctly addresses the known spec/code drift (`organizations.manage` → `admin.system`), and 19-02 enforces the Pitfall #5 contract with both code-level greps and behavior-level `toHaveBeenCalledTimes(1)` spies.

Two blockers prevent a clean PASS:

1. Plan 19-03's `files_modified` frontmatter is out of sync with the plan body (missing `organizations.ts`, spurious `sidebar.hbs`).
2. Plan 19-02's `declare module 'fastify'` snippet collides with a pre-existing non-optional declaration in `branding-guidelines.ts:20-24`, making the `if (orchestrator === undefined)` branch dead code under strict TS and producing a declaration-merge error if the executor naively drops in the action block without the "check first" qualifier.

Both are low-effort fixes, but they must be resolved before execution burns context.

---

## Goal-Backward Trace (ROADMAP Criteria → Plan Coverage)

| ROADMAP Criterion | Verified by | Status |
|-------------------|-------------|--------|
| 1. Toggle radio with two-step confirm modal explaining next-scan semantics | 19-01 Task 1 (partial 'form'/'confirm' branches) + Task 2 (POST `_confirm` branch) + Task 3 Test 3 (DB-unchanged invariant) | COVERED |
| 2. "Reset to system default" sets `branding_mode='embedded'` via same confirm flow | 19-01 Task 2 (`rawMode === 'default'` → `'embedded'`) + Task 3 Test 5 (`mode=default` → `'embedded'` persisted) | COVERED |
| 3. Permission gate server-side, not CSS; other users see read-only | 19-01 Task 2 (`requirePermission('admin.system')` on GET AND POST) + Task 3 Tests 2 & 6 (viewer → 403 on both verbs). Read-only shape exists as partial branch C but is unused — `<permission_decision>` explains the rationale (403 IS server-side enforcement) | COVERED (with documented simplification) |
| 4. Test-connection routes through `BrandingOrchestrator.matchAndScore()` with `routedVia` | 19-02 Task 2 (`orchestrator.matchAndScore` call, `routedVia: result.mode` mapping) + Task 3 (5 tests, each asserts `toHaveBeenCalledTimes(1)` and `routedVia` comes from stub's `mode` field) | COVERED — with TS declaration hazard (see Blocker #2) |
| 5. Branding in System Health + sidebar with parity patterns | 19-03 Task 1 (`brandingKeys.toEqual(complianceKeys)` + `toEqual(llmKeys)`) + Task 2 Part B (sidebar parity test — all three services + permission gate) | COVERED — pre-satisfied by existing code, locked by tests |

---

## Dimension Results

### Dimension 1: Requirement Coverage — PASS

| Requirement | In which `requirements:` fields | Task coverage |
|-------------|-------------------------------|----------------|
| BMODE-03 | 19-01, 19-03 | 19-01 Tasks 1-3 (toggle, routes, tests) + 19-03 Task 3 (REQUIREMENTS.md traceability) |
| BMODE-04 | 19-02 | 19-02 Tasks 1-3 (partial extension, route, tests) |
| BUI-04 | 19-03 | 19-03 Tasks 1-2 (system parity test, sidebar parity test + orgRowHtml link) |

All 3 phase requirements appear in at least one plan's `requirements` frontmatter.

### Dimension 2: Task Completeness — PASS

All 9 tasks (3 per plan) have `<files>`, `<read_first>`, `<behavior>`, `<action>`, `<verify><automated>`, `<acceptance_criteria>`, `<done>`. Action blocks contain verbatim source — no "follow the pattern" placeholders.

### Dimension 3: Dependency Correctness — PASS

```
19-01 (wave 1, depends_on=[])
19-02 (wave 2, depends_on=[19-01])
19-03 (wave 3, depends_on=[19-01, 19-02])
```

Acyclic. Wave numbers consistent with depends_on. No forward refs.

### Dimension 4: Key Links Planned — PASS

All `key_links` in each plan's `must_haves` have implementing code in a task action:

- 19-01: `orgRowHtml`-style route → `storage.organizations.{get,set}BrandingMode` (Task 2 action), `body._confirm` check (Task 2 action), `requirePermission('admin.system')` (Task 2 action).
- 19-02: `orchestrator.matchAndScore` direct call (Task 2 action), `result.kind === 'matched'|'degraded'|'no-guideline'` tagged-union mapping (Task 2 action), spy assertion (Task 3 verbatim).
- 19-03: `server.inject GET /admin/system` asserting `services.branding` (Task 1 verbatim), `handlebars.compile` on sidebar partial with `perm.brandingView` context (Task 2 Part B verbatim).

### Dimension 5: Scope Sanity — PASS

| Plan | Tasks | Files modified | Largest action block |
|------|-------|----------------|----------------------|
| 19-01 | 3 | 3 | ~250-line test file (verbatim) |
| 19-02 | 3 | 3 | ~250-line test file (verbatim) |
| 19-03 | 3 | 4 (but see Blocker #1 — actually 4 modified, frontmatter drift) | ~120-line parity test |

All plans at 3 tasks — within the 2-3 target. No plan exceeds the warning threshold.

### Dimension 6: Verification Derivation — PASS

Truths are user-observable for the most part ("Admin visits GET ... and sees ...", "Non-admin user receives 403", "routedVia reflects the adapter that actually ran"). Artifacts map to truths. Key links cover critical wiring.

Minor nit (not a gap): 19-02 truth line mentions "BrandingMatchContext + BrandGuideline" — the orchestrator input type is actually `MatchAndScoreInput`, and `BrandingMatchContext` is the adapter-level context. The action block constructs the correct `MatchAndScoreInput` shape, so this is wording drift in the truth, not a code error.

### Dimension 7: Context Compliance — N/A

No CONTEXT.md was provided in the verification prompt. The planner-surfaced permission decision (`admin.system` vs ROADMAP's `organizations.manage`) is addressed via the in-plan `<permission_decision>` block rather than CONTEXT.md.

### Dimension 7b: Scope Reduction Detection — PASS

No "v1/v2", "simplified", "hardcoded for now", or "placeholder" language anywhere in the three plans. The closest near-miss is 19-03's scope_clarification which says the sidebar is NOT modified because discoverability is delivered via the org list row link instead — this is a reasoned substitution, not a reduction of BUI-04's requirement (the parity test still proves the sidebar branding entries render with compliance/llm). The followup todos in plan SUMMARY outputs are genuinely out of scope (audit logs, `organizations.*` permission introduction, i18n sweep), not silent simplifications.

### Dimension 8: Nyquist Compliance — PASS (no VALIDATION.md required)

Every task has `<automated>` in `<verify>` using `npx vitest run`, `grep -c`, or `test -f`. Wave 1 is the TDD authoring wave — tests are written and run in the same task as the code they verify (`tdd="true"`). No long-running E2E, no watch-mode flags. Sampling is 100% (9/9 tasks automated).

Check 8e (VALIDATION.md existence): the phase directory does not contain a RESEARCH.md with a "Validation Architecture" section, so the VALIDATION.md gate does not apply.

### Dimension 9: Cross-Plan Data Contracts — PASS

All three plans touch `packages/dashboard/src/routes/admin/organizations.ts` and two of them (19-01, 19-02) touch `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs`. Because the waves are strictly sequential (1 → 2 → 3) and each plan appends to (rather than replaces) the previous plan's output, there is no contract conflict:

- 19-01 creates `organizationRoutes` extension with GET+POST /branding-mode and creates the partial with `{form,readonly,confirm}` branches.
- 19-02 appends ONE new POST /branding-test route and adds a `{testResult}` branch to the same partial. Zero overlap with 19-01's routes or partial branches.
- 19-03 edits `orgRowHtml` (a single function untouched by 19-01/19-02) and creates two new test files. Zero overlap with 19-01/19-02's diffs.

No shared-data transformation conflicts. The partial's four render branches (`form`, `readonly`, `confirm`, `testResult`) are orthogonal — the route handler picks one by passing the right top-level key.

### Dimension 10: CLAUDE.md Compliance — PASS

The repo's CLAUDE.md only mandates the GSD workflow (already being used), lists tech constraints (TypeScript/Fastify — matches), and is otherwise stub content. All three plans use the project's established patterns: `requirePermission`, `reply.view`, existing CSS classes from `card`/`status-indicator`/`btn--*`, `toastHtml`/`escapeHtml` helpers, `npx vitest`/`npm run lint`, `@luqen/branding` types from the monorepo package. No forbidden patterns introduced.

### Dimension 11: Research Resolution — N/A

Phase 19 does not have a `RESEARCH.md`; it builds on Phase 17's shipped orchestrator and Phase 16's shipped OrgRepository. No open questions to resolve.

---

## Per-File Sanity Checks

Verified against the actual codebase:

| Assumption | File/line | Status |
|------------|-----------|--------|
| `orgRowHtml` exists at line 10-27 of organizations.ts, takes Organization, returns string | `packages/dashboard/src/routes/admin/organizations.ts:10-27` | CORRECT |
| `organizationRoutes` signature with 6 args | `packages/dashboard/src/routes/admin/organizations.ts:29-38` | CORRECT |
| `requirePermission(...permissions: string[])` in auth/middleware.ts | `packages/dashboard/src/auth/middleware.ts:51-70` | CORRECT |
| `system.ts` passes `services.branding: { status, label: 'Branding Service' }` to the template | `packages/dashboard/src/routes/admin/system.ts:113-119` | CORRECT |
| `systemRoutes(server, { complianceUrl, brandingUrl?, webserviceUrl?, dbPath }, getLLMClient?)` signature | `packages/dashboard/src/routes/admin/system.ts:25-30` | CORRECT (19-03 test harness matches) |
| `BrandingOrchestrator.matchAndScore(MatchAndScoreInput)` returns `MatchAndScoreResult` tagged union with `{kind, mode, ...}` | `packages/dashboard/src/services/branding/branding-orchestrator.ts:46-78` | CORRECT |
| `BrandGuideline` fields: `{id, orgId, name, version, active, colors[], fonts[], selectors[]}` | `packages/branding/src/types.ts:9-22` | CORRECT |
| `MatchableIssue` fields: `{code, type, message, selector, context}` | `packages/branding/src/types.ts:74-80` | CORRECT |
| `BrandColor` requires `hexValue`, `BrandFont` requires `family` | `packages/branding/src/types.ts:24-30, 34-40` | CORRECT |
| `reply.view('admin/partials/...')` is a supported render path | `packages/dashboard/src/routes/admin/llm.ts:670, 709` | CORRECT (precedent exists) |
| Handlebars `eq` helper registered globally | `packages/dashboard/src/server.ts:365` | CORRECT |
| CSRF is enforced by global preHandler on all state-changing methods | `packages/dashboard/src/server.ts:711-722` | CORRECT |
| `admin/partials/` directory exists | `packages/dashboard/src/views/admin/partials/` | CORRECT (contains prompt-diff-modal, service-connection-row, etc.) |

---

## Blockers

### Blocker 1 — Plan 19-03 `files_modified` frontmatter is out of sync with the plan body

**Severity:** blocker (plan checker exit criteria — frontmatter accuracy is a sanity check that drives tooling)

**Finding:**
- Plan 19-03 Task 2 Part A explicitly edits `packages/dashboard/src/routes/admin/organizations.ts` (adds a "Branding Mode" anchor to `orgRowHtml`), but this path is NOT in the frontmatter `files_modified`.
- Plan 19-03 frontmatter DOES list `packages/dashboard/src/views/partials/sidebar.hbs`, but the plan body (scope_clarification explicitly: "No changes to system.hbs — it already satisfies BUI-04" and "no sidebar redesign") plus Task 2 Part B (which only READS sidebar.hbs via `readFileSync` for the parity test) make clear the sidebar is NEVER edited.

**Impact:** Gates downstream tooling that reads files_modified (CI scope checks, merge diff assertions, orchestrator file locks). Also creates confusion for the executor — reading the frontmatter would suggest editing sidebar.hbs.

**Fix:**
```diff
 files_modified:
   - packages/dashboard/tests/routes/admin-system-branding-parity.test.ts
   - packages/dashboard/tests/views/sidebar-branding-parity.test.ts
-  - packages/dashboard/src/views/partials/sidebar.hbs
+  - packages/dashboard/src/routes/admin/organizations.ts
   - .planning/REQUIREMENTS.md
```

Also remove the `path: "packages/dashboard/src/views/partials/sidebar.hbs"` entry from `must_haves.artifacts` (the plan doesn't actually produce this artifact) and add a corresponding artifact for the `orgRowHtml` edit.

### Blocker 2 — Plan 19-02 `declare module 'fastify'` block conflicts with existing non-optional declaration

**Severity:** blocker (TypeScript compile error OR dead-code lint warning depending on how the executor follows the conditional instruction)

**Finding:**
The existing file `packages/dashboard/src/routes/admin/branding-guidelines.ts:20-24` already contains:
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    brandingOrchestrator: BrandingOrchestrator;  // NON-OPTIONAL
  }
}
```

Plan 19-02 Task 2 action block proposes to add:
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    brandingOrchestrator?: BrandingOrchestrator;  // OPTIONAL (?)
  }
}
```

TypeScript declaration merging tolerates multiple `declare module` blocks for the same module, BUT when the same property is declared in both blocks with DIFFERENT modifiers (optional vs required), you get **error TS2717: Subsequent property declarations must have the same type**. The optionality is part of the property's type signature.

The plan DOES include a conditional ("Check first whether any file in `packages/dashboard/src/` already declares `brandingOrchestrator` on the FastifyInstance via `declare module 'fastify'` — if yes, skip this block and only add the `import type` line"). If the executor follows this instruction precisely, they will skip the declaration block — but then the handler's defensive check `const orchestrator = server.brandingOrchestrator; if (orchestrator === undefined) { ... }` becomes **dead code** under the existing non-optional declaration, and strict TS/ESLint setups (`@typescript-eslint/no-unnecessary-condition`) will flag the comparison.

**Impact:** Either a TS compile error (executor copies the block naively) or an ESLint warning (executor follows the "check first" guidance). Both are caught by `npm run lint`, which is in the acceptance criteria — so the plan will fail its own gate but only after burning execution context.

**Fix:** Replace the Task 2 action block's declaration snippet with an explicit directive:

```diff
-First, at the top of the file (after existing imports), add this declaration block. Check first whether any file in `packages/dashboard/src/` already declares `brandingOrchestrator` on the FastifyInstance via `declare module 'fastify'` — if yes, skip this block and only add the `import type` line.
-
-```typescript
-import type { BrandingOrchestrator } from '../../services/branding/branding-orchestrator.js';
-import type { BrandGuideline, MatchableIssue } from '@luqen/branding';
-import { randomUUID } from 'node:crypto';
-
-declare module 'fastify' {
-  interface FastifyInstance {
-    brandingOrchestrator?: BrandingOrchestrator;
-  }
-}
-```
+First, at the top of the file (after existing imports), add these imports. DO NOT add a `declare module 'fastify'` block — the file `packages/dashboard/src/routes/admin/branding-guidelines.ts:20-24` already declares `brandingOrchestrator: BrandingOrchestrator` as a REQUIRED (non-optional) property on FastifyInstance. Re-declaring with `?` would conflict (TS2717). Trust the existing declaration.
+
+```typescript
+import type { BrandGuideline, MatchableIssue } from '@luqen/branding';
+import { randomUUID } from 'node:crypto';
+// NOTE: `server.brandingOrchestrator` is already typed as BrandingOrchestrator
+// via the augmentation in routes/admin/branding-guidelines.ts. No import or
+// re-declaration needed here.
+```
```

AND replace the defensive `if (orchestrator === undefined)` check with a test-only guard. Two options:

(a) **Drop the check entirely** — trust that server startup decorated the orchestrator (it's already required for scanner, branding-retag, graphql resolvers, and branding-guidelines routes to work). If the orchestrator is missing, those pre-existing features are already broken.

(b) **Keep defense-in-depth via a runtime cast**:
```typescript
const orchestrator = (server as unknown as { brandingOrchestrator?: BrandingOrchestrator }).brandingOrchestrator;
if (orchestrator === undefined) { /* ... */ }
```
This sidesteps the type narrowing so the check is not dead code.

Either option is acceptable. Option (a) is cleaner and matches the precedent in `branding-guidelines.ts` (which never checks for undefined either).

The test file (`organizations-branding-test.test.ts`) already decorates a stub `brandingOrchestrator` BEFORE calling `organizationRoutes(server, storage)`, so the test harness never hits the `undefined` path anyway.

---

## Warnings

### Warning 1 — Plan 19-02 Task 1 partial contains invalid HTML + dead code (nested `<input>` in `<button>`)

**Severity:** warning (not a functional bug, but a code smell that would be flagged by any markup linter)

**Finding:**
```handlebars
<button type="button" class="btn btn--secondary"
        hx-post="/admin/organizations/{{org.id}}/branding-test"
        ...
        hx-headers='{"X-CSRF-Token":"{{csrfToken}}"}'>
  <input type="hidden" name="_csrf" value="{{csrfToken}}">
  {{t "admin.org.brandingMode.test.button"}}
</button>
```

A `<button>` element's content model forbids interactive descendants, and `<input>` is interactive content. The hidden input is ALSO dead code — HTMX's `hx-post` on a bare button (outside a `<form>`) does not automatically scrape nested input values, and CSRF is already transmitted via `hx-headers` (the global CSRF hook accepts the `x-csrf-token` header per `packages/dashboard/src/server.ts:711-722` and the `@fastify/csrf-protection` default config).

**Impact:** No functional bug — browsers tolerate the invalid nesting and the header-based CSRF still works — but it's invalid HTML that a future markup/a11y audit would flag, and the executor may be confused into thinking the input is load-bearing.

**Fix:** Remove the nested input entirely:
```diff
 <button type="button" class="btn btn--secondary"
         hx-post="/admin/organizations/{{org.id}}/branding-test"
         hx-target="#branding-test-result"
         hx-swap="outerHTML"
         hx-headers='{"X-CSRF-Token":"{{csrfToken}}"}'>
-  <input type="hidden" name="_csrf" value="{{csrfToken}}">
   {{t "admin.org.brandingMode.test.button"}}
 </button>
```

### Warning 2 — Plan 19-02 truths mention `BrandingMatchContext` where `MatchAndScoreInput` is meant

**Severity:** warning (doc clarity; no code impact)

**Finding:** 19-02 `must_haves.truths` contains "The test-connection handler constructs a minimal synthetic BrandingMatchContext + BrandGuideline at request time". The orchestrator's input type is `MatchAndScoreInput` (`{orgId, siteUrl, scanId, issues, guideline}`), not `BrandingMatchContext` (which is the ADAPTER-level per-call context `{orgId, siteUrl, scanId}` — the guideline is passed separately to `BrandingAdapter.matchForSite`). The action block constructs the correct `MatchAndScoreInput` shape; only the truth wording is imprecise.

**Fix:** Reword the truth to "constructs a minimal synthetic MatchAndScoreInput (orgId + siteUrl + scanId + issues + guideline) at request time".

### Warning 3 — Plan 19-02 defense-in-depth `routedVia: 'unknown'` string slips past the "no hardcoded literal" grep

**Severity:** warning (acceptance criterion drift; still clearly out-of-band, not a lie)

**Finding:** The acceptance criterion `grep -c "routedVia: 'embedded'|routedVia: \"embedded\"|routedVia: 'remote'|routedVia: \"remote\""` returns 0 — but the orchestrator-threw catch branch uses `routedVia: 'unknown'`, which IS a hardcoded string literal (just not one of the two mode enums). The plan acknowledges this in the acceptance criterion text ("the 'unknown' fallback in the orchestrator-threw defense branch is fine because that is not a routedVia enum lie, it is a literal out-of-band marker"), so the test grep passes.

**Impact:** None functionally — the plan has already thought through it. However, if Blocker 2's fix recommendation (a) is chosen (drop the undefined check / trust the orchestrator is always present), the recommendation should ALSO consider whether the orchestrator-threw catch branch still makes sense. The orchestrator contract explicitly says it "returns a degraded result rather than throwing" (plan 19-02 action block comment). A true defensive-to-contract-drift catch is fine, but the `routedVia: 'unknown'` is visibly an out-of-band marker that the frontend partial is NOT prepared to render (the partial's `testResult.routedVia` is always rendered as `<strong>{{testResult.routedVia}}</strong>` — "unknown" would display literally, which is OK but ugly).

**Fix (optional):** Either (a) drop the catch block entirely (contract says orchestrator always returns a result, test coverage enforces this), or (b) render a special-case "orchestrator-threw" branch in the partial with a clearer message than "unknown".

---

## Info (suggestions, not gaps)

### Info 1 — `organizations.ts` churn across all 3 plans is acceptable but worth noting

All three plans edit `packages/dashboard/src/routes/admin/organizations.ts`. Because waves are sequential, there is no conflict risk, but the cumulative diff (two new routes in 19-01, one new route in 19-02, one edited helper in 19-03) pushes the file up in size. Not a blocker, just a reminder to the executor that each plan's edits are append-only at specific positions inside the existing `organizationRoutes` function.

### Info 2 — 19-01 readonly partial branch is "future-proofing" and currently unused

19-01 Task 1's partial has three render branches (`form`/`readonly`/`confirm`) but Task 2's routes only ever render `form` and `confirm`. The plan's scope_clarification explicitly acknowledges this ("The 'readonly' partial branch still exists for future use ... but is unused in this plan"). This is defensible — keeping the branch costs nothing, and a future role that can view but not edit becomes trivial to wire. But the Task 3 tests do NOT cover the readonly branch, so the partial's readonly code path is untested. Consider either:
(a) Deleting the readonly branch entirely and documenting in the SUMMARY that it can be re-added when a lower-privilege view route appears, or
(b) Adding a snapshot test in 19-01 Task 3 that renders the partial with `{mode: 'readonly', ...}` via Handlebars compile (similar to 19-03's sidebar parity test) and asserts the expected HTML structure.

Neither is a blocker — the plan as written will ship working code.

---

## Structured Issues (YAML)

```yaml
issues:
  - plan: "19-03"
    dimension: task_completeness
    severity: blocker
    description: "files_modified frontmatter drift — Task 2 Part A edits organizations.ts (not listed) and the plan body clearly states sidebar.hbs is NOT modified (but it is listed)"
    fix_hint: "Remove sidebar.hbs from files_modified and must_haves.artifacts; add packages/dashboard/src/routes/admin/organizations.ts"

  - plan: "19-02"
    dimension: task_completeness
    severity: blocker
    description: "declare module 'fastify' snippet collides with existing non-optional BrandingOrchestrator declaration in branding-guidelines.ts:20-24; TS2717 if copied naively, or dead-code lint warning on the `if (orchestrator === undefined)` check if skipped per the conditional instruction"
    plan: "19-02"
    task: 2
    fix_hint: "Replace the declare-module block with an explicit 'DO NOT re-declare' note pointing at branding-guidelines.ts:20-24, and either drop the undefined-check entirely or use a runtime cast to preserve the defense without producing dead code"

  - plan: "19-02"
    dimension: task_completeness
    severity: warning
    description: "Task 1 partial places a hidden <input name='_csrf'> inside a <button>, which is invalid HTML (button content model forbids interactive descendants) AND dead code (HTMX doesn't scrape nested inputs from bare buttons; CSRF is already sent via hx-headers)"
    task: 1
    fix_hint: "Remove the <input type='hidden' name='_csrf'> line — hx-headers alone delivers CSRF via the x-csrf-token header which @fastify/csrf-protection accepts"

  - plan: "19-02"
    dimension: verification_derivation
    severity: warning
    description: "must_haves.truths says 'constructs a minimal synthetic BrandingMatchContext + BrandGuideline' but the orchestrator input type is MatchAndScoreInput (not BrandingMatchContext, which is the adapter-level context). The action block's code is correct; only the truth wording drifts."
    fix_hint: "Reword truth to 'constructs a minimal synthetic MatchAndScoreInput (orgId + siteUrl + scanId + issues + guideline)'"

  - plan: "19-02"
    dimension: task_completeness
    severity: warning
    description: "Orchestrator-threw catch branch uses routedVia: 'unknown' which is technically a hardcoded string, though explicitly out-of-band. Partial renders {{testResult.routedVia}} literally — 'unknown' would display to users. Either drop the catch (orchestrator contract says it never throws) or render a dedicated branch for this edge case."
    task: 2
    fix_hint: "Simpler: drop the try/catch since the orchestrator contract says it returns a degraded result rather than throwing. Defense-in-depth belongs in the orchestrator itself, not the caller."

  - plan: "19-01"
    dimension: key_links_planned
    severity: info
    description: "Task 1 partial has a 'readonly' branch that no route in the plan renders; Task 3 tests do not exercise it"
    task: 1
    fix_hint: "Either delete the readonly branch (re-add when a future viewer-role route appears) or add a Handlebars-compile test asserting the readonly branch renders without errors"

  - plan: "all"
    dimension: scope_sanity
    severity: info
    description: "organizations.ts is edited by all 3 plans (append-only at specific positions). Sequential waves prevent conflicts, but the executor should be reminded that each plan's edits are strictly additive at designated insertion points inside organizationRoutes()"
    fix_hint: "No action required; call out in each plan's Task 2 that edits are append-only"
```

---

## Recommendation

**Return to planner with the 2 blockers + 3 warnings listed above.** The warnings are small (one line each to fix) and the blockers are low-effort frontmatter/declaration adjustments. The plans' structural correctness, Pitfall #5 enforcement (the highest-stakes piece of Phase 19), two-step confirmation DB invariant assertion, and BUI-04 structural parity lock are all in place and ready to execute once the revisions ship.

Estimated fix effort: ~15 minutes of planner revision.

