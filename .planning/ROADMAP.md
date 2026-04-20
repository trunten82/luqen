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
- [x] **Phase 31: Conversation Persistence** - Migrations 047 (agent_conversations + agent_messages with in_window flag) and 048 (agent_audit_log), ConversationRepository (rolling 20-turn window maintained at write time, pending_confirmation + streaming always in_window), AgentAuditRepository (append-only, distinct from pre-existing storage.audit). Verified 2026-04-18 — 49/49 repo tests green.
- [x] **Phase 31.1: MCP Authorization Spec Upgrade (INSERTED)** - OAuth 2.1 AS on the dashboard (Authorization Code + PKCE + refresh + DCR + `.well-known` metadata + JWKS rotation). Services swapped to JWKS-backed RS256 verifiers with RFC 8707 audience enforcement. Admin `/admin/clients` DCR surface + `/admin/oauth-keys` rotate UI. E2E smoke-verified against Claude Desktop on lxc-luqen 2026-04-19 (10/10 steps pass). 3/3 requirements met (MCPAUTH-01/02/03).
- [x] **Phase 31.2: MCP Access Control Refinement (INSERTED)** - Introduce `mcp.use` per-org RBAC permission gate, bind tool visibility to user's real RBAC (not broad OAuth scope bundles), org-scoped DCR client revoke, service-side WWW-Authenticate parity. Closes G1/G9/G10 from Phase 31.1 smoke. — 2026-04-19
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
**Plans**: 2 plans
Plans:
- [ ] 31-01-PLAN.md — Migrations 047 + 048 + ConversationRepository (rolling window + pending_confirmation durability)
- [ ] 31-02-PLAN.md — AgentAuditRepository (append-only, org-scoped, immutability-surface contract)

### Phase 31.2: MCP Access Control Refinement (INSERTED)
**Goal:** Refine MCP access control so (a) any dashboard user connecting via MCP requires an explicit `mcp.use` RBAC permission per-org, (b) tool visibility follows the user's real org-scoped RBAC rather than broad OAuth scope bundles, (c) org admins can revoke DCR'd OAuth clients registered within their own org without needing system-admin. Surface three smoke-found gaps from Phase 31.1 as a cohesive refinement rather than scattered patches.
**Depends on:** Phase 31.1 (OAuth AS + DCR + verifier swap live)
**Requirements:** MCPAUTH-04, MCPAUTH-05
**Rationale for insertion:** Phase 31.1 E2E smoke (2026-04-19) surfaced real access-control gaps: (G1) `/admin/clients` revoke gated only on `admin.system`, blocking org admins from managing their own org's DCR clients; (G9) service-side middlewares (compliance/branding/llm) still emit 401 without `WWW-Authenticate` header — load-bearing for Phase 32's per-service agent token path; (G10) no `mcp.use` permission gate — today any authenticated dashboard user can open an MCP connection. User explicitly requested a specific org-scoped MCP permission enabling developers to wire MCP to perform only actions they are individually allowed to perform in the dashboard.
**Success Criteria** (what must be TRUE):
  1. A dashboard user lacking `mcp.use` in their active org cannot complete `/oauth/authorize` — sees a clear "you don't have MCP access in this org" screen rather than a silent flow completion
  2. `mcp.use` is grantable per-user-per-org via the dashboard admin UI; default-ON for admin roles, default-OFF for new user roles; migration back-fills existing admin users only
  3. An org admin (admin.org, without admin.system) can revoke DCR'd OAuth clients that belong to their org via `/admin/clients` — cross-org revocation is forbidden and tested
  4. Compliance, branding, and LLM service MCP 401 responses include `WWW-Authenticate: Bearer resource_metadata="..."` header pointing at each service's `.well-known/oauth-protected-resource` — external MCP clients can discover the AS through any service, not only the dashboard
  5. An external MCP client's token — whether issued directly to Claude Desktop or minted per-request by Phase 32's agent — scopes tool visibility via the user's real RBAC (not the broad OAuth scope bundle), so a developer token gets exactly the tools the developer could invoke in the dashboard UI
  6. All Phase 31.1 E2E smoke steps still pass after Phase 31.2 ships — this phase REFINES access control without regressing any of the 10 smoke-verified behaviors
