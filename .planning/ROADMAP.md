# Roadmap: Luqen

## Milestones

- ✅ **v2.7.0 LLM Module** — [archived](milestones/v2.7.0-ROADMAP.md)
- ✅ **v2.8.0 Admin UX & Compliance Precision** — Phases 06-08 (shipped 2026-04-06) — [archived](milestones/v2.8.0-ROADMAP.md)
- ✅ **v2.9.0 Branding Completeness & Org Isolation** — Phases 09-12 (shipped 2026-04-06) — [archived](milestones/v2.9.0-ROADMAP.md)
- ✅ **v2.10.0 Prompt Safety & API Key Polish** — Phases 13-14 (shipped 2026-04-10) — [archived](milestones/v2.10.0-ROADMAP.md)
- ✅ **v2.11.0 Brand Intelligence** — Phases 15-21 (shipped 2026-04-12) — [archived](milestones/v2.11.0-ROADMAP.md)
- ✅ **v2.12.0 Brand Intelligence Polish** — Phases 22-27 (shipped 2026-04-14) — [archived](milestones/v2.12.0-ROADMAP.md)

## Planned: v3.0.0 MCP Servers & Agent Companion

### Phases

- [x] **Phase 28: MCP Foundation** - Streamable HTTP MCP endpoints with OAuth2 JWT validation, RBAC tool filtering, and org-aware tool scoping across all services (completed 2026-04-17)
- [x] **Phase 29: Service MCP Tools** - Compliance, branding, and LLM tools plus MCP Resources and Prompts primitives (completed 2026-04-17)
- [x] **Phase 30: Dashboard MCP + External Clients** - Dashboard admin operations exposed as MCP tools; external client (Claude Desktop, IDE) connectivity verified. SC#4 accepted 2026-04-18 after Phase 30.1 landed the scope-filter fix.
- [x] **Phase 30.1: MCP OAuth scope-filter gate (INSERTED)** - Fixed scope-filter bypass for OAuth client-credentials tokens. `getUserPermissions` now returns an empty Set for unknown subs (no user-role fallback), and `filterToolsByScope`/`filterResourcesByScope` rules were rewritten per-permission-suffix (read=.view only; write adds .create/.update/.manage/.delete/admin.users/admin.org; admin.system is admin-only). Verified end-to-end against Claude Desktop (completed 2026-04-18).
- [ ] **Phase 31: Conversation Persistence** - SQLite schema for conversation history with rolling-window design and per-invocation audit log
- [ ] **Phase 32: Agent Service + Chat UI** - AgentService orchestration, text and speech chat side panel, and confirmation dialog for destructive tools
- [ ] **Phase 33: Agent Intelligence + Audit Viewer** - Context-aware org suggestions, token budget with compaction, and admin audit log viewer

---

## Phase Details

### Phase 28: MCP Foundation
**Goal**: Every Luqen service exposes a secured MCP endpoint that enforces caller identity and org isolation before any tool is reachable
**Depends on**: Nothing (establishes auth and transport patterns for all subsequent phases)
**Requirements**: MCPI-01, MCPI-02, MCPI-03, MCPI-04
**Success Criteria** (what must be TRUE):
  1. A valid OAuth2 JWT holder can establish an MCP session at `POST /api/v1/mcp` on compliance, branding, and LLM services over Streamable HTTP transport
  2. A request with a missing, expired, or tampered JWT receives a 401 before any tool code runs
  3. The tool manifest returned to a caller contains only tools the caller's RBAC permissions allow — an org-member caller never sees admin-only tools
  4. All tool calls execute pre-scoped to the caller's `orgId` from JWT claims — a tool cannot return data from another org regardless of arguments passed
**Plans**: 3 plans
Plans:
- [x] 28-01-PLAN.md — Shared createMcpHttpPlugin() factory + RBAC tool filter + ToolContext types in @luqen/core
- [x] 28-02-PLAN.md — Wire MCP endpoint into compliance (upgrade 11 tool handlers) + branding/LLM stubs
- [x] 28-03-PLAN.md — Dashboard MCP endpoint with Bearer-only auth (CSRF defense) + resolveEffectivePermissions RBAC

