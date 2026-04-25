---
phase: 37-streaming-ux-polish
plan: 05
subsystem: dashboard/agent-e2e-and-share-polish
tags: [e2e, axe-core, jsdom, share-view, polish, verification, phase-exit]
requires:
  - phase: 37-streaming-ux-polish
    plan: 04
    provides: client wiring for retry/edit-resend/share/copy + agent-share-view.hbs base template
provides:
  - packages/dashboard/tests/e2e/agent-streaming-ux.e2e.test.ts (8 e2e cases)
  - meta name="robots" content="noindex,nofollow" on share-view (T-37-20 mitigation)
  - .agent-share / __head / __thread BEM block in style.css (mobile-responsive)
  - .planning/phases/37-streaming-ux-polish/37-VERIFICATION.md (phase exit record per VER-01)
  - .planning/phases/37-streaming-ux-polish/deferred-items.md (pre-existing, out-of-scope)
affects:
  - "Phase 37 final close-out — all 5 AUX requirements verified"
tech-stack:
  added: []
  patterns:
    - "vitest + Fastify server.inject + JSDOM + axe-core e2e (matches Phase 35-06 idiom; Playwright not wired into packages/dashboard — checkpoint instructions explicitly permit this fallback)"
    - "Inline real style.css into share-view HTML before axe scan so contrast / focus rules evaluate against actual tokens"
    - "Replay AgentService.handleStreamAbort's three writes from the test body (appendMessage → markMessageStopped → agentAudit.append) to exercise AUX-01 stop persistence end-to-end without booting the real streaming server"
key-files:
  created:
    - packages/dashboard/tests/e2e/agent-streaming-ux.e2e.test.ts
    - .planning/phases/37-streaming-ux-polish/37-VERIFICATION.md
    - .planning/phases/37-streaming-ux-polish/deferred-items.md
  modified:
    - packages/dashboard/src/views/agent-share-view.hbs
    - packages/dashboard/src/static/style.css
key-decisions:
  - "Used vitest + Fastify inject + JSDOM + axe-core (Phase 35-06 idiom) instead of Playwright. Playwright is not wired into packages/dashboard (no @playwright/test, no playwright.config.ts, no browser runtime). Plan 05 checkpoint instructions explicitly permitted this fallback. Real DB, real routes, real audit writes — only the browser layer is JSDOM."
  - "AUX-01 stop persistence is exercised by replaying handleStreamAbort's exact three writes from the test body. The AbortSignal plumbing itself is already covered by tests/agent/agent-service-stop-persist.test.ts (Phase 37-03 Task 1, 6 cases). Booting the real streaming server inside JSDOM would have added complexity without testing additional code."
  - "axe-core scan scoped to the <main class=\"agent-share\"> region (Element form), matching Phase 35-06's pattern. Element form satisfies axe-core's setupGlobals() in vitest worker isolation."
  - "Mobile viewport assertion (test 8) verifies the markup contract (no composer, no action buttons, h1 has text) and a style.css source grep (.agent-share / __head / __thread present). JSDOM does not run a layout engine, so direct overflow-x measurement is not feasible — the source grep is the strongest available guarantee that the mobile-responsive CSS block did not get refactored away."
requirements-completed: [AUX-01, AUX-02, AUX-03, AUX-04, AUX-05]
duration: ~12 min
completed: 2026-04-25
---

# Phase 37 Plan 05: End-to-end coverage + share-view a11y polish + phase verification record

**Eight e2e cases (vitest + Fastify inject + JSDOM + axe-core) prove all five AUX requirements end-to-end, the share-view picks up `<meta name="robots" content="noindex,nofollow">` plus a `.agent-share` BEM block with 720px max-width and 480px responsive padding, and `37-VERIFICATION.md` closes Phase 37 per the VER-01 standard with a Nyquist coverage note showing every SC has at least two automated layers + manual UAT.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 (auto) + 1 (checkpoint)
- **Files created:** 3
- **Files modified:** 2
- **Tests added:** 8 (8/8 pass twice in a row, 2.05s wall time)

## Accomplishments

### Task 1 — `tests/e2e/agent-streaming-ux.e2e.test.ts`

Eight e2e cases against the real Fastify dashboard with real `SqliteStorageAdapter`, real routes, real `agent_audit_log` writes, and real share-view rendering. Mapping:

| Test | AUX     | Asserts                                                                                                                                                            |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | AUX-01  | Stopped partial persists with `status='stopped'`, audit row `message_stopped` with `outcomeDetail='stopped_by_user'`, GET /messages/:mid returns the partial bytes |
| 2    | AUX-02  | POST /retry → 200, target row `status='superseded'`, audit row `message_retried`, active-branch view excludes the row                                              |
| 3    | AUX-03  | POST /edit-resend → 200, original user + assistant marked superseded in DB, new user message is the only active-branch row, audit row `message_edit_resend`         |
| 4    | AUX-04  | GET /messages/:mid returns raw markdown bytes (no `<h1>`/`<strong>`/etc. — exact byte match)                                                                       |
| 5    | AUX-05  | POST /share → 201 + shareId/url; audit row `share_created`; GET /agent/share/:id renders read-only HTML (no `id="agent-form"`, no `[data-action="*Assistant"]`)    |
| 6    | AUX-05  | Foreign-org session on share URL → 403 `forbidden_org_mismatch` (not 200, not 404)                                                                                  |
| 7    | a11y    | axe-core scan against share-view with real style.css inlined → zero serious + critical violations; meta robots noindex,nofollow present                            |
| 8    | mobile  | 375px JSDOM viewport: no composer / no action buttons; h1 has text; style.css contains `.agent-share` / `.agent-share__head` / `.agent-share__thread` blocks       |

Wall time: 2.05 s. All 8 pass twice in a row (flake check).

### Task 2 — share-view CSS polish + meta robots noindex

- `packages/dashboard/src/views/agent-share-view.hbs` — added `<meta name="robots" content="noindex,nofollow">` (T-37-20 mitigation; share links are auth-gated and must not appear in search results even via leak).
- `packages/dashboard/src/static/style.css` — added the `.agent-share` BEM block:
  - `.agent-share { max-width: 720px; margin-inline: auto; padding: var(--space-xl) var(--space-md); background: var(--bg-primary); color: var(--text-primary); }`
  - `.agent-share__head { margin-bottom: var(--space-lg); }`
  - `.agent-share__head h1 { font-size: var(--font-size-xl); margin: 0 0 var(--space-xs); line-height: 1.25; }`
  - `.agent-share__head .form-hint { color: var(--text-secondary); margin: 0; }` (WCAG 2.2 AA contrast against --bg-primary)
  - `.agent-share__thread { display: flex; flex-direction: column; gap: var(--space-md); }`
  - `@media (max-width: 480px) { .agent-share { padding: var(--space-md) var(--space-sm); } .agent-share__head { margin-bottom: var(--space-md); } }`

No new tokens introduced (CLAUDE.md design-system-consistency rule). Markdown code-block `overflow-x: auto` already in `.agent-msg__body pre` from Phase 32 — no change needed.

## Task Commits

1. `47b777c` — `test(37-05): e2e spec covering AUX-01..AUX-05 (vitest+JSDOM+inject+axe-core)`
2. `40b4b97` — `feat(37-05): share-view a11y polish (meta robots noindex + .agent-share BEM block)`

## Audit Log Evidence

Asserted via real `agent_audit_log` reads in tests 1, 2, 3, 5:

- `message_stopped` (test 1) — `argsJson='{}'`, `outcomeDetail='stopped_by_user'`
- `message_retried` (test 2) — `argsJson` carries `originalMessageId`
- `message_edit_resend` (test 3) — `argsJson` carries `originalUserMessageId`, `newUserMessageId`, `supersededAssistantId`
- `share_created` (test 5) — `argsJson` carries `shareId`, `anchorMessageId`

## Decisions Made

- **No Playwright.** Playwright is not wired into packages/dashboard. Plan 05 checkpoint instructions allow the existing vitest+JSDOM+inject+axe-core idiom (Phase 35-06). Real DB, real routes, real audit writes; only the browser layer is JSDOM.
- **AUX-01 stop test replays handleStreamAbort.** Booting the real streaming server inside JSDOM was rejected — the AbortSignal plumbing is already covered by `tests/agent/agent-service-stop-persist.test.ts` (6 cases, Phase 37-03 Task 1). The e2e test exercises the persistence side bit-for-bit by replaying `appendMessage` → `markMessageStopped` → `agentAudit.append` (verbatim from `agent-service.ts:555`). The downstream user-visible state is then verified through the real `GET /agent/conversations/:cid/messages/:mid` route.
- **axe-core scoped to Element.** Same trick as Phase 35-06: `axe.run(region, ...)` with `region` being the `<main class="agent-share">` element. Element form satisfies setupGlobals() under vitest worker isolation; `axe.run(document)` would require window/document on Node globalThis.
- **Mobile parity verified by markup contract + source grep.** JSDOM does not run a layout engine, so direct overflow-x measurement is impossible. Test 8 instead asserts (a) the page is composer-free and action-button-free at 375px, (b) the h1 has text, (c) `.agent-share` / `__head` / `__thread` blocks exist in `style.css` source. A future refactor that drops the mobile padding rule would still pass this test — that's a known limit; the WCAG axe scan in test 7 would catch the contrast/focus regressions, and the live UAT in Plan 04 covered the actual mobile viewport.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Playwright not wired into packages/dashboard**

