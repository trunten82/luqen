---
phase: 19-admin-ui-mode-toggle
plan: 02
subsystem: dashboard-admin-ui
tags:
  - bmode-04
  - admin-ui
  - branding-mode
  - test-connection
  - pitfall-5-enforcement
  - permission-gate
dependency_graph:
  requires:
    - phase-17/branding-orchestrator-matchAndScore
    - phase-17/server.ts-decorate-brandingOrchestrator
    - phase-19-01/branding-mode-toggle-partial-form-branch
    - phase-19-01/requirePermission-admin.system-gate
  provides:
    - POST /admin/organizations/:id/branding-test
    - admin/partials/branding-mode-toggle.hbs testResult branch
  affects:
    - packages/dashboard/src/routes/admin/organizations.ts (organizationRoutes plugin)
tech_stack:
  added: []
  patterns:
    - "Fastify decorate access pattern: server.brandingOrchestrator via non-optional declare module (reused from branding-guidelines.ts)"
    - "Tagged-union result mapping to response envelope (no catch-all, no 'unknown' literal)"
    - "hx-headers X-CSRF-Token for button-triggered HTMX (no nested form input)"
    - "Handlebars default-escaping + route-level escapeHtml double-defense for remote error messages"
key_files:
  created:
    - packages/dashboard/tests/routes/organizations-branding-test.test.ts
  modified:
    - packages/dashboard/src/routes/admin/organizations.ts
    - packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs
decisions:
  - "routedVia uses a `MatchAndScoreResult['mode']` type alias instead of inline `'embedded' | 'remote'` union — satisfies the Pitfall #5 acceptance grep (which flags any `routedVia: 'embedded'|'remote'` literal pair, even in type positions) without weakening types"
  - "No try/catch around server.brandingOrchestrator.matchAndScore — Phase 17's tagged-union contract already surfaces all routing failures as kind='degraded'; catching would hide programmer errors and force a fake 'unknown' routedVia that has no contract meaning"
  - "No duplicate `declare module 'fastify'` in organizations.ts — reuses the non-optional declaration at branding-guidelines.ts:20-24 (adding a second would trigger TS2717 under strict declaration merging)"
  - "Pitfall #5 comment text was reworded from 'brandingService.listGuidelines or /api/v1/health' to 'a branding-service list or health endpoint' — the original wording put the forbidden strings in a comment, which tripped the acceptance grep `grep -cE 'brandingService\\.listGuidelines|/api/v1/health|/api/v1/guidelines' == 0`"
  - "escapeHtml(result.error) on the degraded branch is defense-in-depth on top of Handlebars default-escaping — protects against a future template author swapping `{{x}}` for `{{{x}}}`"
  - "Test file uses a test-only reply.view decorator that returns JSON (template, data) — lets assertions inspect the exact template + data without invoking Handlebars, matching the pattern already used by organizations-branding-mode.test.ts and organizations-admin.test.ts"
metrics:
  duration: "~8 minutes"
  completed: 2026-04-11
  tasks_completed: 3
  files_created: 1
  files_modified: 2
  new_tests: 5
  full_suite: "2506 passed / 0 regressions (from baseline 2501 after Plan 19-01)"
requirements_completed:
  - BMODE-04
---

# Phase 19 Plan 02: Branding Test-Connection Endpoint Summary

**One-liner:** POST /admin/organizations/:id/branding-test routes through the production `server.brandingOrchestrator.matchAndScore` dispatch with a synthetic minimal input, returning a `{ok, routedVia, details}` envelope where `routedVia` always comes from `result.mode` — the Pitfall #5 canary for dual-mode routing regressions.

## What Was Built

Three deliverables extending the Plan 19-01 surface:

### 1. Partial extension (74 new lines)

File: `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs`

- Inside the existing `{{#if (eq mode "form")}}` branch (lines 63-82), added a "Test connection" button + empty `#branding-test-result` placeholder div:
  - `hx-post="/admin/organizations/{{org.id}}/branding-test"`
  - `hx-target="#branding-test-result"`
  - `hx-swap="outerHTML"`
  - `hx-headers='{"X-CSRF-Token":"{{csrfToken}}"}'` — no nested `<input>` inside the `<button>` (invalid HTML + dead code, per BLOCKER-2 / WARN-1 revisions)
- At the bottom of the file (lines 119-172), added a standalone `{{#if testResult}}` branch that renders the result-card with three visual treatments:
  - **matched** (`ok=true`, no `note`): OK badge + `routedVia` + brandRelatedCount + scoreKind dl
  - **no-guideline** (`ok=true`, `details.note`): NOTE badge + `routedVia` + explainer paragraph
  - **degraded** (`ok=false`): ERROR badge + `routedVia` + reason + escaped error dl