**Plans:** 5 plans — complete 2026-04-19
Plans:
- [x] 31.2-01-PLAN.md — RBAC foundation: add mcp.use to ALL_PERMISSIONS + migration 054 back-fill + findByOrg repo method
- [x] 31.2-02-PLAN.md — OAuth AS updates: mcp.use gate on /oauth/authorize + switch-org CTA + client_credentials removal + scopes narrow + first-consent registrant backfill
- [x] 31.2-03-PLAN.md — Tool-filter RBAC layer: filterToolsByRbac + http-plugin composition + per-tool runtime guard + metadata drift test
- [x] 31.2-04-PLAN.md — Admin UI: org-scoped /admin/clients visibility + Revoked/Org columns + cross-org revoke 403+audit defense (G1 closure)
- [x] 31.2-05-PLAN.md — Service-side WWW-Authenticate parity across compliance/branding/llm middlewares (G9 closure)
**UI hint**: yes (admin knob for mcp.use + org-scoped /admin/clients filters)

### Phase 31.1: MCP Authorization Spec Upgrade (INSERTED — urgent)
**Goal**: External MCP clients (Claude Desktop, IDEs, future agent-to-agent peers) authenticate to Luqen services using MCP Authorization spec (2025-06-18) compliance — OAuth 2.1 Authorization Code + PKCE with refresh tokens, Dynamic Client Registration (RFC 7591), and `.well-known/oauth-protected-resource` + `.well-known/oauth-authorization-server` metadata discovery. Tokens must carry user identity so `resolveEffectivePermissions` (per-user RBAC) applies naturally instead of service-client fallback.
**Depends on**: Phase 30 (external-client MCP endpoints live), Phase 30.1 (scope-filter rules locked)
**Requirements**: MCPAUTH-01, MCPAUTH-02, MCPAUTH-03
**Rationale for insertion**: Discovered during Phase 30 SC#4 walkthrough (2026-04-18) that bootstrap `client_credentials` + static Bearer does not meet the MCP Authorization spec for external clients and ties tokens to admin-registered OAuth clients rather than user identity. Phase 32 (Agent Service + Chat UI) depends on per-user identity tokens reaching the MCP layer — routed here so Phase 32 stays focused on agent runtime + UI. Phase 32's internal dashboard-to-MCP path (cookie-session + server-minted JWT) is unaffected by this phase.
**Success Criteria** (what must be TRUE):
  1. Each Luqen service (compliance, branding, LLM, dashboard) publishes `.well-known/oauth-protected-resource` pointing to its authorization server, and the dashboard publishes `.well-known/oauth-authorization-server` with Authorization Code + PKCE + refresh metadata — MCPAUTH-01
  2. An external MCP client (Claude Desktop, MCP Inspector) can complete the OAuth 2.1 Authorization Code + PKCE flow against the dashboard, receive an access token tied to a real `dashboard_users.id`, and have that token's per-user permissions flow through `resolveEffectivePermissions` when calling any Luqen MCP tool — MCPAUTH-02
  3. A refresh token issued during the initial flow can be exchanged for a new short-lived access token without user re-consent, and refresh tokens respect rotation + revocation — MCPAUTH-02
  4. An MCP client can register itself via Dynamic Client Registration (RFC 7591) at the dashboard's DCR endpoint (decision on open vs admin-gated captured during `/gsd-discuss-phase 31.1`), receive a `client_id`, and complete the Authorization Code + PKCE flow with that new registration — MCPAUTH-03
  5. Existing `client_credentials` bootstrap path continues to work for service-to-service calls (dashboard → compliance/branding/LLM), with scope-filter rules from Phase 30.1 still applied — no regression to internal service auth
**Plans**: 4 plans
Plans:
- [x] 31.1-01-PLAN.md — Migrations 049-053 + OAuth repositories (clients_v2, auth codes, refresh tokens, consents, signing keys) + StorageAdapter wiring
- [x] 31.1-02-PLAN.md — Dashboard OAuth AS endpoints (/authorize + consent UI, /token 3 grants, /register DCR, /jwks, /.well-known/oauth-authorization-server) + signer bootstrap
- [x] 31.1-03-PLAN.md — JWKS-backed RS256 verifier swap across 4 services (dashboard/compliance/branding/llm) + .well-known/oauth-protected-resource per service + audience enforcement
- [ ] 31.1-04-PLAN.md — /admin/oauth-keys rotation UI + /admin/clients DCR extension + scheduler housekeeping + refresh-reuse audit + E2E Claude Desktop smoke checklist
**UI hint**: yes (consent screen + DCR admin-gate UI if chosen)

