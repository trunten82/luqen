# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 LLM Module** — [archived](milestones/v2.7.0-ROADMAP.md)
- ✅ **v2.8.0 Admin UX & Compliance Precision** — Phases 06-08 (shipped 2026-04-06) — [archived](milestones/v2.8.0-ROADMAP.md)
- ✅ **v2.9.0 Branding Completeness & Org Isolation** — Phases 09-12 (shipped 2026-04-06) — [archived](milestones/v2.9.0-ROADMAP.md)
- ✅ **v2.10.0 Prompt Safety & API Key Polish** — Phases 13-14 (shipped 2026-04-10) — [archived](milestones/v2.10.0-ROADMAP.md)
- ✅ **v2.11.0 Brand Intelligence** — Phases 15-21 (shipped 2026-04-12) — [archived](milestones/v2.11.0-ROADMAP.md)
- ✅ **v2.12.0 Brand Intelligence Polish** — Phases 22-27 (shipped 2026-04-14) — [archived](milestones/v2.12.0-ROADMAP.md)
- ✅ **v3.0.0 MCP Servers & Agent Companion** — Phases 28-33 (shipped 2026-04-24) — [archived](milestones/v3.0.0-ROADMAP.md)
- 🚧 **v3.1.0 Agent Companion v2 + Tech Debt & Docs** — Phases 34-42 (in progress)

---

## Current Milestone: v3.1.0 Agent Companion v2 + Tech Debt & Docs

**Goal:** Harden v3.0.0's MCP + agent foundation with precise instrumentation, complete the agent companion experience (history, multi-step tool use, polish, org switching), and refresh all documentation.

**Granularity:** coarse · **Phases:** 9 · **Requirements:** 33/33 mapped + OAPI-TBD + INST-TBD

### Phases