- All three branches use `{{testResult.routedVia}}` and never hardcode any mode string. No triple-brace renders anywhere.

### 2. New POST route (142 new lines)

File: `packages/dashboard/src/routes/admin/organizations.ts`, lines 528-666

```typescript
server.post(
  '/admin/organizations/:id/branding-test',
  { preHandler: requirePermission('admin.system') },
  async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await storage.organizations.getOrg(id);
    if (org === null) return reply.code(404)...

    const syntheticGuideline: BrandGuideline = {
      id: 'test-conn-guideline',
      orgId: org.id,
      name: `Test connection probe for ${org.name}`,
      version: 0,              // signals synthetic
      active: true,
      colors: [{ id: 'test-color-1', name: 'Probe primary', hexValue: '#FF0000' }],
      fonts: [{ id: 'test-font-1', family: 'Probe Sans' }],
      selectors: [{ id: 'test-selector-1', pattern: '.probe-btn' }],
    };
    const syntheticIssue: MatchableIssue = { /* single WCAG2AA contrast fail */ };

    // PITFALL #5: exactly one call, through the production orchestrator.
    // No try/catch — tagged-union contract handles all routing failures.
    const result = await server.brandingOrchestrator.matchAndScore({
      orgId: org.id,
      siteUrl: 'https://test-connection.probe.luqen.local',
      scanId: `branding-test-${randomUUID()}`,
      issues: [syntheticIssue],
      guideline: syntheticGuideline,
    });

    // Tagged-union → envelope. routedVia ALWAYS from result.mode.
    type RoutedVia = MatchAndScoreResult['mode'];
    let testResult: /* 3-variant union */;
    if (result.kind === 'matched') { testResult = { ok: true, routedVia: result.mode, details: { brandRelatedCount: result.brandRelatedCount, scoreKind: result.scoreResult.kind } }; }
    else if (result.kind === 'degraded') { testResult = { ok: false, routedVia: result.mode, details: { reason: result.reason, error: escapeHtml(result.error) } }; }
    else { testResult = { ok: true, routedVia: result.mode, details: { note: 'Org has no linked guideline...' } }; }

    return reply.view('admin/partials/branding-mode-toggle.hbs', { testResult });
  },
);
```

**New imports** at the top of organizations.ts:
- `import { randomUUID } from 'node:crypto';`
- `import type { BrandGuideline, MatchableIssue } from '@luqen/branding';`
- `import type { MatchAndScoreResult } from '../../services/branding/branding-orchestrator.js';`

**Not** added: a second `declare module 'fastify'` block — the non-optional declaration at `branding-guidelines.ts:20-24` already merges into the ambient type. Adding a second would trigger TS2717.

### 3. Route tests (324 lines, 5 cases)

File: `packages/dashboard/tests/routes/organizations-branding-test.test.ts`

All 5 tests pass. Each uses a `vi.fn()`-backed spy decorated onto `server.brandingOrchestrator.matchAndScore` before `organizationRoutes` is registered, and a JSON-returning `reply.view` decorator so assertions inspect `{template, data}` without invoking Handlebars.

| # | Test | Pitfall #5 guardrail | Envelope assertion |
|---|------|----------------------|--------------------|
| 1 | matched-embedded (Aperol Srl) | `matchSpy.toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(objectContaining({orgId, issues: Array, guideline: {active: true}}))` + `call.issues.length > 0` + `call.guideline.colors.length > 0` | `ok=true`, `routedVia='embedded'`, `details.brandRelatedCount=1`, `details.scoreKind='scored'` |
| 2 | matched-remote (Branded Bros) | `toHaveBeenCalledTimes(1)` — same stub path, different mode | `ok=true`, `routedVia='remote'` — **THE decisive test that routedVia comes from result.mode, not a hardcoded string** |
| 3 | degraded (Carmine Co, remote-unavailable, ECONNREFUSED) | `toHaveBeenCalledTimes(1)` | `ok=false`, `routedVia='remote'`, `details.reason='remote-unavailable'`, `details.error` contains 'ECONNREFUSED' |
| 4 | no-guideline (Deco Dev, embedded) | `toHaveBeenCalledTimes(1)` | `ok=true`, `routedVia='embedded'`, `details.note` matches `/no linked guideline/i` |
| 5 | non-admin 403 (Echo Entertainment, viewer role) | `toHaveBeenCalledTimes(0)` — **the permission gate short-circuits before the orchestrator runs** | 403 |

## Pitfall #5 Enforcement (The Point of This Plan)

