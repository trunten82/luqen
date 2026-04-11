---
phase: 19-admin-ui-mode-toggle
plan: 01
subsystem: dashboard-admin-ui
tags:
  - bmode-03
  - admin-ui
  - branding-mode
  - two-step-confirmation
  - permission-gate
dependency_graph:
  requires:
    - phase-16/OrgRepository.getBrandingMode/setBrandingMode
    - phase-17/branding-orchestrator-per-request-read
  provides:
    - GET /admin/organizations/:id/branding-mode
    - POST /admin/organizations/:id/branding-mode
    - admin/partials/branding-mode-toggle.hbs (form + confirm shapes)
  affects:
    - packages/dashboard/src/routes/admin/organizations.ts (organizationRoutes plugin)
tech_stack:
  added: []
  patterns:
    - reply.view template fragment rendering for HTMX swaps
    - two-step confirmation via body._confirm token
    - permission gate via requirePermission middleware (admin.system)
key_files:
  created:
    - packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs
    - packages/dashboard/tests/routes/organizations-branding-mode.test.ts
  modified:
    - packages/dashboard/src/routes/admin/organizations.ts
decisions:
  - "Permission locked as `admin.system` (not `organizations.manage` from spec) — see permission_decision block in 19-01-PLAN.md"
  - "No readonly partial branch — non-admins are 403'd server-side, view-only tier deferred to v2.12.0+"
  - "No caching of branding_mode — every GET/POST reads via OrgRepository.getBrandingMode (PROJECT.md per-request-read invariant)"
  - "POST mode=default normalizes to 'embedded' inside the same handler (one route, one test surface)"
metrics:
  duration: "~5 minutes"
  completed: 2026-04-10
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  new_tests: 6
  full_suite: "2501 passed (+6 new) / 0 regressions from baseline 2495"
requirements_completed:
  - BMODE-03
---

# Phase 19 Plan 01: Admin Branding-Mode Toggle Routes Summary

**One-liner:** Per-org branding-mode admin toggle with two-step confirmation modal, reset-to-default flow, and server-side `admin.system` permission gate — wired to Phase 16's OrgRepository with zero caching.

## What Was Built

Three deliverables landed under the existing `organizationRoutes` Fastify plugin:

1. **Handlebars partial** — `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs` (97 lines) with two render branches:
   - `mode='form'` — admin edit view: two radios (`embedded`/`remote`), submit button, secondary "Reset to system default" button
   - `mode='confirm'` — step 1 confirmation modal: explains next-scan semantics + history preservation, two buttons (Confirm POST `_confirm=yes`, Cancel hx-get back to form)
   - **No `readonly` branch** — non-admins are 403'd server-side and never reach the partial. View-only permission tier is a v2.12.0+ followup.

2. **Two new routes** appended to `routes/admin/organizations.ts` (lines 417-525, +109 lines):
   - `GET /admin/organizations/:id/branding-mode` — loads org via `getOrg`, reads `getBrandingMode(id)`, renders the form partial
   - `POST /admin/organizations/:id/branding-mode` — implements the two-step flow:
     - Validates `mode` against `{embedded, remote, default}` (else 400)
     - If `body._confirm !== 'yes'`: re-reads `getBrandingMode(id)` for the modal context, returns the confirm partial, **DB unchanged**
     - If `body._confirm === 'yes'`: calls `setBrandingMode(id, normalized)`, re-renders the form partial with the new value + a trailing toast
   - Both routes gated by `requirePermission('admin.system')` (the locked permission decision)

3. **Six route tests** in `tests/routes/organizations-branding-mode.test.ts` (235 lines), all passing:

| # | Test | What it locks |
|---|------|---------------|
| 1 | GET admin | 200 + `template='admin/partials/branding-mode-toggle.hbs'` + `data.mode='form'` + `data.currentMode='embedded'` (migration 043 default) |
| 2 | GET viewer | 403 — server-side permission gate, NOT CSS hiding |
| 3 | POST step 1 (no `_confirm`) | Returns confirm modal AND `getBrandingMode(orgId)` STILL returns the pre-POST value — the heart of the two-step UX guarantee |
| 4 | POST step 2 (`_confirm=yes`) | Persists `'remote'`, re-renders form partial with updated currentMode |
| 5 | POST `mode=default&_confirm=yes` | After flipping to `'remote'`, resets back to `'embedded'` (schema default) |
| 6 | POST viewer with `_confirm=yes` | 403 + DB unchanged (defense in depth — even an attacker who guesses the body shape can't bypass the permission gate) |

## Permission Decision (Locked)

**Used:** `requirePermission('admin.system')`

The plan's `<permission_decision>` block locked this in. REQUIREMENTS.md BMODE-03 names `organizations.manage`, but that string does not exist anywhere in the codebase today. All existing `/admin/organizations/*` mutations use `admin.system`, with direct precedent in `routes/admin/service-connections.ts` (Phase 06 made the same call). Introducing `organizations.manage` requires schema/seed/role-table changes that are out of scope for Phase 19.

**Rationale:** zero drift from existing code, lowest-risk fix, intent is honored (admins can flip, non-admins cannot — gate is server-side).

## The Two-Step Confirmation DB-Unchanged Invariant

Test 3 is the highest-stakes assertion in this plan. It encodes the BMODE-03 promise that a single click of "Change mode" cannot mutate state:

```typescript
// Before POST
expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');

// POST without _confirm — server returns the modal
const res = await ctx.server.inject({ method: 'POST', payload: 'mode=remote', ... });
expect(body.data.mode).toBe('confirm');

// After POST: DB MUST still be 'embedded'
expect(await ctx.storage.organizations.getBrandingMode(org.id)).toBe('embedded');
```

This locks the route handler's implementation: the `if (body._confirm !== 'yes')` branch returns BEFORE any call to `setBrandingMode`. Any future refactor that accidentally moves persistence above the confirm check will break this test.

## No-Caching Invariant

The route handler reads `getBrandingMode` on every GET and on POST step 1 — never memoized, never stored on a module-level variable. Combined with Phase 17's per-request-read in the BrandingOrchestrator, a flip via this UI takes effect on the next scan with zero invalidation logic. Verified by absence of `cache`/`memoiz` strings in `organizations.ts`.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` (tsc --noEmit) | PASS (0 errors) |
| `npx vitest run tests/routes/organizations-branding-mode.test.ts` | 6/6 PASS |
| `npx vitest run tests/routes/organizations-admin.test.ts` (regression) | 21/21 PASS |
| `npx vitest run tests/routes/admin` (full admin routes suite) | 255/255 PASS |
| Full dashboard suite `npx vitest run` | 2501 passed (+6 new from baseline 2495) / 0 regressions |
| `grep brandingOrchestrator routes/admin/organizations.ts` | 0 (correctly out of scope — Plan 19-02's territory) |
| `grep requirePermission('admin.system') routes/admin/organizations.ts` | 6 (was 4 before, +2 for the new routes) |

## Deviations from Plan

None — plan executed exactly as written. The verbatim action blocks for the partial, the two routes, and the six tests dropped in cleanly with zero adjustments. No bugs encountered, no missing dependencies, no auth gates, no architectural questions raised.

One minor planner-vs-reality count discrepancy noted but not a deviation: the acceptance criterion `grep -c "'admin/partials/branding-mode-toggle.hbs'"` in the test file expected "at least 4" but the actual count is 3 (Test 1, Test 3, Test 4 assert the template; Tests 2 and 6 assert 403 status; Test 5 asserts data fields without re-asserting template). The test file is byte-for-byte identical to the plan's verbatim spec, so the planner over-counted their own template assertions. The test passes the spirit of the criterion (template name appears in multiple HTML-returning tests).

## Followups (Not in Phase 19 Scope)

- **Audit logging**: Mode flips are not written to `audit_log`. T-19.1-03 in the threat model accepts this for Phase 19; revisit when audit retention policy lands.
- **Fine-grained permissions**: Introduce `organizations.*` permission family milestone-wide in v2.12.0+. The `requirePermission('admin.system')` calls in this plan can then become `requirePermission('organizations.manage', 'admin.system')` (both accepted) without breaking change.
- **View-only tier**: A `mode='readonly'` partial branch can be re-added in v2.12.0+ when a non-admin "branding viewer" role exists. The current 403 path is correct enforcement; the UX gap (viewer sees nothing instead of read-only) is acceptable for Phase 19.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| e5e0868 | feat | Add branding-mode-toggle Handlebars partial (form + confirm) |
| 7dc531d | feat | Add GET/POST /admin/organizations/:id/branding-mode routes |
| 78f30cd | test | Add 6 route tests for branding-mode toggle BMODE-03 |

## Self-Check: PASSED

- File exists: `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs` — FOUND
- File exists: `packages/dashboard/tests/routes/organizations-branding-mode.test.ts` — FOUND
- File modified: `packages/dashboard/src/routes/admin/organizations.ts` — FOUND (new content at lines 417-525)
- Commit e5e0868 — FOUND in git log
- Commit 7dc531d — FOUND in git log
- Commit 78f30cd — FOUND in git log
- All 6 new tests pass — VERIFIED via vitest run
- Full suite 2501 passed / 0 regressions — VERIFIED
- Lint passes — VERIFIED
