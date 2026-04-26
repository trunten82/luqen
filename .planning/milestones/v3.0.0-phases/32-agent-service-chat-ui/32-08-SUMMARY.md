---
phase: 32-agent-service-chat-ui
plan: 08
subsystem: dashboard-admin-ui
tags: [admin, organizations, agent-display-name, zod, i18n, prompt-injection-defence, xss-defence]

requires:
  - phase: 32-agent-service-chat-ui
    provides: "Plan 03 — migration 055 (agent_display_name column) + OrgRepository.updateOrgAgentDisplayName silent-no-op writer"
  - phase: 32-agent-service-chat-ui
    provides: "Plan 06 — orgAgentDisplayName surfaced on request.user so the drawer already consumes what this plan lets admins edit"
provides:
  - "GET + POST /admin/organizations/:id/settings handlers on organizations.ts (Zod-validated agent_display_name write-path)"
  - "views/admin/organization-settings.hbs single-field admin form (Surface 5 Part D — UI-SPEC)"
  - "7 new i18n keys under admin.organizations.settings.* across all 6 locales"
  - "Closes Phase 32 — the remaining per-org knob lets admins personalise the chat companion (D-14, D-19, APER-02)"
affects:
  - "Plan 06 greeting + drawer header — admin-set name now flows end-to-end"
  - "Plan 04 system-prompt interpolation — admin-set name appears in AgentService tool prompts"

tech-stack:
  added: []
  patterns:
    - "Single-field admin-settings route: GET renders form partial pre-filled from DB; POST validates with Zod safeParse + maps zod-issue message to i18n error key; re-renders the same partial with either trailingToast (success) or error+submittedValue (failure)"
    - "Zod message codes (TOO_LONG, HTML_OR_URL) as stable machine tags decoupled from user-facing copy — i18n resolves the display text per request locale"
    - "Handlebars default-escape on user-provided strings — no triple-braces on {{org.agentDisplayName}} or {{submittedValue}}; defence-in-depth against stored-XSS even if the Zod regex were bypassed"

key-files:
  created:
    - "packages/dashboard/tests/routes/admin/organization-settings.test.ts"
    - "packages/dashboard/src/views/admin/organization-settings.hbs"
  modified:
    - "packages/dashboard/src/routes/admin/organizations.ts (new GET+POST /settings handlers + Zod schema + resolveLocale helper + t/Locale imports)"
    - "packages/dashboard/src/i18n/locales/en.json"
    - "packages/dashboard/src/i18n/locales/de.json"
    - "packages/dashboard/src/i18n/locales/es.json"
    - "packages/dashboard/src/i18n/locales/fr.json"
    - "packages/dashboard/src/i18n/locales/it.json"
    - "packages/dashboard/src/i18n/locales/pt.json"

key-decisions:
  - "i18n namespace is admin.organizations.settings.* (not admin.orgs.settings.* as the plan aspirationally specified) — matches the existing admin.organizations.* root used by organization-form.hbs and the 39 sibling keys. Zero other call-sites break."
  - "Zod message codes TOO_LONG / HTML_OR_URL act as stable machine tags; user-facing text is resolved via i18n at the route — decouples validation logic from copy translation, lets the same regex surface in 6 languages with one map."
  - "Error rendering uses reply.code(400).view(...) — requires the view helper to NOT reset the status code. The test harness stub was updated to preserve status code (removed the hard-coded .code(200) that was clobbering 400 responses)."
  - "CSRF is enforced by the server-level @fastify/csrf-protection plugin (not per-route). Tests register csrf-protection explicitly via opts.withCsrf and mint a token through a synthetic /csrf route — mirrors the oauth/authorize test pattern for isolated CSRF coverage."
  - "Empty-string ('') and null are both accepted at the route. Plan 03's repo layer preserves the distinction at the DB level. The drawer's D-19 greeting fallback treats both as 'clear' and renders 'Luqen Assistant'."

patterns-established:
  - "Per-org admin settings form with i18n-localised validation errors — reusable for future per-org knobs (e.g. chat drawer theme, default landing page)"
  - "Status-preserving view-stub pattern for tests that render handlebars — `.header().send()` without `.code()` keeps the handler's code() call honoured"

requirements-completed:
  - APER-02
  - AGENT-01

duration: ~10min
completed: 2026-04-23
---

# Phase 32 Plan 08: Agent Display Name Org-Settings Form Summary

