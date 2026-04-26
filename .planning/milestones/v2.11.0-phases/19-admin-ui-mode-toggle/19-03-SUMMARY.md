---
phase: 19-admin-ui-mode-toggle
plan: 03
subsystem: dashboard-admin-ui
tags:
  - bui-04
  - bmode-03
  - admin-ui
  - branding-mode
  - parity-tests
  - discoverability
  - traceability
dependency_graph:
  requires:
    - phase-19-01/admin-branding-mode-route
    - phase-19-02/admin-branding-test-route
    - phase-19-01/permission-decision-admin-system
  provides:
    - tests/routes/admin-system-branding-parity.test.ts
    - tests/views/sidebar-branding-parity.test.ts
    - orgRowHtml 'Branding Mode' anchor (discoverability link)
    - REQUIREMENTS.md BMODE-03 traceability row (admin.system)
  affects:
    - packages/dashboard/src/routes/admin/organizations.ts (orgRowHtml only)
    - .planning/REQUIREMENTS.md (single-row traceability fix)
tech_stack:
  added: []
  patterns:
    - "Handlebars.create() + fs.readFileSync for read-only template render testing (locks the partial without importing server.ts)"
    - "Vitest vi.mock('../../src/compliance-client.js') + dynamic import of the route module AFTER the mock setup (pattern reusable for any other route that imports the compliance-client or branding-client)"
    - "Structural key-set parity assertion: Object.keys(services.branding).sort() deep-equals Object.keys(services.compliance).sort() — catches shape drift without hardcoding field names beyond the belt-and-braces ['label','status'] lock"
key_files:
  created:
    - packages/dashboard/tests/routes/admin-system-branding-parity.test.ts
    - packages/dashboard/tests/views/sidebar-branding-parity.test.ts
  modified:
    - packages/dashboard/src/routes/admin/organizations.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "sidebar.hbs is READ-ONLY fixture input for the parity test — the plan's BUI-04 parity requirement is pre-satisfied by existing sidebar code; this plan LOCKS that parity via Handlebars.compile on the raw file rather than by editing it"
  - "Discoverability of the new /admin/organizations/:id/branding-mode route is delivered via an orgRowHtml anchor in the org list, NOT via a sidebar redesign — keeps Phase 19 scope tight and honors the scope_clarification"
  - "Plan 19-03 Task 3 acceptance grep was internally inconsistent with its own verbatim replacement text (the replacement contained `organizations.manage` but the acceptance grep expected that string gone from the row). Reworded the parenthetical from 'finer-grained `organizations.manage` permission' to 'finer-grained org-scoped manage permission' — same semantics, satisfies the traceability-row grep [Rule 3 auto-fix]"
  - "The new sidebar parity test provides BOTH a positive (all view perms ON → branding anchors visible) and negative (perm.brandingView=false → branding anchors absent) assertion — locks the permission gate direction too, not just presence"
metrics:
  duration: "~6 minutes"
  completed: 2026-04-10
  tasks_completed: 3
  files_created: 2
  files_modified: 2
  new_tests: 4
  full_suite: "2510 passed (+4 new from 19-02 baseline 2506) / 40 skipped / 0 regressions"
requirements_completed:
  - BUI-04
  - BMODE-03
---

# Phase 19 Plan 03: System Health + Sidebar Parity Tests, Discoverability, and Traceability Fix Summary

**One-liner:** Two regression tests lock the BUI-04 structural parity of branding with compliance and LLM (System Health services shape + sidebar render output), an orgRowHtml anchor makes the Plan 19-01 mode-toggle route discoverable from the org list, and REQUIREMENTS.md BMODE-03 is updated to reflect the `admin.system` permission actually used.

## What Was Built

Four deliverables, three commits:

### 1. System Health services shape parity test (Task 1)

File: `packages/dashboard/tests/routes/admin-system-branding-parity.test.ts` (132 lines, 2 tests)

- Spins up a minimal Fastify server with ONLY `systemRoutes` registered (not the full server) and decorates a JSON-returning `reply.view` so assertions inspect `{template, data}` without invoking Handlebars.
- Mocks `../../src/compliance-client.js` and `../../src/branding-client.js` BEFORE the dynamic import of `systemRoutes`, so the health checks return deterministic `{status: 'ok'}` values.
- Wires `ALL_PERMISSION_IDS` into the request via a preHandler hook so `requirePermission('admin.system')` passes.

The two tests:

| # | Test | What it locks |
|---|------|---------------|
| 1 | `services.branding is present and healthy alongside compliance/llm/pa11y/dashboard` | All 5 services present, `services.branding.status === 'ok'`, `services.branding.label === 'Branding Service'` — proves the branding status-normalization path in system.ts:68-76 runs |
| 2 | `services.branding keys are EXACTLY the same as services.compliance and services.llm keys — structural parity lock` | `brandingKeys.toEqual(complianceKeys)` AND `brandingKeys.toEqual(llmKeys)` AND `brandingKeys === ['label', 'status']` — belt-and-braces key-set equality |

**Why this matters for BUI-04:** The existing `system.ts:113-119` already passes branding with the same `{status, label}` shape as compliance and llm. But there is no test locking that. A future refactor (e.g. someone adding a `tooltip` field to compliance only, or extracting branding into a special-cased sub-template) could silently break the parity. Test 2's `toEqual` deep-equality over the full key set catches any drift.

### 2. Sidebar parity test (Task 2 Part B)

File: `packages/dashboard/tests/views/sidebar-branding-parity.test.ts` (117 lines, 2 tests)

- Reads `packages/dashboard/src/views/partials/sidebar.hbs` via `fs.readFileSync` (READ-ONLY).
- Compiles it with a scoped `Handlebars.create()` instance registering the helpers the sidebar uses: `eq`, `startsWith`, `lookup`, `t` (stub that returns the key).
- Renders the template twice with a fixed `BASE_CONTEXT` and different `perm.*` permission sets.

| # | Test | What it locks |
|---|------|---------------|
| 1 | `renders branding + compliance + llm entries when all view permissions are granted` | Both branding anchors (`/admin/branding-guidelines` + `/admin/system-brand-guidelines`) AND compliance anchors (`/admin/jurisdictions` + `/admin/regulations`) AND the LLM anchor (`/admin/llm`) all appear in the rendered HTML — BUI-04 sidebar presence parity |
| 2 | `hides branding entries when perm.brandingView is false — permission gate regression` | Both branding anchors ABSENT, `/admin/jurisdictions` still present — proves the `{{#if perm.brandingView}}` gate is scoped and directional, not total |

**`sidebar.hbs` is NOT modified.** `git diff --stat packages/dashboard/src/views/partials/sidebar.hbs` returns empty. The parity is locked via fixture-compile, not by editing the partial.

### 3. orgRowHtml "Branding Mode" discoverability anchor (Task 2 Part A)

File: `packages/dashboard/src/routes/admin/organizations.ts:13-33` (orgRowHtml only, +3 lines)

Inserted a new anchor between the existing "Members" anchor and the "Delete" button:

```typescript
<a href="/admin/organizations/${encodeURIComponent(org.id)}/branding-mode"
   class="btn btn--sm btn--ghost"
   aria-label="Branding mode for ${org.name}">Branding Mode</a>
```

This is the only edit to `organizations.ts` in this plan — it makes the Plan 19-01 route reachable from the existing `/admin/organizations` list page without requiring admins to type URLs or remember routes. Uses the same CSS classes, interpolation pattern, and `encodeURIComponent` wrapping as the existing Members anchor, so no new XSS surface is introduced (see threat model T-19.3-02 — escaping `org.name` across all orgRowHtml interpolations is an existing codebase issue, out of scope for Phase 19).

Existing `organizations-admin.test.ts` (21 tests) still passes — no test depended on the exact anchor count in the row HTML, so no assertion updates were needed (Task 2 Part C was optional and correctly skipped).

### 4. REQUIREMENTS.md BMODE-03 traceability update (Task 3)

File: `.planning/REQUIREMENTS.md:93` (one row replaced)

**Before:**
```
| BMODE-03   | 19    | Admin with `organizations.manage` flips mode via two-step confirmation + "Reset to system default" |
```

**After:**
```
| BMODE-03   | 19    | Admin with `admin.system` flips mode via two-step confirmation + "Reset to system default" (permission locked as `admin.system` in Phase 19 Plan 01 `<permission_decision>`; a finer-grained org-scoped manage permission is a v2.12.0+ followup) |
```

The v1 requirements checklist at line 31 (unchecked BMODE-03 entry that still mentions `organizations.manage`) is intentionally untouched — it names the capability, not the permission string, and the acceptance criterion explicitly permits it.

## Files NOT Touched (Regression Lock)

This plan deliberately does NOT edit any of these files, and the verification gates prove it:

| File | Why untouched | Proof |
|------|---------------|-------|
| `packages/dashboard/src/views/partials/sidebar.hbs` | BUI-04 parity is pre-satisfied by existing sidebar code; this plan LOCKS it via read-only fixture-compile | `git diff --stat` returns empty |
| `packages/dashboard/src/routes/admin/system.ts` | Branding service is already at line 117 with identical `{status, label}` shape as compliance/llm | `git diff --stat` returns empty |
| `packages/dashboard/src/views/admin/system.hbs` | Template already uses `{{#each services}}` with identical card classes for all services | `git diff --stat` returns empty |
| `packages/dashboard/src/services/branding/*` | Phase 17 locked — no orchestrator/adapter changes | Plan acceptance grep `scanner/orchestrator\|service-client-registry` returns 0 in organizations.ts |
| `packages/dashboard/src/scanner/orchestrator.ts` | Phase 18 locked — no scanner changes | Not referenced anywhere in this plan's diffs |

## Deviations from Plan

**One deviation — acceptance grep drift, auto-fixed per Rule 3.**

### 1. [Rule 3 - Plan acceptance grep vs. verbatim replacement text] Reworded BMODE-03 parenthetical

The Task 3 action block provided this verbatim replacement text:

```
| BMODE-03   | 19    | Admin with `admin.system` flips mode ... (permission locked as `admin.system` in Phase 19 Plan 01 `<permission_decision>`; a finer-grained `organizations.manage` permission is a v2.12.0+ followup) |
```

But the task's acceptance criterion was:

```
grep -c "| BMODE-03.*organizations.manage" /root/luqen/.planning/REQUIREMENTS.md returns 0
```

The verbatim replacement text contains the string `organizations.manage` inside the parenthetical, which makes the row match the grep and return 1 instead of 0. This is the same class of self-inconsistency as the Plan 19-02 Pitfall #5 comment-text vs. grep drift (documented in 19-02-SUMMARY.md decision block).

**Fix:** reworded the parenthetical from `` `organizations.manage` permission `` to `org-scoped manage permission` — same semantics (both describe the future finer-grained permission in natural language), satisfies the traceability-row grep, preserves the Phase 19 Plan 01 reference that is the whole point of the task. This is a wording-only change; the row still:

- Names `admin.system` as the locked permission (acceptance #1: 1)
- References Phase 19 Plan 01 as the rationale source (acceptance #3: 1)
- Does not literally contain `organizations.manage` in the traceability row (acceptance #2: 0)

The v1 requirements checklist at line 31 still literally says `organizations.manage` — that is explicitly permitted by the acceptance criterion text (`"however it may still appear in the v1 Requirements list at the top, which is fine"`).

No behavioral change, no weakened assertions, no test skipped. Documented in the decisions block of the frontmatter for traceability.

## Verification Results

| Check | Result |
|-------|--------|
| `cd packages/dashboard && npm run lint` (tsc --noEmit) | PASS (0 errors) |
| `npx vitest run tests/routes/admin-system-branding-parity.test.ts` | 2/2 PASS |
| `npx vitest run tests/views/sidebar-branding-parity.test.ts` | 2/2 PASS |
| `npx vitest run tests/routes/organizations-admin.test.ts` (regression) | 21/21 PASS — no test depended on the row HTML anchor count |
| `npx vitest run tests/routes/organizations-branding-mode.test.ts` (19-01 regression) | 6/6 PASS |
| `npx vitest run tests/routes/organizations-branding-test.test.ts` (19-02 regression) | 5/5 PASS |
| Full dashboard suite `npx vitest run` | **2510 passed** / 40 skipped / 3 skipped test files / **0 regressions** (from 19-02 baseline 2506 — +4 new tests = 2510 exactly) |
| `grep -c "services\\.branding" tests/routes/admin-system-branding-parity.test.ts` | 5 (>= 3 required) |
| `grep -c "brandingKeys).toEqual(complianceKeys" tests/routes/admin-system-branding-parity.test.ts` | 1 |
| `grep -c 'href="/admin/organizations/\${encodeURIComponent(org.id)}/branding-mode"' src/routes/admin/organizations.ts` | 1 |
| `grep -cE 'href="/admin/branding-guidelines"\|href="/admin/system-brand-guidelines"' tests/views/sidebar-branding-parity.test.ts` | 4 (2 anchors × 2 assertions — positive + negative) |
| `grep -c 'href="/admin/llm"' tests/views/sidebar-branding-parity.test.ts` | 1 |
| `git diff --stat packages/dashboard/src/views/partials/sidebar.hbs` | empty (0 lines changed — sidebar NOT edited) |
| `git diff --stat packages/dashboard/src/routes/admin/system.ts` | empty |
| `git diff --stat packages/dashboard/src/views/admin/system.hbs` | empty |
| `grep -c "scanner/orchestrator\|service-client-registry" packages/dashboard/src/routes/admin/organizations.ts` | 0 (no forbidden imports in the edited file) |
| `grep -c "\| BMODE-03.*admin.system" .planning/REQUIREMENTS.md` | 1 |
| `grep -c "\| BMODE-03.*organizations.manage" .planning/REQUIREMENTS.md` | 0 (traceability row is clean; v1 list at line 31 is excepted) |
| `grep -c "Phase 19 Plan 01" .planning/REQUIREMENTS.md` | 1 |

## Followups (Not in Phase 19 Scope)

- **escapeHtml org.name in orgRowHtml across ALL interpolations** — the new Branding Mode anchor inherits the existing (unfixed) raw `${org.name}` interpolation pattern from the Members/Delete entries. Threat T-19.3-02 notes this is a pre-existing codebase issue (NOT introduced by Phase 19). A future cross-cutting XSS sweep should wrap every `${org.name}` in `escapeHtml()` and add a test that creates an org with `<script>` in the name and asserts the row HTML contains the escaped form.
- **i18n sweep for "Branding Mode" / "Members" / "Delete" string literals** — the orgRowHtml uses raw TypeScript string literals because the existing row already does. Phase 21's BUI-03 cross-cutting i18n sweep will migrate these to `{{t}}` keys (or equivalent server-side i18n helpers) at that time.
- **Sidebar redesign / Branding Mode as sidebar link** — intentionally NOT delivered in Phase 19. The scope_clarification explains why: sidebar redesign is not the right moment, the org list row link is sufficient discoverability. If a future milestone adds a dedicated "Per-org settings" sidebar section, it would live there.
- **Extend parity tests to cover pa11y and dashboard services** — Task 1's parity lock checks branding against compliance and llm specifically. Expanding to `Object.keys(services.pa11y).sort()` and `Object.keys(services.dashboard).sort()` equality would catch drift in those services too, at essentially zero incremental cost.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 3483293 | test | Lock System Health branding parity with compliance and LLM |
| 039cfaf | feat | Add Branding Mode link to org list row + lock sidebar parity |
| 8d3def0 | docs | Update BMODE-03 traceability to reflect locked admin.system permission |

## Phase 19 Closure

This plan is the **final plan of Phase 19**. With 19-01 (admin branding-mode toggle with two-step confirmation), 19-02 (test-connection Pitfall #5 canary), and 19-03 (BUI-04 parity lock + discoverability + traceability fix) all shipped, all three Phase 19 requirements (BMODE-03, BMODE-04, BUI-04) are now implemented and regression-locked. The accumulated diff:

- **3 new routes:** `GET /admin/organizations/:id/branding-mode`, `POST /admin/organizations/:id/branding-mode`, `POST /admin/organizations/:id/branding-test`
- **1 new partial** with 4 render branches (`form`, `readonly` future-proof, `confirm`, `testResult`): `admin/partials/branding-mode-toggle.hbs`
- **4 new test files** covering 15 new tests:
  - `organizations-branding-mode.test.ts` (6) — two-step confirmation DB-unchanged invariant
  - `organizations-branding-test.test.ts` (5) — Pitfall #5 orchestrator-path enforcement
  - `admin-system-branding-parity.test.ts` (2) — System Health shape parity
  - `sidebar-branding-parity.test.ts` (2) — sidebar render parity + permission gate
- **1 discoverability link** in orgRowHtml
- **1 REQUIREMENTS.md row** updated for traceability fidelity
- **2 partial extensions** in `branding-mode-toggle.hbs` (form branch → test button; new testResult branch at the bottom)

Cumulative Phase 19 regression: **2510 passed / 40 skipped / 0 regressions** (from pre-phase-19 baseline 2495 + 15 new tests = 2510 exactly).

## Self-Check: PASSED

- File exists: `packages/dashboard/tests/routes/admin-system-branding-parity.test.ts` — FOUND
- File exists: `packages/dashboard/tests/views/sidebar-branding-parity.test.ts` — FOUND
- File modified: `packages/dashboard/src/routes/admin/organizations.ts` (orgRowHtml at lines 13-33 now contains the Branding Mode anchor) — FOUND
- File modified: `.planning/REQUIREMENTS.md` (line 93 BMODE-03 row updated) — FOUND
- Commit 3483293 — FOUND in git log
- Commit 039cfaf — FOUND in git log
- Commit 8d3def0 — FOUND in git log
- All 4 new tests pass — VERIFIED via vitest run
- Full suite 2510 passed / 0 regressions — VERIFIED
- Lint passes — VERIFIED
- `sidebar.hbs` untouched — VERIFIED via `git diff --stat`
- `system.ts` untouched — VERIFIED via `git diff --stat`
- `system.hbs` untouched — VERIFIED via `git diff --stat`
