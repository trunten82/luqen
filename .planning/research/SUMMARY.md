# Project Research Summary

**Project:** Luqen v3.0.0 — MCP Servers + Dashboard AI Agent Companion
**Domain:** MCP protocol layer + multimodal AI agent for WCAG accessibility compliance SaaS
**Researched:** 2026-04-16
**Confidence:** HIGH

## Executive Summary

Luqen v3.0.0 transforms an already-capable accessibility platform into a conversational AI assistant by adding an MCP (Model Context Protocol) server layer across all services and a dashboard agent companion. This is not a greenfield AI project — three packages (`@luqen/core`, `@luqen/compliance`, `@luqen/monitor`) already have working MCP infrastructure using stdio transport. The task is: add Streamable HTTP transport to existing MCP servers (compliance, core, monitor), create new MCP servers for branding and LLM services, and build the dashboard agent companion that orchestrates tool calls across all services. The recommended pattern is to embed MCP as a Fastify plugin in each service (`fastify-mcp` by haroldadmin), expose `POST /mcp` alongside existing REST routes, and build the agent loop in the dashboard using `@modelcontextprotocol/sdk` Client mode calling those HTTP endpoints.

The most important architectural constraint is that the agent companion must route all LLM calls through the existing `@luqen/llm` capability engine, not directly to AI providers, and all tool calls must go through each service's MCP endpoint over HTTP — never by importing service modules directly. This enforces the audit trail, RBAC gates, and confirmation UI consistently across both the in-dashboard agent and any external MCP clients (Claude Desktop, IDEs). The two net-new packages required are `@modelcontextprotocol/sdk@^1.29.0` and `fastify-mcp@^2.1.0`; everything else (Fastify, better-sqlite3, jose, zod, vitest) is already in the stack.

The highest-risk areas are security (RBAC enforcement at the tool layer not just the HTTP layer; preventing session-ID-as-auth; blocking token passthrough to downstream services), UI integration (plain JS EventSource for streaming — never HTMX SSE extension — due to known HTMX 2.0 inheritance issues), and cost control (rolling-window conversation history from day one to prevent quadratic token cost growth). All three risks are addressable with well-established patterns already partially implemented in the codebase.

---

## Key Findings

### Recommended Stack