**Closes Phase 32 Surface 5 Part D — admin-editable per-org `agent_display_name` via GET+POST `/admin/organizations/:id/settings` with Zod-validated prompt-injection + XSS defence and i18n-localised error copy across 6 locales.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-23T19:50:56Z
- **Completed:** 2026-04-23T20:00:14Z
- **Tasks:** 2/2 (RED + GREEN; REFACTOR skipped — landed clean)
- **Files modified:** 8 source + 1 test = 9 total
- **Test delta:** +14 (13 plan-specified + 1 view-contract)

## Accomplishments

- New `GET /admin/organizations/:id/settings` route renders `organization-settings.hbs` pre-filled with the org's stored `agent_display_name`. 404 on missing org; 403 on cross-org (admin.org of a different org).
- New `POST /admin/organizations/:id/settings` route Zod-validates the body field, persists via `storage.organizations.updateOrgAgentDisplayName` (Plan 03), and re-renders the partial with either a trailing success toast or a 400 + error-key + preserved submitted value.
- Zod schema: `z.string().trim().max(40).refine(v => v === '' || !HTML_OR_URL_RE.test(v))` where `HTML_OR_URL_RE = /[<>]|https?:\/\/|\/\//`. Empty string is explicitly allowed (clear / fall back to "Luqen Assistant"). Whitespace is trimmed pre-length-check per `.trim()` chain order.
- New single-field HBS view under `admin/organization-settings.hbs` using existing design-system classes (`.card`, `.form-group`, `.form-hint`, `.form-error`, `.btn--primary`). `aria-describedby` wires hint + error to the input for screen readers. `role="alert"` on the error element is hidden via `{{#unless error}} hidden{{/unless}}`.
- 7 new i18n keys (title, agentDisplayName, agentDisplayNamePlaceholder, agentDisplayNameHint, agentDisplayNameTooLong, agentDisplayNameHtml, agentDisplayNameSaved, agentDisplayNameError — count includes title; plan spec listed 7 functional keys + title) landed in all 6 locales with native translations (English fallback for de/fr/es/it/pt was the plan's acceptance minimum; native strings included for a11y parity).
- 14 tests green: 4 GET (pre-fill fresh / pre-fill seeded / admin.org same-org / admin.org cross-org 403), 9 POST (happy Luna, empty reset, too-long 400, HTML 400, URL 400, protocol-relative 400, CSRF missing 403, cross-org 403, trim-whitespace), 1 view-file contract check.
- Full dashboard suite: 3002 passing + 40 skipped + 3 todo + 8 pre-existing failures (all documented in `deferred-items.md` — Phase 30 tool-list scope-filter mismatch + Phase 31.1 auth returnTo redirect path).
- `npx tsc --noEmit` clean.
- All 6 locale JSON files parse valid.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — /admin/organizations/:id/settings GET+POST with zod validation** — `8d4d71d` (test)
2. **Task 2: GREEN — agent_display_name org-settings form + validation (D-14, D-19, APER-02)** — `dea2d64` (feat)

_Note: Plan `type: tdd`. RED + GREEN gates present. REFACTOR was skipped — the implementation landed clean (single-file route extension, single view file, straightforward i18n updates). No dead code, no duplicated helpers._

## Files Created/Modified

### Tests (created)
- `packages/dashboard/tests/routes/admin/organization-settings.test.ts` — 14 tests covering GET pre-fill, tenant isolation, POST happy path, Zod validation branches, CSRF enforcement, cross-org defence, whitespace trim, and view-file contract

### Source (modified)
- `packages/dashboard/src/routes/admin/organizations.ts` — added `z` + `t` + `Locale` imports; `HTML_OR_URL_RE` regex; `AgentDisplayNameSchema` Zod schema; `resolveLocale(request)` helper; new GET handler at `/admin/organizations/:id/settings`; new POST handler at same path with `safeParse` + zod-issue → i18n-key mapping + error-re-render + success-toast-re-render paths
- `packages/dashboard/src/i18n/locales/en.json` — added `admin.organizations.settings.*` block with 8 keys (title + 7 agentDisplayName keys)
- `packages/dashboard/src/i18n/locales/de.json`, `es.json`, `fr.json`, `it.json`, `pt.json` — mirrored keys with native translations

### Source (created)
- `packages/dashboard/src/views/admin/organization-settings.hbs` — Surface 5 Part D form partial: CSRF hidden input, form-group wrapper, labelled input with id="agent-display-name" + name="agent_display_name" + maxlength="40" + aria-describedby, form-hint paragraph, role="alert" form-error paragraph, btn--primary submit, optional trailingToast OOB block

## Verification Results

- `cd packages/dashboard && npx vitest run tests/routes/admin/organization-settings.test.ts` — **14/14 green**
- `cd packages/dashboard && npx vitest run` — **3002 pass + 40 skipped + 3 todo + 8 pre-existing failures** (no new regressions; all 8 pre-existing documented in `deferred-items.md`)
- `cd packages/dashboard && npx tsc --noEmit` — **0 errors**
- `grep -cE "agent-display-name|agent_display_name|maxlength=\"40\"" packages/dashboard/src/views/admin/organization-settings.hbs` — **7**
- `grep -c updateOrgAgentDisplayName packages/dashboard/src/routes/admin/organizations.ts` — **2** (import site + call site — plan expected 1; the additional match is the import path `updateOrgAgentDisplayName` referenced in the Plan 03 interface, which is not an additional runtime call)
- `grep -l "agentDisplayNameSaved" packages/dashboard/src/i18n/locales/*.json | wc -l` — **6**
- `grep -cE "\{\{\{[^}]*agentDisplayName" packages/dashboard/src/views/admin/organization-settings.hbs` — **0** (no unescaped triple-braces on user content — XSS defence intact)
- `grep -c "/settings'" packages/dashboard/src/routes/admin/organizations.ts` — **2** (GET + POST handlers)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] i18n namespace path differs from plan spec**
- **Found during:** Task 2 — reading existing `en.json` under `admin.organizations.*`
- **Issue:** Plan specified `admin.orgs.settings.*` as the i18n namespace, but the actual codebase root for org keys is `admin.organizations.*` (39 existing keys under that path, zero under `admin.orgs`).
- **Fix:** Used `admin.organizations.settings.*` instead. Same 8 keys, nested under the existing root. Test assertion updated to match (`admin.organizations.settings.agentDisplayName`).
- **Files modified:** All 6 locale JSON files, `organization-settings.hbs`, `organizations.ts`, and the test file
- **Commit:** `dea2d64`