The entire purpose of BMODE-04 is to provide a canary that catches dual-mode routing regressions **before** they silently corrupt scan data. That means the button must route through the exact same `matchAndScore` method the scanner uses — no shortcuts.

### Code-level enforcement (acceptance greps)

All of these pass against `packages/dashboard/src/routes/admin/organizations.ts`:

| Check | Result | Meaning |
|-------|--------|---------|
| `grep -c "'/admin/organizations/:id/branding-test'"` | 1 | Route registered |
| `grep -c "server.brandingOrchestrator"` | 2 | Access pattern used |
| `grep -c "brandingOrchestrator.matchAndScore"` | 1 | Production method called |
| `grep -cE "brandingService\\.listGuidelines\|/api/v1/health\|/api/v1/guidelines"` | **0** | **No shortcut calls — the core Pitfall #5 guardrail** |
| `grep -c "result.kind === 'matched'"` | 1 | Match branch exists |
| `grep -c "result.kind === 'degraded'"` | 1 | Degraded branch exists |
| `grep -c "routedVia: result.mode"` | 3 | Every envelope variant reads mode from the orchestrator |
| `grep -cE "routedVia: '(embedded\|remote\|unknown)'\|routedVia: \"(embedded\|remote\|unknown)\""` | **0** | **No hardcoded routedVia anywhere, type positions included (uses RoutedVia alias)** |
| `grep -c "escapeHtml(result.error)"` | 1 | XSS defense-in-depth on the degraded branch |
| `grep -c "declare module 'fastify'"` | 0 | No duplicate declaration (reuses branding-guidelines.ts:20-24) |
| `grep -c "routedVia: 'unknown'"` | 0 | No 'unknown' fallback literal (dropped in WARN-3 revision) |
| `grep -c "requirePermission('admin.system')"` | 7 | Was 6 after 19-01, +1 for this plan |

### Behavior-level enforcement (test spies)

- **Positive tests (4x):** `expect(ctx.matchSpy).toHaveBeenCalledTimes(1)` — proves every result kind goes through the orchestrator, not a shortcut
- **Non-admin test (1x):** `expect(ctx.matchSpy).toHaveBeenCalledTimes(0)` — proves the permission gate short-circuits BEFORE the orchestrator runs (no wasted work, no exfil of even synthetic-input data)
- **Test 1 additional assertions:** the spy's recorded call arg must include `orgId: org.id`, `issues` as a non-empty array, and `guideline` with a non-empty `colors` array — proves the route constructed the real synthetic `MatchAndScoreInput` shape, not a stubbed empty one
- **Test 2 decisive assertion:** stub returns `mode: 'remote'`, response asserts `routedVia: 'remote'` — proves wire-through from orchestrator result to envelope is not a hardcoded string. If a future refactor writes `routedVia: 'embedded'` inline, Test 2 fails immediately.

## Response Envelope Contract Delivered

All three cases wrap the response in `{template: 'admin/partials/branding-mode-toggle.hbs', data: {testResult}}`:

### A. matched (ok, routing confirmed)

```json
{
  "ok": true,
  "routedVia": "embedded",
  "details": { "brandRelatedCount": 1, "scoreKind": "scored" }
}
```

### B. degraded (not ok, routing revealed a failure)

```json
{
  "ok": false,
  "routedVia": "remote",
  "details": { "reason": "remote-unavailable", "error": "ECONNREFUSED 127.0.0.1:3002" }
}
```

### C. no-guideline (ok, match layer not fully exercised)

```json
{
  "ok": true,
  "routedVia": "embedded",
  "details": {
    "note": "Org has no linked guideline; the match layer was not fully exercised. Link a guideline to this org and retry for a complete test."
  }
}
```

## Verification Results

| Check | Result |
|-------|--------|
| `npm run lint` (tsc --noEmit) | PASS (0 errors) |
| `npx vitest run tests/routes/organizations-branding-test.test.ts` | 5/5 PASS |
| `npx vitest run tests/routes/organizations-branding-mode.test.ts` (19-01 regression) | 6/6 PASS |
| `npx vitest run tests/routes/organizations-admin.test.ts` (org admin regression) | 21/21 PASS |
| Full dashboard suite `npx vitest run` | **2506 passed** / 40 skipped / **0 regressions** (from baseline 2501) |
| All Task 2 Pitfall #5 greps | ALL PASS (including the strict `= 0` checks) |

## Deviations from Plan

**Two small adjustments from Rule 3 (auto-fix blocking issues). Both are strictly necessary for the plan's own acceptance criteria to pass and do not change behavior.**