- **Found during:** Task 1 bootstrap.
- **Issue:** Plan 05 acceptance criteria invoke `npx playwright test agent-streaming-ux.spec.ts`. Dashboard has no `@playwright/test` dep, no `playwright.config.ts`, no browser runtime. Existing `tests/e2e/*.test.ts` files all use vitest + Fastify inject + JSDOM (precedent: `tests/e2e/agent-history.e2e.test.ts`, `tests/e2e/agent-history-a11y.e2e.test.ts`).
- **Fix:** Used the existing idiom. Both the orchestrator's spawn note and Plan 06 of Phase 35 explicitly permitted this fallback. Real DB + real routes + real agent.js source — only the browser is JSDOM. axe-core (the engine `@axe-core/playwright` wraps) runs directly against JSDOM.
- **Files affected:** `tests/e2e/agent-streaming-ux.e2e.test.ts` (file extension `.e2e.test.ts` matches existing E2E precedent).
- **Committed in:** `47b777c`.

**2. [Rule 3 - Naming] Plan named the spec `agent-streaming-ux.spec.ts`, repo convention is `*.e2e.test.ts`**

- **Found during:** Task 1 file-creation.
- **Issue:** All existing dashboard "E2E" tests are picked up by vitest via the `*.test.ts` glob. A `*.spec.ts` file would not run under `npx vitest run`.
- **Fix:** Used `agent-streaming-ux.e2e.test.ts` to match the existing convention (`agent-history.e2e.test.ts`, `agent-history-a11y.e2e.test.ts`, `agent-multi-step.e2e.test.ts`). End-state behaviour identical.
- **Committed in:** `47b777c`.

**3. [Rule 1 - Bug discovered, NOT auto-fixed] `tests/e2e/agent-multi-step.e2e.test.ts` and `tests/e2e/agent-panel.test.ts` are red on HEAD before this plan**

- **Found during:** Pre-Task-2 regression (`vitest run tests/routes/agent-share.test.ts tests/views tests/e2e`).
- **Verified:** `git stash && vitest run …` — both fail without 37-05 changes.
- **Decision:** Out of scope (SCOPE BOUNDARY rule — issues not directly caused by current task). Logged to `deferred-items.md`. Both are simple harness-level fixes (one missing constructor arg; one LOC budget breach demanding a code split). Neither blocks AUX-01..05 verification.

---

**Total deviations this plan:** 2 auto-fixed (both Rule 3 — environment naming) + 1 documented out-of-scope discovery.

## Issues Encountered

None beyond the documented deferred-items list above.

## Authentication Gates

None — harness stamps `request.user` via the Fastify preHandler, just like every other dashboard E2E test.

## Threat Register Status

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-37-20 (Info disclosure via share-view indexability) | mitigate | ✓ `<meta name="robots" content="noindex,nofollow">` in `agent-share-view.hbs`; e2e test 7 asserts presence |
| T-37-21 (Repudiation — verification gaps slip into release) | mitigate | ✓ `37-VERIFICATION.md` lists each SC with method + outcome + Nyquist note |

## Threat Flags

None — no new network endpoints introduced. Two existing endpoints (`/agent/share/:id`, share-view CSS) tightened only.

## Known Stubs

None — every test exercises real production code paths.

## Verification

```bash
# Plan 05 e2e (this plan)
cd packages/dashboard && npx vitest run tests/e2e/agent-streaming-ux.e2e.test.ts
# → 8 / 8 pass, 2.05 s wall time, ran twice in a row

# Type check
cd packages/dashboard && npx tsc --noEmit
# → exit 0
```

## Next Phase Readiness

- Phase 37 is **closed** pending the human-verify checkpoint (AUX final UAT readback).
- All 5 AUX requirements verified PASS at two automated layers + manual UAT.
- Two pre-existing harness issues documented in `deferred-items.md` for Phase 38 cleanup.

## Self-Check

- `packages/dashboard/tests/e2e/agent-streaming-ux.e2e.test.ts` — FOUND (8 it('test blocks)
- `packages/dashboard/src/views/agent-share-view.hbs` `<meta name="robots"` — FOUND
- `packages/dashboard/src/static/style.css` `.agent-share` BEM block — FOUND
- `.planning/phases/37-streaming-ux-polish/37-VERIFICATION.md` — FOUND
- `.planning/phases/37-streaming-ux-polish/deferred-items.md` — FOUND
- Commit `47b777c` (Task 1) — FOUND
- Commit `40b4b97` (Task 2) — FOUND
- Vitest 37-05 e2e suite: 8/8 pass twice in a row
- `tsc --noEmit`: exit 0

## Self-Check: PASSED

---
*Phase: 37-streaming-ux-polish*
*Completed: 2026-04-25*