- [x] **Phase 34: Tokenizer Precision** — Replace char/4 heuristic with per-provider precise tokenizers feeding the 85% compaction trigger (completed 2026-04-24)
- [x] **Phase 35: Agent Conversation History** — List, search, resume, and delete past agent conversations from the side drawer (completed 2026-04-24)
- [x] **Phase 36: Multi-Step Tool Use** — Parallel tool calls, automatic error recovery, multi-step planning, and tool-selection rationale logging (completed 2026-04-25)
- [x] **Phase 37: Streaming UX Polish** — Interrupt, retry, edit-and-resend, copy, and share for the agent chat (completed 2026-04-25)
- [x] **Phase 38: Multi-Org Context Switching** — Global admins can switch the agent's active org context inside the drawer without re-login (completed 2026-04-25)
- [x] **Phase 39: Verification Backfill & Deferred-Items Triage** — Formal VERIFICATION.md for v3.0.0 phases, Nyquist coverage report, deferred-items resolution (completed 2026-04-25)
- [x] **Phase 40: Documentation Sweep & Installer Refresh** — README, OpenAPI specs, installer scripts (actual files, not just docs), MCP integration guide, agent guide, prompt-template guide, RBAC matrix; create new docs for any v3.1.0 surface (agent history, multi-step tool use, streaming UX, multi-org switching) not yet documented (completed 2026-04-25; DOC-02 PARTIAL → Phase 41, DOC-03 SC #3 awaiting runtime LXC test)
- [x] **Phase 41: OpenAPI Schema Backfill** — Add Fastify route schemas across compliance/branding/llm/dashboard/MCP so `/docs` is substantive and `openapi-drift` + `route-vs-spec` coverage tests go green; closes Plan 40-01 deferred Task 2 and DOC-02 PARTIAL (verified 2026-04-26: 4/5 OAPI requirements PASS; OAPI-04 PARTIAL — dashboard infrastructure shipped but per-route TypeBox `schema:` blocks deferred for ~245 non-MCP routes; OAPI-04 closed by Phase 41.1 verified 2026-04-26 — 7/7 must-haves passed)
- [x] **Phase 41.1: Dashboard non-MCP per-route TypeBox schema backfill** — Mechanical schema: backfill across the remaining ~245 dashboard non-MCP routes flagged in 41-VERIFICATION.md; closes OAPI-04 PARTIAL (verified 2026-04-26: 7/7 must-haves passed; dashboard.json grew 4715→32622 lines, requestBody 2→38, typed 2xx 0→275; new schema-fidelity assertion locks gain in CI)
- [ ] **Phase 42: Installer Wizard Redesign** — Replace v2-era 2/3-way wizard with a 4-profile model (Scanner CLI, API services, Self-hosted dashboard, Docker Compose) that maps onto the actual v3.1.0 codebase (5 services + monitor agent); register `@luqen/monitor` across systemd/launchd/NSSM for the first time

### Phase Details

#### Phase 34: Tokenizer Precision
**Goal**: Token counts powering the 85% compaction trigger are accurate per-model rather than a 4-char approximation.
**Depends on**: Nothing (foundational tech debt; unblocks correct compaction for all later phases)
**Requirements**: TOK-01, TOK-02, TOK-03, TOK-04, TOK-05
**Success Criteria** (what must be TRUE):
  1. `countTokens(messages, model)` returns precise token counts for Ollama, OpenAI, and Anthropic models via per-provider BPE/tiktoken backings.
  2. Total bundle impact is under 5 MB and contains no native binaries (lightweight pure-JS or wasm only).
  3. The 85% compaction threshold fires on real token counts; existing compaction UX is unchanged for end users.
  4. Unknown models fall back to the legacy `char/4` heuristic and emit a warning log identifying the model.
**Plans**: 3 plans
- [x] 34-01-PLAN.md — Tokenizer registry + OpenAI/Anthropic/Ollama backends with char/4 fallback + warn-once
- [x] 34-02-PLAN.md — Wire countMessageTokens into token-budget.ts + AgentService modelId threading + pre-warm
- [x] 34-03-PLAN.md — End-to-end integration tests, bundle-size guard (<5 MB), monotonicity property tests

#### Phase 35: Agent Conversation History
**Goal**: Users can find and resume any past agent conversation from a searchable, accessible side-drawer history.
**Depends on**: Phase 34 (precise compaction so resumed conversations stay coherent)
**Requirements**: AHIST-01, AHIST-02, AHIST-03, AHIST-04, AHIST-05
**Success Criteria** (what must be TRUE):
  1. User sees a paginated list of past conversations (newest first) with title, timestamp, and message count in the side drawer.
  2. User can free-text search past conversations by message content (case-insensitive), scoped to their user + org.
  3. User can open any past conversation, see full message history, and append new turns to the same `conversation_id`.
  4. User can soft-delete a conversation (audit-logged) and start a fresh one without losing access to other history.
  5. List, search input, and resume/delete actions are fully keyboard-navigable and screen-reader friendly (WCAG 2.2 AA).
**Plans**: 6 plans
- [x] 35-01-PLAN.md — Repository extension: migration 050 soft-delete + searchForUser + renameConversation + softDeleteConversation
- [x] 35-02-PLAN.md — Conversation title-generator module (D-02 AI + D-03 fallback)
- [x] 35-03-PLAN.md — HTTP routes (list/search/get/rename/delete) + AgentService post-first-turn title hook
- [x] 35-04-PLAN.md — Handlebars partials, style.css BEM block, i18n copy under agent.history.*
- [x] 35-05-PLAN.md — agent.js hydration: panel toggle, debounced search, IO pagination, three-dot menu, rename, delete confirm, keyboard flow
- [x] 35-06-PLAN.md — Playwright e2e round-trip + axe-core WCAG 2.2 AA a11y scan
**UI hint**: yes

#### Phase 36: Multi-Step Tool Use
**Goal**: The agent plans across multiple tool calls per user turn — in parallel where possible, with automatic recovery from tool errors and a transparent audit trail.
**Depends on**: Phase 35 (history persistence model is the source of truth for tool-call rows)
**Requirements**: ATOOL-01, ATOOL-02, ATOOL-03, ATOOL-04
**Success Criteria** (what must be TRUE):
  1. When the model returns multiple `tool_use` blocks in one turn, all tools dispatch in parallel and results stream back to the model together.
  2. A failed tool result is surfaced to the model with retry guidance and the agent recovers automatically up to a per-turn budget.
  3. The model can chain tool calls across iterations within a single user turn, capped by `max_iterations` (no runaway loops).
  4. Every tool dispatch records model rationale + outcome in the audit log, visible at `/admin/audit` filterable by tool.
**Plans**: 6 plans
- [x] 36-01-PLAN.md — Audit log schema: rationale column + outcomeDetail filter (migration 057)
- [x] 36-02-PLAN.md — ToolDispatcher.dispatchAll + tool_started/tool_completed SSE frames
- [x] 36-03-PLAN.md — AgentService: parallel dispatch, retry budget, rationale capture
- [x] 36-04-PLAN.md — Tool chip strip UI in agent drawer (HBS + agent.js + BEM CSS + i18n)
- [x] 36-05-PLAN.md — /admin/audit rationale display + outcomeDetail filter
- [x] 36-06-PLAN.md — Integration + Playwright e2e covering all 4 ATOOL success criteria

#### Phase 37: Streaming UX Polish
**Goal**: Users have full control over an in-flight agent response and can act on completed messages without leaving the drawer.
**Depends on**: Phase 35 (edit-and-resend branches require persisted history; superseded marker requires message rows)
**Requirements**: AUX-01, AUX-02, AUX-03, AUX-04, AUX-05
**Success Criteria** (what must be TRUE):
  1. Stop button cancels an in-flight SSE stream and the partial assistant response is persisted as the final state of that turn.
  2. User can re-run the last assistant turn against the same conversation state with a single click.
  3. User can edit-and-resend their own message — the conversation branches, the prior assistant reply is marked superseded, and a new turn streams.
  4. One-click copy on any assistant message places the full markdown source (not rendered HTML) on the clipboard.
  5. Share action produces a permalink to an audit-viewable conversation snapshot.
**Plans**: 5 plans
- [x] 37-01-PLAN.md — DB foundations: migrations 058 (message supersede) + 059 (share_links) + repo extensions
- [x] 37-02-PLAN.md — UI scaffolding: per-message action partials + BEM CSS + agent.actions.* i18n keys
- [x] 37-03-PLAN.md — Server routes: AbortSignal stop-persist + retry + edit-resend + share create + share view
- [x] 37-04-PLAN.md — Client wiring: agent.js handlers for stop/retry/edit/copy/share + UAT checkpoint
- [x] 37-05-PLAN.md — Playwright e2e + share-view a11y polish + 37-VERIFICATION.md
**UI hint**: yes

#### Phase 38: Multi-Org Context Switching
**Goal**: Global admins can drive the agent against any org's data from a single session, with safe boundaries for non-global users.
**Depends on**: Phase 36 (tool dispatcher must be re-bindable per turn), Phase 35 (history needs per-turn org attribution)
**Requirements**: AORG-01, AORG-02, AORG-03, AORG-04
**Success Criteria** (what must be TRUE):
  1. A user with `admin.system` sees an org switcher in the drawer header and can change the agent's active org without re-login.
  2. Switching org rebinds tool dispatch + context-hints injection to the new org for all subsequent turns; prior turns remain attributed to their original org in history and audit.
  3. The active org is visible in the drawer header at all times and persists per-user across sessions.
  4. Non-global users see no org switcher; any forged switch attempt is rejected server-side with HTTP 403.
**Plans**: 4 plans
- [x] 38-01-PLAN.md — Migration 061 (active_org_id column) + UserRepository.setActiveOrgId
- [x] 38-02-PLAN.md — Drawer org-switcher partial + BEM CSS + i18n keys
- [x] 38-03-PLAN.md — POST /agent/active-org route, resolveAgentOrgId extension, runTurn per-turn binding
- [x] 38-04-PLAN.md — agent.js wiring (switcher handler, history auto-switch, org chip) + live UAT
**UI hint**: yes

#### Phase 39: Verification Backfill & Deferred-Items Triage
**Goal**: Every v3.0.0 phase has formal verification on record and every deferred item is closed, promoted, or knowingly carried forward.
**Depends on**: Nothing (parallelizable with feature phases; runs anytime before milestone close)
**Requirements**: VER-01, VER-02, VER-03
**Success Criteria** (what must be TRUE):
  1. A formal VERIFICATION.md exists for Phase 30.1, 31.2, 32, 32.1, and 33 covering each success criterion, UAT outcome, and any observed gaps.
  2. A Nyquist validation coverage report exists for v3.0.0 listing each success criterion and whether it is automatically tested, manually tested, or untested.
  3. Every line in Phase 31.2 and Phase 32 `deferred-items.md` is resolved as won't-fix, promoted into a v3.1.0 plan, or explicitly deferred to v3.2.0 with rationale.
**Plans**: 3 plans
- [x] 39-01-PLAN.md — Backfill VERIFICATION.md for v3.0.0 phases 30.1, 31.2, 32, 32.1, 33
- [x] 39-02-PLAN.md — Walk all v3.0.0 + v3.1.0 deferred-items sources and produce TRIAGE.md
- [x] 39-03-PLAN.md — Build v3.0.0-NYQUIST.md coverage report with TRIAGE cross-references

### Phase 39.1: Deferred-Item Resolution: agent.js split + test-staleness fixes (6 items from TRIAGE.md) (INSERTED)

**Goal:** Resolve 6 deferred items promoted from Phase 39 TRIAGE.md with passing CI: 5 test-staleness fixes bundled + agent.js structural split into 4 modules.
**Requirements**: DI-31.2-01, DI-32-01, DI-32-02, DI-32-03, DI-37-01, DI-37-02, DI-38-01, DI-38-02b
**Depends on:** Phase 39
**Plans:** 2/2 plans complete

Plans:
- [x] 39.1-01-PLAN.md — Bundle 5 test-staleness fixes (auth-flow returnTo, MCP scope tiers, multi-step fetch loader, migration column-list, shareAssistant clipboard mock)
- [x] 39.1-02-PLAN.md — Split agent.js (2210 LOC) into agent-history.js + agent-tools.js + agent-actions.js + agent-org.js with __luqenAgent namespace and per-module JSDOM tests

#### Phase 40: Documentation Sweep
**Goal**: External and internal readers see documentation that accurately describes Luqen as it ships at v3.1.0, AND installer scripts deploy v3.1.0 cleanly without manual fix-up.
**Depends on**: Phase 34, 35, 36, 37, 38 (docs reflect actual implemented behaviour); Phase 39 (RBAC matrix sourced from verified state)
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, DOC-07
**Success Criteria** (what must be TRUE):
  1. Top-level README accurately describes v3.0.0 + v3.1.0 surface (MCP, agent companion, OAuth 2.1, agent history, multi-step tools, streaming UX, multi-org switching) with no stale instructions.
  2. Swagger/OpenAPI specs are current for compliance, branding, llm, dashboard, and the MCP endpoints — every shipped route appears.
  3. Installer **scripts** (not just docs) include every new env var, migration baseline (up to 061), systemd unit, admin page, and RBAC permission introduced since v2.12.0. A fresh install of v3.1.0 from these scripts succeeds end-to-end without manual edits.
  4. Installer docs list every new env var, admin page, and RBAC permission introduced since v2.12.0.
  5. A standalone MCP integration guide walks Claude Desktop, IDE, and custom client setup including the OAuth 2.1 + PKCE + DCR flow.
  6. An agent companion user guide covers chat usage, tools, history, org switching, multi-step tool transparency, and speech input from an end-user perspective.
  7. Prompt-template authoring guide documents locked sections, fence markers, the validator, and the override workflow.
  8. RBAC matrix lists every permission against every page, route, and MCP tool — end-to-end and machine-checkable against code.
  9. Any v3.1.0 surface (agent history, multi-step tool use + parallel dispatch + retry budget, streaming UX polish + share permalinks, multi-org context switching) that lacks a dedicated doc gets a NEW doc page added under `docs/`.
**Plans**: 7 (40-01..07 complete; DOC-02 partial → Phase 41; DOC-03 SC #3 deferred to runtime LXC)

#### Phase 41: OpenAPI Schema Backfill
**Goal**: `/docs` and the committed OpenAPI snapshots reflect every shipped route with its real request/response shape — not stub objects — so the `route-vs-spec` coverage tests pass and `openapi-drift` CI gate stays green.
**Depends on**: Phase 40 (snapshot infra and CI gates already wired up)
**Requirements**: OAPI-01, OAPI-02, OAPI-03, OAPI-04, OAPI-05
**Success Criteria** (what must be TRUE):
  1. Every Fastify route in compliance/branding/llm/dashboard declares a `schema` (body where applicable + response) using TypeBox or JSON Schema.
  2. Every MCP tool in `packages/dashboard/src/mcp/tools/*` exposes its input/output schema in the generated `mcp.json` snapshot.
  3. `route-vs-spec` coverage tests in all 5 service test suites pass.
  4. `npm run docs:openapi` regenerates byte-identical snapshots; `openapi-drift` CI workflow passes.
  5. No regression in production behaviour — existing request/response shapes preserved.
**Plans**: 5 plans
- [x] 41-01-PLAN.md — Compliance service schemas (16 route files, OAPI-01)
- [x] 41-02-PLAN.md — Branding service schemas (~22 inline routes, OAPI-02)
- [x] 41-03-PLAN.md — LLM service schemas (11 route files incl. capability-exec, OAPI-03)
- [x] 41-04-PLAN.md — Dashboard non-MCP schemas + Zod-to-TypeBox migration (50 files, OAPI-04)
- [x] 41-05-PLAN.md — Dashboard MCP tool schemas via zod-to-json-schema bridge (Wave 2, OAPI-05)

### Phase 41.1: Dashboard non-MCP per-route TypeBox schema backfill — close OAPI-04 PARTIAL by adding schema: blocks across the remaining ~245 dashboard routes flagged in 41-VERIFICATION.md (INSERTED)

**Goal:** Mechanically backfill TypeBox `schema:` blocks across all non-MCP dashboard routes (oauth/, admin/, api/, top-level) so dashboard.json reflects real request/response shapes — replacing the ~301 ops with 2 requestBody / 303 "Default Response" baseline from Phase 41 verification — and add a fidelity assertion (≥95% typed 2xx, all POST/PUT/PATCH have requestBody) to lock the gain in CI.
**Requirements**: OAPI-04
**Depends on:** Phase 41
**Plans:** 5/5 plans complete
**Status:** VERIFIED PASSED — 7/7 must-haves (verified 2026-04-26)

Plans:
- [x] 41.1-01-PLAN.md — oauth/* (7 files): well-known/protected-resource/jwks + authorize/token/register
- [x] 41.1-02-PLAN.md — admin/* part A (7 large/complex files): branding-guidelines, llm, organizations, plugins, service-connections, dashboard-users, roles
- [x] 41.1-03-PLAN.md — admin/* part B (18 remaining files): api-keys/clients/audit/users/system + jurisdictions/regulations/sources/proposals/system-brand-guidelines/teams + git-hosts/email-reports/webhooks/oauth-keys/monitor/change-history (+ helpers.ts confirmation)
- [x] 41.1-04-PLAN.md — api/* (6 files excl mcp.ts) + 16 top-level routes (auth/scan/reports/repos/brand-overview/fix-pr/trends/assignments/home/manual-tests/schedules/compare/git-credentials/wcag-enrichment/orgs/tools)
- [x] 41.1-05-PLAN.md — Wave 2: regenerate dashboard.json snapshot + add schema fidelity assertion (≥95% typed 2xx, every POST/PUT/PATCH requestBody, no bare Default Response without html-page tag)

#### Phase 42: Installer Wizard Redesign
**Goal**: All 3 installers (`install.sh`, `install.command`, `install.ps1`) match the actual v3.1.0 codebase: 4 deployment profiles (Scanner CLI / API services / Self-hosted dashboard / Docker Compose), per-component install via `INSTALL_COMPONENTS`, and first-class registration of the `@luqen/monitor` agent (currently never installed).
**Depends on**: Phase 40 (uninstall flow + tested infra), Phase 41 (no installer-side dependency, but ordered after for milestone closure)
**Requirements**: TBD (likely INST-01..05)
**Success Criteria** (what must be TRUE):
  1. Interactive wizard exposes 4 deployment profiles aligned to real codebase topologies; each maps to a documented set of installed packages and registered services.
  2. Operator can pick any subset of `compliance`, `branding`, `llm` under the API-services profile; dashboard profile lets them disable any backing service with a graceful-degradation note.
  3. `@luqen/monitor` is registered as `luqen-monitor.service` (Linux), `io.luqen.monitor.plist` (macOS), and `LuqenMonitor` (Windows NSSM / Task Scheduler) when the user opts in.
  4. Non-interactive flags add `--profile cli|api|dashboard|docker`, `--api-services <csv>`, `--with-monitor`. Default profile remains `dashboard` so existing `--non-interactive` invocations are unchanged.
  5. `install.ps1` reaches feature parity with `install.sh` (currently only offers bare-metal vs docker, no component choice).
  6. Each profile validated end-to-end against a fresh container in CI or operator dry-run.
**Plans**: TBD (estimate 3 — sh redesign, command/ps1 mirror, monitor agent registration + docs)

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 34. Tokenizer Precision | 3/3 | Complete    | 2026-04-24 |
| 35. Agent Conversation History | 6/6 | Complete    | 2026-04-24 |
| 36. Multi-Step Tool Use | 6/6 | Complete    | 2026-04-25 |
| 37. Streaming UX Polish | 5/5 | Complete    | 2026-04-25 |
| 38. Multi-Org Context Switching | 4/4 | Complete    | 2026-04-25 |
| 39. Verification Backfill & Deferred-Items Triage | 3/3 | Complete    | 2026-04-25 |
| 40. Documentation Sweep | 7/7 | Complete    | 2026-04-25 |
| 41. OpenAPI Schema Backfill | 0/5 | Planned     | - |
| 42. Installer Wizard Redesign | 0/0 | Not started | - |

### Coverage

✓ All 33 v3.1.0 requirements mapped to exactly one phase. No orphans.
