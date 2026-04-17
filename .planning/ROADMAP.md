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

- [ ] **Phase 28: MCP Foundation** - Streamable HTTP MCP endpoints with OAuth2 JWT validation, RBAC tool filtering, and org-aware tool scoping across all services
- [ ] **Phase 29: Service MCP Tools** - Compliance, branding, and LLM tools plus MCP Resources and Prompts primitives
- [ ] **Phase 30: Dashboard MCP + External Clients** - Dashboard admin operations exposed as MCP tools; external client (Claude Desktop, IDE) connectivity verified
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
- [ ] 28-02-PLAN.md — Wire MCP endpoint into compliance (upgrade 11 tool handlers) + branding/LLM stubs
- [ ] 28-03-PLAN.md — Dashboard MCP endpoint with Bearer-only auth (CSRF defense) + resolveEffectivePermissions RBAC

### Phase 29: Service MCP Tools
**Goal**: Users can perform all key compliance, branding, and LLM operations through MCP tools, and MCP clients have read-only resource context and workflow shortcut prompts
**Depends on**: Phase 28
**Requirements**: MCPT-01, MCPT-02, MCPT-03, MCPI-05, MCPI-06
**Success Criteria** (what must be TRUE):
  1. An MCP client can trigger a site scan, list reports, and query issues via compliance MCP tools and receive structured results
  2. An MCP client can list brand guidelines, retrieve brand scores, and invoke discover-branding via branding MCP tools
  3. An MCP client can request fix suggestions and report analysis via LLM MCP tools
  4. An MCP client can read scan reports and brand scores as MCP Resources (read-only, no side effects)
  5. An MCP client can invoke predefined prompt shortcuts (`/scan`, `/report`, `/fix`) that pre-fill tool arguments with workflow-appropriate defaults
**Plans**: TBD
**UI hint**: no

### Phase 30: Dashboard MCP + External Clients
**Goal**: Dashboard admin operations are accessible via MCP and external clients such as Claude Desktop can connect and operate with valid credentials
**Depends on**: Phase 28
**Requirements**: MCPT-04, MCPT-05
**Success Criteria** (what must be TRUE):
  1. An authenticated MCP client can manage users, orgs, and service connections via dashboard MCP tools, with RBAC-gated tool manifest (org-member callers see only their permitted subset)
  2. A developer can connect Claude Desktop or an IDE MCP extension to a Luqen service endpoint using standard OAuth2 credentials and successfully call tools — verified via MCP Inspector or Claude Desktop tool list
**Plans**: TBD

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
**Requirements**: AGENT-01, AGENT-02, AGENT-03, APER-02
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
| 28. MCP Foundation | 1/3 | In Progress|  |
| 29. Service MCP Tools | 0/? | Not started | - |
| 30. Dashboard MCP + External Clients | 0/? | Not started | - |
| 31. Conversation Persistence | 0/? | Not started | - |
| 32. Agent Service + Chat UI | 0/? | Not started | - |
| 33. Agent Intelligence + Audit Viewer | 0/? | Not started | - |