### 1. [Rule 3 - Type positions] Extracted `RoutedVia` type alias

The plan's verbatim `<action>` block for Task 2 writes the `testResult` union type with inline literal unions:

```typescript
let testResult: { ok: true; routedVia: 'embedded' | 'remote'; details: ... } | ...;
```

But the plan's own acceptance criterion is:

```
`grep -cE "routedVia: 'embedded'|routedVia: \"embedded\"|routedVia: 'remote'|routedVia: \"remote\"" ... returns 0`
```

This grep pattern matches **any** `routedVia: 'embedded'` / `routedVia: 'remote'` substring — including the inline type positions. The verbatim action would fail its own acceptance criterion.

**Fix:** extract `type RoutedVia = MatchAndScoreResult['mode'];` (resolves to `'embedded' | 'remote'` at the type level, zero runtime cost) and use `routedVia: RoutedVia;` in all three variants. The grep now returns 0 and TypeScript's strictness is preserved (discriminated union still enforces `result.mode` assignability).

### 2. [Rule 3 - Comment wording] Reworded Pitfall #5 comment

The plan's verbatim comment at the top of the route includes:

```typescript
// path with a synthetic minimal input. This is NOT a short-circuit to
// brandingService.listGuidelines or /api/v1/health — see Pitfall #5 and
```

But the plan's own acceptance criterion is:

```
`grep -cE "brandingService\\.listGuidelines|/api/v1/health|/api/v1/guidelines" ... returns 0`
```

The literal strings `brandingService.listGuidelines` and `/api/v1/health` in a comment trip the grep, which is deliberately strict so that any future shortcut (even as a comment example) is caught.

**Fix:** reworded the comment to `"NOT a short-circuit to a branding-service list or health endpoint"` — preserves the warning's semantics while satisfying the grep.

**Both deviations are tracked in the decisions block of the frontmatter.** No behavioral changes, no test weakening, no Pitfall #5 concessions — the enforcement grep is actually STRONGER now than the plan's verbatim would have been, because it catches future authors who might introduce those literals anywhere in the file (including comments).

## Commits

| Hash | Type | Description |
|------|------|-------------|
| e833b4f | feat | Extend branding-mode-toggle partial with test-connection button and result card |
| 39529c1 | feat | Add POST /admin/organizations/:id/branding-test route |
| 980b1ae | test | Route tests with Pitfall #5 guardrails (5 cases) |

## Followups (Not in Phase 19 Scope)

- **T-19.2-05 rate limiting / debounce:** Each click launches one `matchAndScore` call, which in remote mode launches one HTTP request to the @luqen/branding service. The branding service's own rate limiter bounds this, and the attacker needs `admin.system` to reach the button at all. A future enhancement could add a short client-side debounce on the button (e.g., `hx-trigger="click throttle:2s"`) or a route-specific Fastify rate limit to prevent accidental hammering during admin troubleshooting.
- **T-19.2-08 audit logging:** Test-connection calls are not written to `audit_log`. Acceptable for Phase 19 (they are intentionally low-signal during troubleshooting) but worth revisiting when audit retention policy lands — a single `audit_log` row per click, recording `adminUserId / orgId / routedVia / ok` would make post-incident analysis of "did the test button catch the regression?" trivial. Pair this with the same todo for Plan 19-01's mode-flip events.
- **i18n keys:** The new partial references `admin.org.brandingMode.test.title/explainer/button/result.routedVia/result.brandRelatedCount/result.scoreKind/result.reason/result.error`. These need to be added to the locale JSON files before the visible UI is usable in a browser (Plan 19-03 territory).
- **Retry affordance on the degraded card:** Currently the degraded result card has no "Retry" button — the admin has to scroll back up and click "Test connection" again. A small "Retry" button inside the degraded card (hx-post to the same endpoint, hx-target on the card itself) would improve the troubleshooting flow without adding any new route.

## Self-Check: PASSED

- File exists: `packages/dashboard/tests/routes/organizations-branding-test.test.ts` — FOUND
- File modified: `packages/dashboard/src/routes/admin/organizations.ts` — FOUND (new content at lines 528-666)
- File modified: `packages/dashboard/src/views/admin/partials/branding-mode-toggle.hbs` — FOUND (button at lines 63-82, testResult branch at lines 119-172)
- Commit e833b4f — FOUND in git log
- Commit 39529c1 — FOUND in git log
- Commit 980b1ae — FOUND in git log
- All 5 new tests pass — VERIFIED via vitest run
- Full suite 2506 passed / 0 regressions — VERIFIED
- Lint passes — VERIFIED
- All Pitfall #5 acceptance greps pass — VERIFIED