**2. [Rule 1 - Bug] Stubbed view helper clobbered 400 status codes**
- **Found during:** First GREEN run — 4 Zod-validation tests expected 400 but received 200
- **Issue:** The copied test-harness stub for `reply.view` hard-coded `this.code(200).header(...).send(...)` which overrode any earlier `reply.code(400).view(...)` call in the handler. This meant every validation-failure test saw a 200 response instead of the intended 400.
- **Fix:** Dropped the `.code(200)` from the stub — the handler's status code (`reply.code(400).view(...)` for errors, default 200 for success) is now respected. This is the correct Fastify pattern: `reply.view` should preserve the status set earlier in the chain.
- **Files modified:** `packages/dashboard/tests/routes/admin/organization-settings.test.ts`
- **Commit:** `dea2d64` (part of the GREEN commit; the fix landed before RED→GREEN gate passed)

**3. [Rule 3 - Blocking] i18n translations not loaded in vitest harness**
- **Found during:** First GREEN run — POST tests returned 500 instead of 400/200
- **Issue:** `t()` dereferences `translations.get('en')!` on fallback path. When `loadTranslations()` is never called, this is `undefined!` → throws when keys are read. The server.ts startup path calls `loadTranslations()` at boot, but test files that import routes directly skip that bootstrap.
- **Fix:** Added an explicit `loadTranslations()` call at the top of the test file (module-level, runs once at import).
- **Files modified:** `packages/dashboard/tests/routes/admin/organization-settings.test.ts`
- **Commit:** `dea2d64`

### Not Auto-fixed (intentional)

**4. Migration numbering in plan stale — unchanged, Plan 03 already handled it**
- Plan 08 references "migration 050" in some places; Plan 03 landed as migration 055 (050-054 were taken by Phase 31.1/31.2). No action needed at this plan — Plan 03's summary documented the renumbering and the repo method name (`updateOrgAgentDisplayName`) is unchanged.

## Known Stubs

None. All work is runnable as committed.

## Deferred Issues

Pre-existing test failures (8 total, confirmed pre-Phase-32-08 on master):
- `tests/mcp/data-tools.test.ts` — 2 failures (Phase 30 scope-filter vs test expectations)
- `tests/mcp/admin-tools.test.ts` — 3 failures (same root cause)
- `tests/mcp/http.test.ts` — 1 failure (same root cause)
- `tests/e2e/auth-flow-e2e.test.ts` — 2 failures (Phase 31.1 Plan 02 Task 3 returnTo redirect path; tests assert bare `/login` but middleware now emits `/login?returnTo=%2Fhome`)

All 8 documented in `.planning/phases/32-agent-service-chat-ui/deferred-items.md`. Out of scope per Plan 08 — none are in files Plan 08 modifies; none affect the new routes or view.

## Threat Flags

