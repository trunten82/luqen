---
phase: 32-agent-service-chat-ui
plan: 05
subsystem: admin-ui-llm
tags: [admin-ui, handlebars, i18n, agent-conversation, agent-system, locked-fences, anthropic, defence-in-depth, surface-3, surface-4, surface-5c]

# Dependency graph
requires:
  - phase: 32-agent-service-chat-ui
    plan: 01
    provides: LLMProviderRegistry.anthropic entry (models tab auto-lists Anthropic rows)
  - phase: 32-agent-service-chat-ui
    plan: 02
    provides: agent-conversation capability + agent-system prompt + server-side orgId guard (paired with this plan's UI-layer guard — defence-in-depth)
  - phase: 32-agent-service-chat-ui
    plan: 04
    provides: DASHBOARD_TOOL_METADATA with confirmationTemplate + destructive markers (consumed to compute agentConvMetadata manifest/destructive counts)
provides:
  - /admin/llm?tab=capabilities renders agent-conversation row with tool-use badge + per-org manifest-size badge + pluralised destructive-count badge + iteration-cap copy + destructive-tools expander
  - /admin/llm?tab=prompts renders agent-system prompt with three visually-distinct locked cards (rbac/confirmation/honesty — distinct border-left colors) + info pill explaining per-org override disablement + UI-layer hide of per-org-override control
  - /admin/llm?tab=models auto-lists Anthropic rows when registry seeded (no template change needed — existing per-provider loop iterates automatically)
  - ~22 new i18n keys under admin.llm.agentConv.* + admin.llm.prompts.locked{Rbac,Confirm,Honesty}Tooltip + admin.llm.prompts.agentSystemGlobalOnly* + admin.llm.models.* across all 6 locales
  - 6 integration tests asserting view-data shape for the new agent surfaces
affects: [32-06-chat-drawer-panel, 32-07-chat-ui-client-js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "View-data testing via reply.view stub returning JSON: mirrors the existing llm-prompts.test.ts shape — decouples admin-UI route tests from the Handlebars engine while still asserting the full data bag the template receives"
    - "Variant-class rendering in a shared partial: prompt-segments.hbs accepts a parent context flag (agentSystem=true) and maps the LOCKED fence .name → card--locked-{{name}} class, keeping the non-agent (output-format) locked path untouched"
    - "UI-layer gate paired with server-side gate for D-14 prompt-injection defence: {{#if (eq capability 'agent-system')}} hides the per-org-override control in the template; Plan 02 rejects orgId-scoped writes at the route — grep surfaces both halves"
    - "Per-org manifest size computed in route handler: filterToolsByRbac(DASHBOARD_TOOL_METADATA, permissions).length — badge reflects THIS admin's org, so the destructive-count badge matches what agents actually see (not a global maximum)"

key-files:
  created:
    - packages/dashboard/tests/routes/admin/llm.test.ts
  modified:
    - packages/dashboard/src/routes/admin/llm.ts (CAPABILITY_NAMES += agent-conversation; agentConvMetadata + AGENT_SYSTEM_LOCKED_FENCES passed to view)
    - packages/dashboard/src/views/admin/llm.hbs (capabilities tab: agent-conversation badges + iteration-cap copy + destructive expander + hidden-alert div; prompts tab: agent-system info pill + sr-only tooltip + override hide + agentSystem=true to partial)
    - packages/dashboard/src/views/admin/partials/prompt-segments.hbs (locked section: card--locked-{{name}} class + sr-only tooltip text when parent agentSystem=true)
    - packages/dashboard/src/static/style.css (/* ---- Agent Admin (Phase 32) ---- */ banner: 4 lines — .card--locked-rbac/confirmation/honesty border-left + #agent-conv-non-tool-alert[hidden] rule)
    - packages/dashboard/src/i18n/locales/en.json (+19 keys)
    - packages/dashboard/src/i18n/locales/de.json (+19 keys, English fallback)
    - packages/dashboard/src/i18n/locales/es.json (+19 keys, English fallback)
    - packages/dashboard/src/i18n/locales/fr.json (+19 keys, English fallback)
    - packages/dashboard/src/i18n/locales/it.json (+19 keys, English fallback)
    - packages/dashboard/src/i18n/locales/pt.json (+19 keys, English fallback)

key-decisions:
  - "agentConvMetadata computed from THIS admin's org manifest (not a global maximum): destructive counter reflects what this org's agent actually exposes — UX clarity for multi-tenant deployments"
  - "UI-layer override hide ({{#if eq capability 'agent-system'}}) pairs with Plan 02's route-level orgId guard: defence-in-depth so a form-replay attack also needs to bypass the route"
  - "Non-English locales ship English fallbacks for the 19 new keys: ensures admin pages never 404 on missing keys; translations are a follow-up localisation pass, not a blocker for the agent UI feature"
  - "prompt-segments.hbs partial extended in-place (not forked): parent passes agentSystem=true, name is mapped to card--locked-{{name}} — reuse path keeps the non-agent locked sections (e.g. output-format) unchanged and un-tested by new tests"
  - "Route tests stub reply.view to JSON (llm-prompts.test.ts pattern) instead of rendering Handlebars: faster tests + assertions target the contract (data bag shape), not the render engine"
  - "Task 4 Test E (Anthropic) verifies provider-list propagation rather than mocking specific Anthropic models: the route already iterates providers, so once Plan 01's registry seed lands in production DB, zero UI change is needed"

patterns-established:
  - "Scoped admin banner in style.css: '/* ---- Agent Admin (Phase 32) ---- */' — easy future grep for Phase 32 CSS when Plan 06 adds the drawer banner"
  - "TODO breadcrumb for capability-name list duplication: the local CAPABILITY_NAMES in packages/dashboard/src/routes/admin/llm.ts carries a TODO(phase-33) comment pointing to @luqen/llm/types — resolves the PATTERNS.md 'Resolved Ambiguities' breadcrumb"

requirements-completed:
  - AGENT-02

# Metrics
duration: ~45min (three feat commits landed prior to this SUMMARY pass, Task 4 test commit + SUMMARY by current executor)
completed: 2026-04-20
---

# Phase 32 Plan 05: Admin-LLM UI extensions (Surfaces 3, 4, 5C) Summary

**Extended the existing `/admin/llm` admin surface for the new agent-conversation capability + the agent-system prompt (with three visually-distinct locked fences + UI-level hide of per-org override) + Anthropic provider rendering. Pure UI-layer work — backend catalog entries landed in Plans 01+02; this plan adds the admin control surface, ~22 i18n keys across 6 locales, 4 lines of scoped CSS, and 6 integration tests asserting the view-data shape.**

## Performance

- **Duration:** ~45 min aggregate across the plan
- **Tasks:** 4 (1 route-handler change → 2 template+partial+CSS → 3 i18n → 4 integration tests)
- **Files created:** 1 (llm.test.ts)
- **Files modified:** 10 (route + template + partial + style + 6 locales)
- **Commits:** 4 (one per task, atomic)

## Accomplishments

### Task 1 — admin-llm route handler

- Appended `'agent-conversation'` to the local `CAPABILITY_NAMES` constant; `// TODO(phase-33): import CAPABILITY_NAMES from '@luqen/llm/types' once ambient declarations wire in dashboard package` breadcrumb added per PATTERNS.md Resolved Ambiguities.
- `agentConvMetadata = { supportsToolsRequired: true, iterationCap: 5, manifestSize, destructiveCount, destructiveTools }` computed per-request from `filterToolsByRbac(DASHBOARD_TOOL_METADATA, resolveEffectivePermissions(...))` — reflects THIS admin's org manifest, not a global max.
- Module-scoped `AGENT_SYSTEM_LOCKED_FENCES` constant with `[{name:'rbac', tooltipKey:'admin.llm.prompts.lockedRbacTooltip'}, {name:'confirmation', tooltipKey:'admin.llm.prompts.lockedConfirmTooltip'}, {name:'honesty', tooltipKey:'admin.llm.prompts.lockedHonestyTooltip'}]` passed to prompts-tab template data.
- Both new fields plumbed into the `reply.view(...)` data bag.

### Task 2 — llm.hbs + prompt-segments.hbs + style.css

- **Capabilities tab (agent-conversation row only):** tool-use badge (`admin.llm.agentConv.requiresToolUse`), manifest-size badge with 0-count → `.badge--error` / >0 → `.badge--info` branch, three-way pluralised destructive-count badge (destructiveZero/One/Many), iteration-cap static copy, `<details>` expander listing destructive tool names, hidden `<div id="agent-conv-non-tool-alert" hidden>` placeholder for the client-side non-tool-use alert.
- **Prompts tab (agent-system entry only):** info pill `.badge.badge--info` with `aria-describedby="agent-system-override-explain-agent-system"` → sr-only span carrying the tooltip copy; `{{#if (eq capability 'agent-system')}}` gate hides the per-org-override control block (UI-layer half of D-14); `{{> prompt-segments ... agentSystem=true}}` invokes the partial with the variant-enabling flag.
- **prompt-segments.hbs:** the locked branch now emits `<div class="card card--muted{{#if ../agentSystem}} card--locked-{{name}}{{/if}}">` — fence `.name` (rbac/confirmation/honesty, already present in the segment data) directly drives the modifier class. Three sr-only tooltip branches with if-eq name checks.
- **style.css:** `/* ---- Agent Admin (Phase 32) ---- */` banner + 4 lines — `.card--locked-rbac` (status-info blue), `.card--locked-confirmation` (status-warning amber), `.card--locked-honesty` (status-success green), `#agent-conv-non-tool-alert[hidden]{display:none}` belt-and-braces. Zero `helper-text` introduced (UI-checker invariant).
- **Anthropic rendering (Surface 5C):** NO template change — the models tab's existing `{{#each modelsByProvider}}` loop picks up anthropic rows the moment Plan 01's registry seed lands.

### Task 3 — i18n (19 keys × 6 locales)

- en.json: all 19 values verbatim from UI-SPEC Copywriting Contract (agentConv.requiresToolUse / nonToolBlock / iterationCap / manifestSize / destructiveZero/One/Many / destructiveExpand; prompts.agentSystemName / lockedRbacTooltip / lockedConfirmTooltip / lockedHonestyTooltip / editableToneLabel / agentSystemGlobalOnly / agentSystemGlobalOnlyTooltip; models.providerAnthropic / supportsTools / costHeader / costCell).
- de/es/fr/it/pt: same key set, English fallback values — proper noun "Anthropic" identical across locales; the non-en locale files `JSON.parse` cleanly.

### Task 4 — integration tests

- `packages/dashboard/tests/routes/admin/llm.test.ts` (230 LOC, 6 tests, all passing):
  - **Test A:** `GET /admin/llm?tab=capabilities` → `data.capabilities[].name` contains `'agent-conversation'` + `agentConvMetadata.supportsToolsRequired === true`.
  - **Test B:** same response → `iterationCap === 5`, numeric manifestSize + destructiveCount, array destructiveTools.
  - **Test C:** `GET /admin/llm?tab=prompts` → `data.prompts[].capability` contains `agent-system`, `agent-conversation`, `generate-fix`.
  - **Test D:** same response → `agentSystemLockedFences` exactly `[rbac, confirmation, honesty]` with tooltipKey regex matching `^admin\.llm\.prompts\.locked(Rbac|Confirm|Honesty)Tooltip$`.
  - **Test E:** `GET /admin/llm?tab=models` with mocked anthropic provider → `modelsByProvider` includes type `anthropic` + name `Anthropic` (proves registry→UI pipe).
  - **Test F (defence-in-depth):** `data.prompts.agent-system` entry has NO `orgOverride` / `perOrgOverride` field — route-data-level negative assertion complementing the template-level hide.

## Task Commits

1. `1ce23b7` **feat(32-05): Task 1** — admin-llm route extends CAPABILITY_NAMES + computes agentConvMetadata + AGENT_SYSTEM_LOCKED_FENCES
2. `bfb9c78` **feat(32-05): Task 2** — admin-llm surfaces for agent-conversation + agent-system fences (template + partial + style.css)
3. `e4ff1b3` **feat(32-05): Task 3** — i18n keys for agent admin surfaces across 6 locales
4. `327af24` **test(32-05): Task 4** — admin-llm integration tests for agent-conversation + agent-system + Anthropic surfaces

## Verification

- `cd packages/dashboard && npx tsc --noEmit` → 0 errors
- `npx vitest run tests/routes/admin/llm.test.ts` → 6/6 passing
- `npx vitest run` (full dashboard suite) → 2970 passed, 8 failed (all pre-existing, logged in `.planning/phases/32-agent-service-chat-ui/deferred-items.md` from Plan 32-04: Phase-30 tool-count tests + auth-flow-e2e returnTo mismatch — none touch admin-llm code)
- `grep -c "agentConvMetadata\|agentConv" packages/dashboard/src/views/admin/llm.hbs` → 14 (iteration cap + badges + expander + per-org-manifest branches)
- `grep -c "card--locked-" packages/dashboard/src/static/style.css` → 3 (rbac + confirmation + honesty)
- `grep -c "Agent Admin (Phase 32)" packages/dashboard/src/static/style.css` → 1 (scoped banner, no duplication)
- `grep -l "requiresToolUse" packages/dashboard/src/i18n/locales/*.json | wc -l` → 6 (all locales)
- `grep -c "helper-text" packages/dashboard/src/{views/admin/llm.hbs,static/style.css}` → 0+0 (UI-checker invariant upheld — only `.form-hint` used)
- All 6 locale JSON files `JSON.parse` cleanly
- UI-layer override hide visible in llm.hbs at `{{#if (eq capability 'agent-system')}}` branches (lines 367 + 381 — pill on 367, agentSystem=true on 382)

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed as written across all 4 tasks.

### Notes on numbering

Task 4's commit used the test type `test(32-05): Task 4` rather than `feat` to reflect that the untracked `llm.test.ts` was a pure test addition (no implementation code in this task). Plan's action item 5 specified `test(32-05): admin-llm tab tests...` format — honored.

## Deferred Issues

None introduced by this plan. Pre-existing 8 failing tests remain logged in `deferred-items.md` (Phase 30 MCP tool-count gap + auth-flow returnTo test staleness) — Plan 32-04 already documented them as out-of-scope for Phase 32 executors.

## Threat Surface Scan

No new threat surface. The plan's `<threat_model>` T-32-05-01 (HTML-in-tool-names) is mitigated by Handlebars default-escaping (no `{{{` triple-stache introduced — confirmed by grep on llm.hbs and prompt-segments.hbs). T-32-05-04 (per-org override UI hidden + server-side orgId rejection) is the documented defence-in-depth pair, asserted by Test F plus the template gate.

## Self-Check

- File `packages/dashboard/tests/routes/admin/llm.test.ts` — FOUND
- File `packages/dashboard/src/routes/admin/llm.ts` — FOUND
- File `packages/dashboard/src/views/admin/llm.hbs` — FOUND
- File `packages/dashboard/src/views/admin/partials/prompt-segments.hbs` — FOUND
- File `packages/dashboard/src/static/style.css` — FOUND
- All 6 locale JSON files — FOUND and parse cleanly
- Commit `1ce23b7` — FOUND
- Commit `bfb9c78` — FOUND
- Commit `e4ff1b3` — FOUND
- Commit `327af24` — FOUND

## Self-Check: PASSED