### Phase 29: Service MCP Tools
**Goal**: Users can list and match brand guidelines via branding MCP tools, and can request fix suggestions, report analysis, brand discovery, and regulation-requirement extraction via LLM MCP tools
**Depends on**: Phase 28
**Requirements**: MCPT-02 (partial — guidelines + match + discover), MCPT-03
**Success Criteria** (what must be TRUE):
  1. An MCP client can list brand guidelines, get a single guideline, list site assignments, and match pa11y issues against a brand guideline via branding MCP tools (4 tools, all branding.view, all org-scoped with cross-org guards)
  2. An MCP client can generate WCAG fix suggestions, generate executive summaries for scan reports, auto-detect brand signals from a URL, and extract requirements from regulation text via LLM MCP tools (4 tools, all llm.view, all global)
  3. No tool accepts `orgId` in its inputSchema — every handler sources orgId from the ToolContext populated by the OAuth2 JWT at request time (D-13 invariant, enforced by runtime iteration test per service)
**Plans**: 3 plans
Plans:
- [x] 29-01-PLAN.md — Branding MCP tools (4 tools: list_guidelines, get_guideline, list_sites, match)
- [x] 29-02-PLAN.md — LLM MCP tools (4 tools: generate_fix, analyse_report, discover_branding, extract_requirements)
- [x] 29-03-PLAN.md — REQUIREMENTS.md + ROADMAP.md rescope (move MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 to Phase 30)
**UI hint**: no
**Rescope note**: The original Phase 29 wording included scan/report/issue tools (MCPT-01), brand score retrieval (MCPT-02 second half), MCP Resources (MCPI-05), and MCP Prompts (MCPI-06). These moved to Phase 30 during context gathering (see `.planning/phases/29-service-mcp-tools/29-CONTEXT.md` D-14) because their natural data lives in `packages/dashboard`, not in compliance/branding/llm.

### Phase 30: Dashboard MCP + External Clients
**Goal**: Dashboard admin operations AND dashboard-owned read data (scans, reports, brand scores) are accessible via MCP as tools, resources, and prompts; external clients such as Claude Desktop can connect with valid credentials
**Depends on**: Phase 28, Phase 29
**Requirements**: MCPT-01, MCPT-02 (brand score retrieval half), MCPT-04, MCPT-05, MCPI-05, MCPI-06
**Success Criteria** (what must be TRUE):
  1. An MCP client can trigger a site scan, list reports, and query issues via dashboard MCP tools (absorbed from Phase 29 — MCPT-01)
  2. An MCP client can retrieve brand scores via dashboard MCP tools (absorbed from Phase 29 — MCPT-02 brand-score half)
  3. An authenticated MCP client can manage users, orgs, and service connections via dashboard MCP tools, with RBAC-gated tool manifest (org-member callers see only their permitted subset) — MCPT-04
  4. A developer can connect Claude Desktop or an IDE MCP extension to a Luqen service endpoint using standard OAuth2 credentials and successfully call tools — verified via MCP Inspector or Claude Desktop tool list — MCPT-05
  5. An MCP client can read scan reports and brand scores as MCP Resources (read-only URIs like `scan://report/{id}` and `brand://score/{siteUrl}`) — MCPI-05 (absorbed from Phase 29)
  6. An MCP client can invoke predefined MCP Prompts (`/scan`, `/report`, `/fix`) that return **chat-message templates** (system+user messages with placeholders) that the client feeds to its own LLM, which then chooses which cross-service tools to invoke — MCPI-06 (absorbed from Phase 29; shape locked in 29-CONTEXT.md D-12 — NOT tool-call pre-fills)
**Plans**: TBD

