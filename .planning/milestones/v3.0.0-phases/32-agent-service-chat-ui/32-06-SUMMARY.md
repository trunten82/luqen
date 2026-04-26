---
phase: 32-agent-service-chat-ui
plan: 06
subsystem: chat-drawer-ui
tags: [chat-drawer, eventsource, localstorage, handlebars, i18n, wcag, csp, surface-1, htmx]

# Dependency graph
requires:
  - phase: 32-agent-service-chat-ui
    plan: 03
    provides: organizations.agent_display_name column + OrganizationsRepository.getOrg/update roundtrip (consumed via server.ts preHandler to populate request.user.orgAgentDisplayName)
  - phase: 32-agent-service-chat-ui
    plan: 04
    provides: /agent/* Fastify routes (/agent/message, /agent/stream/:id, /agent/panel stub) + SSE frame contract + rate-limit 429 JSON onSend hook (Task 2 replaces the /agent/panel stub; agent.js consumes the SSE frames)
provides:
  - Floating chat button + right-side drawer rendered on every authenticated dashboard page via shared layout injection inside {{#if user}}
  - Plain-EventSource streaming client (D-20/D-21) with es.close on done frame preventing auto-reconnect (AI-SPEC §3 Pitfall 3)
  - localStorage.luqen.agent.panel persistence of open/closed state across HTMX-boosted nav and hard reloads (D-18)
  - GET /agent/panel replaced from Plan 04 stub to server-side rolling-window render via ConversationRepository.getWindow + agent-messages partial
  - 29 new agent.* i18n keys across en/de/es/fr/it/pt — drawer, input, speech-feature-detect, streaming, error states, pending-confirmation badge
  - CSS banner /* ---- Agent Drawer (Phase 32) ---- */ — 162 LOC, all values from existing design-token custom properties, respects prefers-reduced-motion, mobile < 900px full-width + launch-button hide via body:has()
  - agent.js IIFE (214 LOC) with event-delegation handlers, XSS-safe token append via createTextNode, DOMParser + importNode for trusted server-partial adoption (no innerHTML sink)
  - Speech-button feature-detect hook ready for Plan 07 wiring
  - Handlebars 'or' helper (new) to support the (or user.orgAgentDisplayName "Luqen Assistant") fallback pattern
  - request.user.orgAgentDisplayName exposed on authenticated requests so the shared layout renders the per-org display name
  - user exposed in the global view merge context so {{#if user}} in main.hbs is usable from every route
  - Playwright-style vitest E2E smoke (5 tests + 3 todos) covering partial + agent.js + main.hbs invariants + /agent/panel render + 429 JSON shape
affects: [32-07-confirm-dialog-and-speech, 32-08-admin-org-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DOMParser + document.importNode for safe adoption of trusted same-origin Handlebars fragments — avoids the innerHTML sink entirely while still replacing the #agent-messages subtree"
    - "Event-delegation IIFE client (agent.js) that observes htmx:afterRequest and opens a plain EventSource on 202 — keeps HTMX for ordinary form submit and SSE for streaming, honouring D-21"
    - "Per-fragment Handlebars compile+cache inside the route handler when the response must bypass reply.view's layout wrapper — used so /agent/panel returns pure markup that the DOMParser client can adopt"
    - "Shared-layout injection of a persistent widget DOM inside {{#if user}} so HTMX-boosted nav never re-renders the drawer"

# Key files
key-files:
  created:
    - packages/dashboard/src/views/partials/agent-drawer.hbs (UI-SPEC Surface 1 DOM — floating button + aside drawer + header + messages region + stream-status + HTMX input form; ARIA log/live/expanded/controls; hidden speech button placeholder)
    - packages/dashboard/src/views/partials/agent-messages.hbs (rolling-window {{#each}} loop or empty-state greeting)
    - packages/dashboard/src/views/partials/agent-message.hbs (user/assistant/tool bubble variants, <details>/<pre> for tool JSON, pending-confirmation data attribute)
    - packages/dashboard/src/static/agent.js (214 LOC IIFE — EventSource, localStorage, event-delegation, HTMX afterRequest hook, speech feature-detect)
    - packages/dashboard/tests/e2e/agent-panel.test.ts (5 vitest smoke tests + 3 todos for Playwright/axe-core)
  modified:
    - packages/dashboard/src/views/layouts/main.hbs (mount agent-drawer inside {{#if user}}, add #agent-aria-status sr-only live region, load /static/agent.js defer)
    - packages/dashboard/src/server.ts (register 3 new partials with @fastify/view, register 'or' Handlebars helper, populate request.user.orgAgentDisplayName after currentOrg resolution, expose user in global merge)
    - packages/dashboard/src/auth/middleware.ts (AuthUser interface — add optional orgAgentDisplayName)
    - packages/dashboard/src/routes/agent.ts (replace /agent/panel TODO-stub with real rolling-window render using ConversationRepository.getWindow + cached Handlebars compile of agent-messages.hbs)
    - packages/dashboard/src/static/style.css (+162 LOC under /* ---- Agent Drawer (Phase 32) ---- */ banner)
    - packages/dashboard/src/i18n/locales/{en,de,es,fr,it,pt}.json (29 agent.* keys per locale)

decisions:
  - "[32-06] Populate request.user.orgAgentDisplayName in server.ts preHandler (alongside currentOrg resolution) rather than in auth/session.ts — session.ts owns session cookie config, not user decoration; the currentOrg lookup already exists at the intended site (server.ts:675)."
  - "[32-06] Expose request.user in the global reply.view merge context so the shared layout can render {{#if user}} on every page without each route having to re-pass user — routes may still override by providing their own user."
  - "[32-06] Use Handlebars 'or' helper (newly registered) for the (or user.orgAgentDisplayName \"Luqen Assistant\") fallback — avoids branching in the partial."
  - "[32-06] loadPanel uses DOMParser + importNode (NOT innerHTML) even for trusted same-origin server-rendered HTML — defence-in-depth for T-32-06-01/02 + clean removal of the XSS sink surface."
  - "[32-06] Vitest-based E2E over Playwright — the dashboard package has no Playwright installation and its existing E2E tests are vitest-based (auth-flow-e2e, scan-flow-e2e). Adding a second runner mid-phase would fragment CI; the accessibility axe-core gate is deferred to a follow-up that installs the runner."
  - "[32-06] Fragment renderer for /agent/panel compiles agent-messages.hbs once per process + caches — keeps the route handler decoupled from reply.view's layout wrapper so the response is pure markup."

# Metrics
duration: ~60m
tasks_completed: 4
files_changed: 12 (5 created, 7 modified)
started: 2026-04-23T19:00:00Z
completed: 2026-04-23T19:25:00Z
---

# Phase 32 Plan 06: Chat Drawer + Floating Button + EventSource Client Summary

One-liner: Right-side chat drawer + floating launcher rendered on every authenticated page via shared-layout injection, wired to /agent/* with plain EventSource streaming (D-21), localStorage persistence (D-18), DOMParser-based safe fragment adoption (no innerHTML sink), 214-LOC IIFE client, 162-LOC scoped CSS banner, and 29 agent.* i18n keys across 6 locales.

## Scope

Delivered:

- **Drawer + button shell**: 3 new Handlebars partials (agent-drawer, agent-messages, agent-message) registered with `@fastify/view`; mounted inside `{{#if user}}` in main.hbs so the drawer only renders for authenticated sessions (T-32-06-03 mitigation) and survives HTMX-boosted nav.
- **Streaming client**: `packages/dashboard/src/static/agent.js` — IIFE, CSP-safe (no inline handlers, no eval), plain `EventSource` per D-20/D-21 with `es.close()` on both `done` and `error` (AI-SPEC §3 Pitfall 3). Token text appended via `createTextNode` (T-32-06-01). Tool-calls rendered via `JSON.stringify` + `textContent` (T-32-06-02).
- **Rolling-window render**: `/agent/panel` stub shipped by Plan 04 replaced with real server-side render via `ConversationRepository.getWindow(conversationId)` + cached Handlebars compile of `agent-messages.hbs`. Empty conversation → empty-state with first-open greeting.
- **localStorage persistence**: `luqen.agent.panel` = `'open' | 'closed'` read on DOMContentLoaded and re-applied before first paint; writes on every open/close.
- **Org display name plumbing**: `request.user.orgAgentDisplayName` populated in server.ts preHandler from `storage.organizations.getOrg(currentOrgId).agentDisplayName`; `user` exposed in the global view-merge context so `main.hbs` can read it on every page.
- **CSS**: 162 LOC under a new `/* ---- Agent Drawer (Phase 32) ---- */` banner, all values from existing design-token custom properties, mobile-first breakpoint at 900px, reduced-motion respected.
- **i18n**: 29 `agent.*` keys across en/de/es/fr/it/pt (28 from UI-SPEC Copywriting Contract + `agent.confirm.pendingBadge`).
- **E2E smoke**: 5 vitest tests + 3 todo markers.

Not delivered (deferred and documented):

- Playwright + `@axe-core/playwright` accessibility gate. No Playwright is installed in the repo; existing E2E tests are vitest-based. Deferred to a follow-up infra plan.
- Native `<dialog>` confirmation UX for destructive tool calls (Plan 07 scope).
- Speech API wiring beyond feature-detect (Plan 07 scope).

## Implementation Notes

- Handlebars `or` helper registered in server.ts:
  ```ts
  handlebars.registerHelper('or', (...args) => {
    const values = args.slice(0, -1);
    return values.find((v) => Boolean(v)) ?? '';
  });
  ```
  Used by main.hbs as `(or user.orgAgentDisplayName "Luqen Assistant")`.

- `/agent/panel` renderer uses a cached compile to avoid a hot-path filesystem read. Inline `t` + `eq` helper fallbacks are defensive — production hits the globally-registered helpers.

- `loadPanel()` uses `new DOMParser().parseFromString(html, 'text/html')` + `document.importNode` to adopt the trusted server fragment. `innerHTML` never appears in live code — the three hits in the source are all inside comments.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Session.ts vs server.ts preHandler for user.orgAgentDisplayName population**
- **Found during:** Task 1
- **Issue:** Plan Task 1 action step 5 says "Edit packages/dashboard/src/auth/session.ts ... Find where request.user is populated, add the orgAgentDisplayName read". But `request.user` is populated in `auth/middleware.ts` (createAuthGuard), and `currentOrg` resolution happens in server.ts preHandler (lines 675-693). session.ts owns only cookie/secret config.
- **Fix:** Populated `request.user.orgAgentDisplayName` in server.ts preHandler immediately after `currentOrg` is fetched — the correct site for the read. Extended `AuthUser` interface in middleware.ts to include the new optional field. Added `user: request.user` to the global view-merge context so the shared layout can render the drawer on every authenticated page without each route repassing user.
- **Files modified:** packages/dashboard/src/auth/middleware.ts, packages/dashboard/src/server.ts
- **Commit:** 886f6cc

**2. [Rule 2 - Missing critical functionality] Handlebars 'or' helper absent**
- **Found during:** Task 1
- **Issue:** main.hbs injection uses `(or user.orgAgentDisplayName "Luqen Assistant")` but only `eq`/`gt` helpers were registered globally.
- **Fix:** Registered a standard `or` helper returning the first truthy argument. No touching of the plan's injection syntax.
- **Files modified:** packages/dashboard/src/server.ts
- **Commit:** 886f6cc

**3. [Rule 3 - Blocking] Playwright + @axe-core/playwright not installed**
- **Found during:** Task 4
- **Issue:** Plan Task 4 called for a Playwright spec with an `@axe-core/playwright` accessibility gate. Neither dependency exists in the repo; the existing `tests/e2e/*.test.ts` specs are vitest-based and run against Fastify's `server.inject()`.
- **Fix:** Wrote a vitest + Fastify smoke spec matching the established pattern (auth-flow-e2e, scan-flow-e2e). 5 tests assert the Plan 06 invariants (partial shape, agent.js invariants, main.hbs mount placement, /agent/panel fragment, 429 JSON contract). 3 `test.todo` markers document the Playwright/axe-core gate for follow-up.
- **Files modified:** packages/dashboard/tests/e2e/agent-panel.test.ts
- **Commit:** 53de676

## Deferred Issues

- Playwright + axe-core accessibility gate (see Deviation 3) — logged for a follow-up infra plan.
- `POST /agent/message` response markup (`<div class="agent-msg agent-msg--user">…</div>`) is a flat `escapeHtml`ed span, not a full `agent-message` partial render. Fixing it would require touching Plan 04's route tests; left as-is for cohesion with Plan 04's acceptance.
- 8 pre-existing test failures in `tests/mcp/*.test.ts` and `tests/e2e/auth-flow-e2e.test.ts` remain — unchanged, documented in `.planning/phases/32-agent-service-chat-ui/deferred-items.md`.

## Verification Results

Invariant grep checks (from prompt success criteria):
- `grep -c "hx-sse" packages/dashboard/src/static/agent.js packages/dashboard/src/views/partials/agent-drawer.hbs` → 0 in agent-drawer.hbs; agent.js shows only comment references (stripped by Test 3)
- `grep -cE "EventSource|new EventSource" packages/dashboard/src/static/agent.js` → 3
- `grep -c "luqen.agent.panel" packages/dashboard/src/static/agent.js` → 1 (const `LS_KEY`; used 2× via the constant)
- `grep -E "getWindow\(|ConversationRepository" packages/dashboard/src/routes/agent.ts` → 4 matches
- `grep -c "aria-live" packages/dashboard/src/views/partials/agent-drawer.hbs` → 2
- `grep -c "prefers-reduced-motion" packages/dashboard/src/static/style.css` → 2 (global + Phase 32 banner)
- `grep -l "agent.drawer\|agent.input\|agent.greeting" packages/dashboard/src/i18n/locales/*.json | wc -l` → 6
- Shared layout launcher: `grep "agent-drawer" main.hbs` → present inside `{{#if user}}` block ✓
- Agent Drawer banner LOC: 162 ≤ 200 ✓
- agent.js LOC: 214 ≤ 250 ✓

Test regression:
- 2975 pass / 8 pre-existing failures / 40 skipped / 3 todo (Playwright-awaiting) — no new regressions.
- `npx tsc --noEmit` clean.

## Self-Check: PASSED

All 5 created files exist on disk.
All 4 task commits resolved via `git log --oneline`.
Build-critical invariants verified (EventSource present, es.close ≥2, localStorage key present, innerHTML absent from live code, DOMParser-based adoption, D-20/D-21 compliance).