The stack change for v3.0.0 is deliberately minimal. Two new runtime packages cover the entire MCP layer: `@modelcontextprotocol/sdk@^1.29.0` (official Anthropic SDK, server and client in one package) and `fastify-mcp@^2.1.0` (haroldadmin's plugin, which adds Streamable HTTP transport and per-session management that the raw SDK lacks). Zod, uuid, and better-sqlite3 are already present and satisfy all remaining MCP dependencies. For the agent UI, the Web Speech API is browser-native with zero install cost for speech-to-text input (Chrome/Edge only). The MCP Inspector (`npx @modelcontextprotocol/inspector`) is a dev-time tool for testing MCP endpoints, no production dependency needed.

**Core technologies:**
- `@modelcontextprotocol/sdk@^1.29.0`: MCP server + client runtime — official SDK, MIT, covers both server definitions and in-process client transport for the agent loop
- `fastify-mcp@^2.1.0`: Fastify plugin wrapping SDK's Streamable HTTP transport — handles session management the raw SDK omits; peerDep on Fastify 5 (already in stack)
- `zod@^4.3.6` (existing): MCP SDK peer dependency satisfied by existing install — no new package
- `better-sqlite3` (existing): Conversation history and audit log storage — no new DB, no Redis
- Web Speech API (browser-native): Zero-cost speech-to-text for Chrome/Edge users; text input fallback for Firefox

**What not to use:** SSE-only MCP transport (deprecated June 2025), Vercel AI SDK (Next.js-specific), LangChain.js (duplicates existing capability engine), Redis for conversation sessions (would add new infrastructure — SQLite is sufficient), `fastify-mcp-server` by flaviodelgrosso (requires ioredis).

### Expected Features

The v3.0.0 MVP centers on 12 table-stakes capabilities. RBAC-scoped tool visibility is the hardest to build correctly (dynamic manifest filtering per caller from JWT claims) and must exist before any tool is exposed. Streamable HTTP transport is non-negotiable for external client compatibility. The dashboard agent side panel, per-user persistent conversation history, explicit confirmation UI for destructive operations, and audit logging complete the minimum viable agent experience.

**Must have (table stakes — v3.0.0):**
- MCP tools for compliance, branding, and LLM services with Streamable HTTP transport
- OAuth2 JWT validation on all MCP endpoints (reuse existing `validateJWT` middleware)
- RBAC-scoped tool manifest (dynamic filtering per caller based on JWT claims)
- Org-aware tool scoping (all tool calls pre-scoped to `req.orgId` from JWT)
- Dashboard agent side panel with text input (HTMX-rendered Handlebars partial)
- Agent routes through existing LLM capability engine (no separate LLM client)
- Per-user persistent conversation history in SQLite (last 20 turns)
- Explicit confirmation UI for state-changing tool calls (reuse existing `<dialog>` pattern)
- Audit log for every tool invocation (`agent_audit_log` table)

**Should have (post-validation, v3.0.x):**
- Speech input via Web Speech API (progressive enhancement on text input)
- MCP Resources primitive for scan reports and brand scores
- MCP Prompts primitive (slash-command shortcuts: `/scan`, `/report`, `/fix`)
- Context-aware agent suggestions (inject recent scans/guidelines into system prompt)
- Token budget and conversation compaction (sliding window + summary at 85% context)

**Defer (v3.1+):**
- Server Card (`.well-known/mcp.json`) discovery
- MCP tools for dashboard service itself (high RBAC risk surface)
- External client API key / device code auth for Claude Desktop

### Architecture Approach

Luqen v3.0.0 adds three layers to the existing architecture: (1) Streamable HTTP MCP endpoints embedded in each existing Fastify service as plugins, (2) a dashboard `AgentService` that orchestrates LLM calls through the existing capability engine and dispatches tool calls through each service's `/mcp` endpoint via `StreamableHTTPClientTransport`, and (3) an HTMX side panel with plain JS EventSource for streaming responses. All conversation state persists in two new SQLite tables in `dashboard.db` following existing migration patterns. No new infrastructure, no new ports beyond what exists.

**Major components:**
1. **Service MCP servers** (compliance `/mcp` existing + HTTP transport, branding `/mcp` new, LLM `/mcp` new) — Fastify plugin mounting a `McpServer` at `POST /api/v1/mcp`; stateless transport per request; auth middleware reusing `requireScope`; RBAC filtering per caller JWT
2. **Dashboard MCP server** (new) — External client access to dashboard operations; mounted at `POST /mcp` on the dashboard Fastify instance
3. **AgentService** (new) — Conversation orchestration: loads history from `ConversationRepository`, injects org context + RBAC-filtered tool list, dispatches tool calls via HTTP to service `/mcp` endpoints, writes audit log, stores turns in SQLite
4. **ConversationRepository** (new) — CRUD for `agent_conversations` + `agent_messages` tables; rolling-window query (last N turns) for context construction
5. **Agent UI side panel** (new) — Handlebars partial in main layout; HTMX POST for message submission; plain JS `EventSource` for streaming response; Web Speech API behind feature detection

**Key patterns to follow:**
- One `McpServer` per service on startup; new `NodeStreamableHTTPServerTransport` per HTTP request (stateless)
- RBAC tool list built before first LLM call (not as a runtime guard after tool_call arrives)
- AgentService always uses HTTP transport to call service MCP endpoints — never direct module imports
- Messages stored as `MessageParam`-compatible JSON — no transformation layer between DB and LLM API

### Critical Pitfalls

1. **Session IDs as authentication** — Generate with `crypto.randomUUID()`, bind all session state to `${userId}:${sessionId}`, re-verify OAuth JWT on every MCP request. Failure mode: session hijacking and cross-user data access. Address in: MCP server foundation phase.

2. **Confused deputy / RBAC at HTTP layer only** — The dashboard agent holds broad service OAuth credentials. Without per-user `TOOL_PERMISSION_MAP` checks at the agent layer, org members can invoke admin-only tools. Build filtered tool list from `resolveEffectivePermissions(userId, orgId)` before the LLM sees any tools. Address in: MCP server foundation phase (must precede any tool exposure).

3. **Token passthrough to downstream services** — Never forward the user's Bearer token to compliance/branding/LLM services. Use existing dashboard service OAuth credentials for downstream calls. Address in: MCP server foundation phase.

4. **HTMX SSE conflicts** — Using `hx-sse` for agent streaming will collide with HTMX 2.0 `hx-select` inheritance (documented production issue). Use plain JS `EventSource` exclusively. Also: `@fastify/rate-limit` 429s bypass `setErrorHandler` — add `onSend` hook on the agent SSE path. Address in: Agent UI phase.

5. **Unbounded conversation history** — Full history sent to LLM per turn causes exponential cost growth (~3-5x latency after 30 turns). Design rolling window (last 15-20 turns + optional summary) into the schema from day one. Address in: Conversation persistence phase.

6. **Destructive confirmation state in memory only** — Pending tool confirmations must persist in `agent_messages` (status `pending_confirmation`), not JavaScript memory. Page refresh between "tool proposed" and "user confirmed" must recover the state. Address in: Conversation persistence phase (schema) + Agent UI phase (confirmation wiring).

7. **SSE-only transport** — Deprecated in MCP spec (March/June 2025). Build Streamable HTTP from day one using `fastify-mcp` plugin; `reply.hijack()` with manual SSE framing is the wrong path. Address in: MCP server foundation phase.

---

## Implications for Roadmap

Based on the dependency graph from ARCHITECTURE.md and the pitfall-to-phase mapping from PITFALLS.md, a 6-phase structure is recommended. Security-critical decisions (RBAC, auth, transport) must be locked in Phase 1 because they propagate to every subsequent phase.

### Phase 1: MCP Server Foundation (Service HTTP Endpoints)

**Rationale:** OAuth2 + RBAC must exist before any tool is exposed. Transport choice (Streamable HTTP) is architectural — not patchable later. This phase unblocks all subsequent phases. Addresses the three highest-severity pitfalls (session auth, confused deputy, token passthrough) at the root.
**Delivers:** Working `POST /mcp` endpoints on compliance (HTTP transport added to existing server), branding (new MCP server), and LLM (new MCP server). Auth middleware. RBAC tool filtering per caller JWT. Audit log hook wired to tool execution.
**Addresses:** MCP tools for all three services, Streamable HTTP transport, OAuth2 JWT validation, RBAC-scoped tool manifest, org-aware tool scoping, audit logging.
**Avoids:** Pitfalls 1, 2, 3, 4, 5, 11 (session auth, confused deputy, token passthrough, tool poisoning, SSE-only transport, stdout corruption).

### Phase 2: Dashboard MCP Server (External Client Access)

**Rationale:** Follows Phase 1 auth patterns; separable from agent companion (no inter-service dependencies). Enables Claude Desktop / IDE integration. Can be built in parallel with Phase 3.
**Delivers:** `POST /mcp` on the dashboard service exposing dashboard operations. External MCP client connection verified with MCP Inspector or Claude Desktop.
**Uses:** `fastify-mcp` plugin (same as Phase 1), existing dashboard OAuth2 middleware, `resolveEffectivePermissions` for RBAC filtering.
**Implements:** Dashboard MCP Server component.

### Phase 3: Conversation Persistence (DB Layer)

**Rationale:** AgentService (Phase 4) depends on ConversationRepository. Schema decisions here — rolling window design and `pending_confirmation` status — cannot be retrofitted cheaply. Must precede the agent service.
**Delivers:** SQLite migrations `046_agent_conversations` and `047_audit_tool_invocations`. `ConversationRepository` with rolling-window query (last 20 turns). `AuditLogRepository` writing entries before and after tool execution.
**Avoids:** Pitfall 6 (unbounded history — rolling window designed in from day one), Pitfall 10 (confirmation state in memory — `pending_confirmation` status in schema from the start).

### Phase 4: AgentService and API Routes

**Rationale:** Depends on Phase 1 (MCP HTTP endpoints must be reachable) and Phase 3 (ConversationRepository must exist). This is the core orchestration logic — all UI phases depend on it.
**Delivers:** `AgentService` (conversation orchestration, LLM dispatch via LLM capability engine at `llm:4200`, MCP client pool, RBAC-filtered tool list, confirmation event emission, audit log writes). `POST /api/v1/agent/chat` and `GET /api/v1/agent/stream/:id` routes.
**Uses:** `StreamableHTTPClientTransport` to call service endpoints (not direct imports), `POST llm:4200/api/v1/capabilities/exec` for LLM calls.
**Avoids:** Anti-pattern 2 (direct module imports bypassing MCP and audit), Anti-pattern 4 (AgentService routes through capability engine, not direct provider calls).

### Phase 5: Agent UI Side Panel

**Rationale:** Depends on Phase 4 routes being available. Primary user-facing feature; most likely to need iteration. Should be built after backend contract is stable.
**Delivers:** Handlebars partial injected into `main.hbs`. Plain JS `EventSource` for streaming responses. HTMX POST for message submission. Confirmation dialog for destructive tools (existing native `<dialog>` pattern). Web Speech API behind feature detection. "Thinking..." loading state. Mobile dismissible overlay.
**Avoids:** Pitfall 7 (Web Speech fallback — feature-detected), Pitfall 8 (HTMX + SSE conflicts — plain JS EventSource only), Pitfall 9 (CSRF — Bearer-token-only endpoint), Pitfall 10 (confirmation UI wired to DB-persisted pending state).

### Phase 6: Audit, Polish, and RBAC Verification

**Rationale:** Hardening phase — verifies all security invariants before external release. Includes admin-facing audit log viewer, token budget enforcement, and the "looks done but isn't" checklist from PITFALLS.md.
**Delivers:** Audit log viewer in admin section. Per-org daily token limit in org settings. Agent companion status on system health page. Security verification suite: cross-session injection test, CSRF cross-origin POST, org isolation verification, Claude Desktop end-to-end.

### Phase Ordering Rationale

- Security-first: RBAC, auth middleware, and transport type must be locked in Phase 1 because they propagate to every tool invocation. Retrofitting after tools are built requires rewriting the entire tool execution path.
- Schema before logic: Phase 3 (DB schema) before Phase 4 (AgentService) because rolling-window design and `pending_confirmation` status shape the repository API that AgentService depends on.
- Services before UI: Phases 1-4 establish the backend contract; Phase 5 consumes it. API routes can be tested independently before frontend complexity is added.
- Parallelizable: Phase 2 (Dashboard MCP server) can run in parallel with Phase 3 (conversation persistence) once Phase 1 auth patterns are established.

### Research Flags

Phases needing deeper research during planning:
- **Phase 1:** MCP RBAC-scoped tool manifest (HIGH complexity per FEATURES.md) — specifically how to build a dynamic tool list per JWT caller using the `@modelcontextprotocol/sdk` API. Validate with MCP Inspector before writing agent code.
- **Phase 4:** Agent capability engine integration — the new `agent-conversation` capability must be registered in the existing LLM capability engine. Inspect `packages/llm/src/capabilities/` directly to understand the registration API.
- **Phase 6:** Token counting approach — confirm whether to use `tiktoken` (new dependency) or a character-count approximation to stay within model context limits.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Dashboard MCP server follows identical pattern to Phase 1 service servers — no new research needed.
- **Phase 3:** SQLite migration and repository pattern fully established in codebase (`MigrationRunner`, existing `repositories/` folder).
- **Phase 5:** HTMX partial + plain JS EventSource patterns established and documented in project memory. Web Speech API fallback pattern documented in PITFALLS.md.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official SDK verified at npm; `fastify-mcp` peer deps confirmed; version compatibility matrix validated; existing stack checked against codebase directly |
| Features | HIGH | MCP spec primitives from official spec; Luqen-specific integration points from direct codebase inspection; anti-features reasoned against known project constraints |
| Architecture | HIGH | Based on direct codebase inspection of existing MCP servers (compliance, core, monitor) + established Luqen patterns (OAuth, SQLite migrations, HTMX conventions) |
| Pitfalls | HIGH | MCP security pitfalls from official spec + verified 2025 incidents; HTMX/SSE pitfalls from project memory (production-verified); SQLite concurrency from SQLite docs |

**Overall confidence:** HIGH

### Gaps to Address

- **`fastify-mcp` maintenance status:** Recommended plugin flagged MEDIUM confidence for maintenance activity. During Phase 1 planning, confirm the plugin is actively maintained or identify the raw SDK fallback (`NodeStreamableHTTPServerTransport` directly) as the contingency.
- **`agent-conversation` capability registration:** How to register new capability types in the existing LLM capability engine is not fully documented in research. Phase 4 planning should inspect `packages/llm/src/capabilities/` before writing the `agent-conversation` capability.
- **Token counting library:** Research does not specify whether a token counter exists in the codebase. For Phase 6, confirm token approximation approach (character count / 4 avoids an additional dependency; `tiktoken` is more accurate but adds ~1MB npm package).
- **`fastify-mcp` session state across restarts:** Plugin manages session state in-memory. Confirm whether `fastify-mcp@^2.1.0` supports a pluggable session store or whether session metadata must be persisted in SQLite manually with `Last-Event-ID` reconnection.
- **Web Speech API Chrome privacy disclosure:** Audio routed to Google servers. During Phase 5 planning, confirm whether EU accessibility compliance team users have data residency constraints that make this unacceptable. If so, defer speech input to post-MVP.

---

## Sources

### Primary (HIGH confidence)
- `packages/compliance/src/mcp/server.ts`, `packages/core/src/mcp.ts`, `packages/monitor/src/mcp/server.ts` — direct inspection of existing MCP infrastructure
- `packages/dashboard/src/db/sqlite/migrations.ts` + `repositories/` — direct inspection of migration and repository patterns
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — canonical tool/resource/prompt primitives, OAuth 2.1 resource server requirements
- [MCP Security Best Practices — Official Spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices) — session hijacking, token passthrough, scope minimization
- `@modelcontextprotocol/sdk` npm — version 1.29.0 current stable, MIT license, peer deps confirmed
- `npm view fastify-mcp` — version 2.1.0, peerDep `fastify@^5.2.1`, dep `@modelcontextprotocol/sdk@^1.24.3`
- [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — browser support, HTTPS requirement, privacy behavior
- [Invariant Labs: Tool Poisoning Attack](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks) — tool description injection
- Project memory: `feedback_htmx_inheritance.md`, `feedback_rate_limiter.md`, `feedback_service_auth_pattern.md` — production-verified platform constraints

### Secondary (MEDIUM confidence)
- [haroldadmin/fastify-mcp](https://github.com/haroldadmin/fastify-mcp) — session management, Streamable HTTP support
- [MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — Streamable HTTP, Server Cards
- [MCP Audit Logging — Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) — per-invocation logging patterns
- [Securing MCP Servers — InfraCloud](https://www.infracloud.io/blogs/securing-mcp-servers/) — RBAC and confirmation patterns
- [Context Window Management — Maxim](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — compaction strategies
- [MCP Elicitation: Human-in-the-Loop](https://dzone.com/articles/mcp-elicitation-human-in-the-loop-for-mcp-servers) — confirmation UI patterns
- [Agentic Accessibility — Siteimprove](https://www.siteimprove.com/blog/agentic-accessibility/) — competitor AI agent approach

### Tertiary (LOW confidence — validate during implementation)
- [MCP SSE vs Stdio 2026](https://apigene.ai/blog/mcp-sse-vs-stdio) — Claude Desktop stdio bridge pattern
- [MCP Audit Logging Patterns](https://bytebridge.medium.com/implementing-audit-logging-and-retention-in-mcp-cc4d28ee7c50) — OTel semantic conventions

---
*Research completed: 2026-04-16*
*Ready for roadmap: yes*