None. This plan's surfaces map cleanly to the plan's `<threat_model>` register (T-32-08-01..06):
- T-32-08-01 Prompt injection via display name — mitigated by Zod regex at route + Plan 04 interpolation guard (Test 8/9/10 regress).
- T-32-08-02 XSS via display name in chat drawer — mitigated by Handlebars default-escape (grep of `{{{` on user content = 0) + Zod regex defence-in-depth.
- T-32-08-03 Cross-org write — mitigated by tenant check (Test 12 regresses).
- T-32-08-04 CSRF — mitigated by `@fastify/csrf-protection` plugin (Test 11 regresses).
- T-32-08-05 DOS via long input — mitigated by maxlength=40 client + z.max(40) server (Test 7 regresses).

No new trust boundaries introduced.

## Self-Check: PASSED

- `packages/dashboard/src/views/admin/organization-settings.hbs` exists — FOUND
- `packages/dashboard/src/routes/admin/organizations.ts` contains `/settings'` handlers (2 hits) — FOUND
- `updateOrgAgentDisplayName` call in route handler — FOUND
- 6 locale JSON files contain `agentDisplayNameSaved` — FOUND (all 6)
- RED commit `8d4d71d` — FOUND in git log
- GREEN commit `dea2d64` — FOUND in git log
- `packages/dashboard/tests/routes/admin/organization-settings.test.ts` exists — FOUND
- tsc clean — CONFIRMED (no output)

## TDD Gate Compliance

- RED gate: `test(32-08): RED — …` at `8d4d71d` (14 tests added; 13 fail meaningfully on GET/POST absence, 1 fails on hbs file absence)
- GREEN gate: `feat(32-08): GREEN — …` at `dea2d64` (all 14 tests pass; full dashboard suite no new regressions; tsc clean; locales parse)
- REFACTOR gate: intentionally skipped — implementation landed clean with zero code smell

Sequence verified in git log: `test` → `feat` on the same plan scope.

---

## Phase 32 Close

Phase 32 (agent-service-chat-ui) is now COMPLETE — all 8 plans landed.

### Plans shipped
- Plan 01 — LLM streaming adapters (ollama/openai + new anthropic) + parity baseline
- Plan 02 — agent-conversation capability + agent-system prompt + bootstrap seed
- Plan 03 — migration 055 (agent_display_name column) + OrgRepository writer
- Plan 04 — AgentService orchestrator + /agent/* routes + rate-limit + Origin check
- Plan 05 — admin-llm surfaces for agent-conversation + agent-system fences
- Plan 06 — chat drawer + EventSource client + first-open greeting
- Plan 07 — agent-confirm dialog + speech input + recovery-from-DB
- **Plan 08** — per-org agent_display_name admin-settings form (this plan)

### Commit count
~38 plan commits across Phase 32 (grep `32-0[1-8]` on git log since 8 days ago). Atomic TDD pairs per plan + docs/SUMMARY commits.

### Requirements closed
- **APER-02** (agent companion UX — orgdisplay name + friendly greeting) — closed via Plans 06 + 08
- **AGENT-01** (conversation orchestrator) — closed via Plans 02 + 04
- **AGENT-02** (LLM routing via capability engine) — closed via Plans 01 + 02
- **AGENT-03** (chat UI + drawer + SSE + speech) — closed via Plans 06 + 07

### Pre-existing failures (not introduced by Phase 32)
- 6 tests in `tests/mcp/data-tools.test.ts`, `admin-tools.test.ts`, `http.test.ts` (Phase 30 scope-filter expectation drift — tool-count tests use `scopes:['read']` which only grants read-tier while the tools in question require write-tier; tests are stale, implementation correct)
- 2 tests in `tests/e2e/auth-flow-e2e.test.ts` (Phase 31.1 Plan 02 Task 3 returnTo redirect — tests assert bare `/login` but auth middleware now correctly emits `/login?returnTo=%2Fhome`)
- All 8 logged in `.planning/phases/32-agent-service-chat-ui/deferred-items.md` since Plan 32-04.

### Next step
Run `/gsd-verify-phase 32` (or `/gsd-verify-work`) to confirm goal-backward success criteria from ROADMAP.md lines 148-152:
- **SC#1** — chat drawer opens, user types + sees streamed token response (Plans 06 + 04)
- **SC#2** — agent-conversation capability routes through capability-engine with fallback (Plan 02 + 04)
- **SC#3** — Chrome/Edge speech input + Firefox text-only fallback (Plan 07)
- **SC#4** — destructive confirm dialog + DB-recovered pending state on reload (Plans 04 + 07)

This executor should NOT run the verifier inline — the verifier is a separate command the user runs after reviewing the phase. Phase close triggers the v3.0.0 milestone review step at the orchestrator level.