### Phase 32: Agent Service + Chat UI
**Goal**: Users can converse with the dashboard agent companion via text or speech, destructive tool calls require native <dialog> confirmation before execution, token-level SSE streaming, per-user RBAC via resolveEffectivePermissions enforced every turn, all LLM calls route through @luqen/llm capability engine
**Depends on**: Phase 29 (tools must be callable), Phase 31 (ConversationRepository must exist), Phase 31.1 (external-client MCP auth spec-compliant — external clients cannot connect to the agent pipeline until 31.1 lands)
**Requirements**: AGENT-01, AGENT-02, AGENT-03, APER-02
**Cross-phase note** (updated 2026-04-19 via `/gsd-discuss-phase 32`): MCP Authorization spec upgrade (MCPAUTH-01/02/03) relocated from this phase to the inserted Phase 31.1. Phase 32's internal dashboard agent uses cookie-session + server-minted per-user RS256 JWT for MCP dispatch, which is independent of 31.1's external-client OAuth flow. Phase 32's planning decisions are captured in `.planning/phases/32-agent-service-chat-ui/32-CONTEXT.md`.
**Success Criteria** (what must be TRUE):
  1. A user can open the agent side panel in the dashboard, type a message, and receive a streamed response without a full page reload
  2. The agent routes all LLM calls through the existing capability engine — provider fallback and per-org overrides apply exactly as they do for scan-based AI features
  3. A user on Chrome or Edge can speak a message via the microphone and have it transcribed and submitted; a user on Firefox sees a visible text input fallback with no JavaScript errors
  4. When the agent proposes a state-changing tool call (user deletion, org setting change), a native confirmation dialog appears before execution; declining returns a cancellation message without executing the tool
**Plans**: 8 plans
Plans:
- [x] 32-01-PLAN.md — LLM streaming adapters (ollama/openai extended with completeStream, new Anthropic adapter) + registry + package.json pin
- [ ] 32-02-PLAN.md — agent-conversation capability + agent-system prompt template (3 locked fences) + PUT orgId guard
- [ ] 32-03-PLAN.md — Migration 050 adds agent_display_name column on organizations + OrganizationsRepository roundtrip
- [ ] 32-04-PLAN.md — AgentService + ToolDispatcher + jwt-minter + SSE frames + /agent/* routes + server.ts wiring (destructive pause, iteration cap, RBAC rebuild, audit writes, ToolMetadata.confirmationTemplate)
- [ ] 32-05-PLAN.md — Admin-UI extensions A/B/C: /admin/llm capabilities tab agent-conversation row + prompts tab agent-system locked fences + hidden per-org override + Anthropic models tab rendering + i18n
- [ ] 32-06-PLAN.md — Chat drawer + floating entry button + agent.js EventSource client + localStorage persistence + style.css ≤200 LOC banner + i18n + E2E axe-core
- [ ] 32-07-PLAN.md — Native <dialog> confirmation flow (DB recovery on reload = SC#4) + Approve/Cancel idempotency + Web Speech API feature-detect + E2E + i18n
- [ ] 32-08-PLAN.md — Admin-UI extension D: /admin/organizations/:id/settings form + zod validation (no HTML/URLs, ≤40 chars) + organization-settings.hbs + i18n + integration tests
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
| 31. Conversation Persistence | 2/2 | Complete | 2026-04-18 |
| 31.1. MCP Authorization Spec Upgrade (INSERTED) | 4/4 | Complete | 2026-04-19 |
| 31.2. MCP Access Control Refinement (INSERTED) | 5/5 | Complete | 2026-04-19 |
| 32. Agent Service + Chat UI | 1/8 | In Progress|  |
| 33. Agent Intelligence + Audit Viewer | 0/? | Not started | - |