### Phase 30.1: MCP OAuth scope-filter gate (INSERTED — urgent)
**Goal**: Close the scope-filter bypass discovered during Phase 30 SC#4 walkthrough on 2026-04-18: an OAuth client-credentials token signed with `scope=read` currently surfaces destructive tools (`dashboard_scan_site`) because the permission path overrides the scope path for unknown subs.
**Depends on**: Phase 30 (the walkthrough that surfaced the gap + all Phase 30 code to patch)
**Requirements**: MCPT-05 (re-opens SC#4 acceptance for Phase 30)
**Success Criteria** (what must be TRUE):
  1. A `scope=read` OAuth client (no matching `dashboard_users` row) sees only read-tier tools — `dashboard_scan_site` is filtered out of `tools/list`.
  2. A direct `tools/call` for `dashboard_scan_site` with a read-scope bearer returns HTTP 403 (filter-denied), not 200.
  3. A `scope=write` OAuth client surfaces `dashboard_scan_site` and invoking it triggers Claude Desktop's `destructiveHint: true` confirmation UI.
  4. Existing cookie-session auth flows continue to receive the correct permission set (middleware.test.ts Tests 4, 5, 6 still green).
  5. Checks 5a and 5b of `.planning/phases/30-dashboard-mcp-external-clients/30-VERIFICATION.md` re-run successfully against the patched code and are marked ✓.
**Design decision (locked in `30.1-CONTEXT.md`):** Option (b) — empty-set on unknown sub in `role-repository.ts:176-178` (+ rewrite `filterToolsByScope` scope-tier rules in `tool-filter.ts`, co-fix `filterResourcesByScope`).
**Plans**: 1 plan
Plans:
- [ ] 30.1-01-PLAN.md — Drop user-role fallback for unknown sub + rewrite scope-filter rules + regression tests + UAT re-run

### Phase 31: Conversation Persistence
**Goal**: Every conversation turn is durably stored with a rolling-window design that prevents unbounded context growth, and every tool invocation is permanently audited
**Depends on**: Phase 28 (audit entries reference tool calls from MCP layer)
**Requirements**: APER-01, APER-03
**Success Criteria** (what must be TRUE):
  1. A user who closes and reopens the dashboard finds their previous conversation thread intact with full message history
  2. The system retains at most the last 20 turns of a conversation in the LLM context window — turns beyond the window are stored in DB but excluded from active context automatically
  3. Every tool invocation (tool name, args, outcome, latency, user, org) is written to the audit log before the response is returned to the caller
  4. A `pending_confirmation` message status survives a page refresh — a pending destructive tool call is recoverable from DB, not from JavaScript memory
**Plans**: TBD

### Phase 32: Agent Service + Chat UI
**Goal**: Users can converse with the dashboard agent companion via text or speech, and state-changing tool calls require explicit confirmation before execution
**Depends on**: Phase 29 (tools must be callable), Phase 31 (ConversationRepository must exist)
**Requirements**: AGENT-01, AGENT-02, AGENT-03, APER-02, MCPAUTH-01, MCPAUTH-02, MCPAUTH-03
**Cross-cutting requirement (added 2026-04-18 during Phase 30 walkthrough)**: MCP external-client auth must upgrade from bootstrap `client_credentials` + static Bearer to MCP Authorization spec (2025-06-18) compliance before AgentService goes live — OAuth 2.1 Authorization Code + PKCE, refresh tokens, Dynamic Client Registration (RFC 7591), and `.well-known/oauth-protected-resource` + `.well-known/oauth-authorization-server` metadata discovery. Tokens must be tied to user identity, not an admin-registered OAuth client, so per-user RBAC (`resolveEffectivePermissions`) applies naturally. See Task #2 for backlog capture. Candidate new requirement IDs: **MCPAUTH-01** (metadata discovery), **MCPAUTH-02** (PKCE + refresh), **MCPAUTH-03** (DCR).
**Success Criteria** (what must be TRUE):
  1. A user can open the agent side panel in the dashboard, type a message, and receive a streamed response without a full page reload
  2. The agent routes all LLM calls through the existing capability engine — provider fallback and per-org overrides apply exactly as they do for scan-based AI features
  3. A user on Chrome or Edge can speak a message via the microphone and have it transcribed and submitted; a user on Firefox sees a visible text input fallback with no JavaScript errors
  4. When the agent proposes a state-changing tool call (user deletion, org setting change), a native confirmation dialog appears before execution; declining returns a cancellation message without executing the tool
**Plans**: TBD
**UI hint**: yes

### Phase 33: Agent Intelligence + Audit Viewer
**Goal**: The agent gives contextually relevant answers using the user's live org data, proactively manages token cost on long conversations, and admins can inspect all tool invocations from the dashboard
**Depends on**: Phase 32 (AgentService must be operational), Phase 31 (audit log must be populated)
**Requirements**: AGENT-04, AGENT-05, APER-04
**Success Criteria** (what must be TRUE):
  1. The agent references the user's most recent scans, active brand guidelines, and applicable regulations in its responses without requiring the user to paste URLs or IDs
  2. After a long conversation, the agent's response quality and org-context accuracy remain consistent — the system applies sliding-window plus summary compaction before the context exceeds 85% of the model's token limit
  3. An admin can navigate to the audit log section of the dashboard, filter by date range, user, or tool name, and browse all recorded tool invocations with outcome and latency
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 28. MCP Foundation | 3/3 | Complete   | 2026-04-17 |
| 29. Service MCP Tools | 3/3 | Complete    | 2026-04-17 |
| 30. Dashboard MCP + External Clients | 6/6 | Complete   | 2026-04-18 |
| 31. Conversation Persistence | 0/? | Not started | - |
| 32. Agent Service + Chat UI | 0/? | Not started | - |
| 33. Agent Intelligence + Audit Viewer | 0/? | Not started | - |
