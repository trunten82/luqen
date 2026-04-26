# Architecture Research

**Domain:** MCP Servers + AI Agent Companion for Luqen WCAG Platform
**Researched:** 2026-04-16
**Confidence:** HIGH — based on direct inspection of existing codebase + @modelcontextprotocol/sdk v1.27.1 docs

---

## What Already Exists

This is a **net-new layer on an established platform**, not greenfield. Three packages already have working MCP infrastructure:

| Package | MCP Status | Transport | Tools |
|---------|-----------|-----------|-------|
| `@luqen/core` | DONE — `src/mcp.ts` | stdio | `luqen_scan`, `luqen_get_issues`, `luqen_propose_fixes`, `luqen_apply_fix`, `luqen_raw`, `luqen_raw_batch` |
| `@luqen/compliance` | DONE — `src/mcp/server.ts` | stdio + Fastify plugin | 11 tools: check, list-jurisdictions, list-regulations, list-requirements, get-regulation, propose-update, get-pending, approve-update, list-sources, add-source, seed |
| `@luqen/monitor` | DONE — `src/mcp/server.ts` | stdio | `monitor_scan_sources`, `monitor_status`, `monitor_add_source` |

Both compliance and monitor also have **A2A (Agent-to-Agent) infrastructure**: `/.well-known/agent.json` agent cards and `/a2a/tasks` SSE task streaming endpoints. These follow the emerging A2A protocol — useful precedent for the agent companion.

**Missing MCP servers:** `@luqen/llm`, `@luqen/branding` (the branding service), and the dashboard itself.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            External MCP Clients                               │
│              Claude Desktop │ IDEs │ Claude SDK │ Custom Scripts              │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │  Streamable HTTP  (POST /mcp)
                         │
┌────────────────────────▼────────────────────────────────────────────────────┐
│                        Dashboard  :3000 (Fastify)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Agent Companion (new)                                               │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │  Side Panel  │  │  AgentService│  │  ConversationRepository  │  │    │
│  │  │  (HTMX+JS)   │  │  (orchestr.) │  │  (SQLite — new table)    │  │    │
│  │  │  Web Speech  │  │              │  │                          │  │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘  │    │
│  │         │  SSE response   │  tool calls via MCP Client               │    │
│  │  POST /api/v1/agent/chat  │                                          │    │
│  │  GET  /api/v1/agent/stream│                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  POST /mcp  (Streamable HTTP — external clients only)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Dashboard MCP Server (new)                                          │    │
│  │  dashboard_scan, dashboard_list_reports, dashboard_list_orgs, ...   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└────────────────┬──────────────────────────────────────────────────────────┘
                 │  OAuth2 client credentials  (existing pattern)
       ┌─────────┼──────────────────────────┐
       ▼         ▼                          ▼
┌──────────┐ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Compliance│ │ Branding │  │   LLM    │  │  Core    │  │ Monitor  │
│  :4000   │ │  :4100   │  │  :4200   │  │  (lib)   │  │ (daemon) │
│          │ │          │  │          │  │          │  │          │
│  /mcp    │ │  /mcp    │  │  /mcp    │  │  stdio   │  │  stdio   │
│ (DONE)   │ │  (new)   │  │  (new)   │  │  (DONE)  │  │  (DONE)  │
└──────────┘ └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## Component Responsibilities

| Component | Responsibility | New / Modified |
|-----------|---------------|----------------|
| Dashboard MCP Server | Exposes dashboard ops (scan, reports, orgs, users) to external MCP clients | New — `packages/dashboard/src/mcp/` |
| Dashboard Agent Companion | HTMX side panel + AgentService + conversation history | New — routes, services, DB migrations |
| AgentService | Orchestrates LLM calls, dispatches MCP tool calls, enforces RBAC on tool selection | New — `packages/dashboard/src/services/agent-service.ts` |
| ConversationRepository | Per-user conversation history in SQLite (new migration) | New — `packages/dashboard/src/db/sqlite/repositories/conversation-repository.ts` |
| Branding MCP Server | Exposes branding ops (guidelines, brand scoring, discover-branding) | New — `packages/branding/src/mcp/` |
| LLM MCP Server | Exposes LLM ops (providers, models, capabilities, prompt overrides) | New — `packages/llm/src/mcp/` |
| MCP Auth Middleware | Verifies OAuth2 Bearer token on every MCP request (reuses existing auth pattern) | New — shared with existing `auth/middleware.ts` |
| Audit Log Hook | Writes tool_name, user, org, args, outcome, latency to audit table after every invocation | New — Fastify `onResponse` hook |

---

## MCP Transport Strategy

### Existing services (compliance, branding, LLM): Streamable HTTP endpoint alongside REST

The compliance MCP server already uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. The current compliance `cli.ts` connects it via stdio. For dashboard access and external clients, each service needs an HTTP endpoint.

**Pattern** (matches compliance existing API server pattern):

```typescript
// packages/llm/src/api/routes/mcp.ts
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createLLMMcpServer } from '../../mcp/server.js';

export async function registerMcpRoutes(app: FastifyInstance, opts: { db: DbAdapter }) {
  const { server: mcpServer } = await createLLMMcpServer({ db: opts.db });

  app.post('/mcp', { config: { rawBody: true } }, async (request, reply) => {
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    reply.raw.on('close', () => { transport.close(); });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
```

Auth middleware wraps the `/mcp` route using the same `requireScope` pattern already in these services.

### Dashboard: Streamable HTTP for external clients + in-process for agent companion

Dashboard's agent companion calls MCP servers **in-process** using `StreamableHTTPClientTransport` against the other services' `/mcp` endpoints — not stdio, not in-memory (InMemoryTransport is not for production in SDK v1.27+). The dashboard's own MCP server exposes `/mcp` for Claude Desktop / IDE use.

```
External Claude Desktop  →  POST dashboard:3000/mcp   (Streamable HTTP)
Agent Companion          →  HTTP calls to compliance:4000/mcp, branding:4100/mcp, llm:4200/mcp
```

---

## Agent Companion: Data Flow

```
User types in side panel (or speaks via Web Speech API)
    ↓
POST /api/v1/agent/chat  { orgId, userId, message, conversationId? }
    ↓
AgentService.processMessage()
    1. Load conversation history from ConversationRepository (last N turns)
    2. Inject org context + user RBAC permissions into system prompt
    3. Build tool list filtered by user permissions (RBAC gate)
    4. Call LLM service capability engine (POST llm:4200/api/v1/capabilities/exec)
       with model = 'agent-conversation' capability
    5. LLM returns tool_call | text
    6. If tool_call:
       a. Check tool against user permissions again (double-gate)
       b. If state-changing: return confirmation_required event to client
       c. Client confirms → continue
       d. Call MCP server via StreamableHTTPClientTransport (compliance/branding/llm)
       e. Write audit log entry (userId, orgId, tool, args, outcome, latencyMs)
       f. Append tool result to conversation, loop back to step 4
    7. Persist assistant + user turns to ConversationRepository
    8. Stream text back to client via SSE (GET /api/v1/agent/stream/:conversationId)
    ↓
HTMX side panel polls SSE → appends assistant message to chat history
```

### Conversation History Schema (new migration)

```sql
CREATE TABLE agent_conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  org_id     TEXT NOT NULL,
  title      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT NOT NULL,     -- JSON: MessageParam-compatible
  tool_name       TEXT,              -- populated for tool role
  created_at      TEXT NOT NULL
);
```

This follows the existing SQLite migration pattern (MigrationRunner in `db/sqlite/migrations.ts`). Conversation repository joins the existing `repositories/` folder pattern.

---

## HTMX Constraint: Speech and Streaming

The dashboard is **server-rendered HTMX + Handlebars**. There is no SPA framework. This creates specific constraints:

### Side Panel Rendering

The agent companion side panel is a **persistent Handlebars partial** injected into the main layout (`views/layouts/main.hbs`), always rendered server-side. It does not require HTMX for its initial state.

HTMX is used for **submitting messages** (POST form on enter/button). The response is an HTMX swap that appends the user's message bubble to the chat history div.

**Do not use `hx-select` for cross-section swaps** — existing lesson: HTMX 2.0 `hx-select` inheritance breaks cross-section swaps. The chat history div and the side panel are in the same layout column, so this is safe.

### Streaming Response — Plain JS EventSource (not HTMX)

Streaming LLM responses to the UI cannot use HTMX. Use **plain JS `EventSource`** (native SSE API) to receive token-by-token or message-complete events:

```javascript
// In a non-module <script> block in the side panel partial
const source = new EventSource(`/api/v1/agent/stream/${conversationId}`);
source.addEventListener('token', (e) => {
  document.getElementById('typing-bubble').textContent += e.data;
});
source.addEventListener('done', () => {
  source.close();
  // Replace typing bubble with final message via direct DOM
});
```

This follows the existing lesson from `feedback_htmx_inheritance.md`: use plain JS fetch/EventSource for cross-section or streaming interactions.

### Speech I/O — Web Speech API

Web Speech API (SpeechRecognition + SpeechSynthesis) runs entirely in the browser. No server-side Whisper needed for MVP.

```javascript
// Input: browser speech recognition
const recognition = new webkitSpeechRecognition() || new SpeechRecognition();
recognition.onresult = (e) => {
  document.getElementById('agent-input').value = e.results[0][0].transcript;
};

// Output: browser speech synthesis
const utterance = new SpeechSynthesisUtterance(text);
window.speechSynthesis.speak(utterance);
```

Both APIs are gated behind feature detection. If unavailable (some browsers, server-rendered contexts), text-only gracefully degrades — no fallback needed beyond hiding the mic button.

---

## RBAC Tool Scoping

Every MCP tool exposed to the agent companion must be gated by the user's existing RBAC permissions. The mapping is straightforward:

| MCP Tool Prefix | Required Permission |
|-----------------|-------------------|
| `compliance_*` | `compliance.view` (read) / `compliance.manage` (write) |
| `branding_*` | `branding.view` (read) / `branding.manage` (write) |
| `llm_*` | `llm.view` (read) / `llm.manage` (write) |
| `dashboard_scan` | `scan.create` |
| `dashboard_list_reports` | `reports.view` |
| `dashboard_approve_*` | `admin.org` or `admin.system` |

AgentService builds the tool list at session start from `resolveEffectivePermissions(userId, orgId)` (already exists in `packages/dashboard/src/permissions.ts`).

State-changing tools (`_create`, `_update`, `_delete`, `_approve`) trigger a **confirmation UI event** before executing. The client sends a `confirm: true` flag in the follow-up request.

---

## Recommended Project Structure

```
packages/
├── compliance/src/
│   └── mcp/
│       └── server.ts          # DONE — add HTTP transport route to api/server.ts
│
├── branding/src/
│   └── mcp/                   # NEW
│       └── server.ts          # branding_list_guidelines, branding_get_score,
│                              # branding_discover, branding_create_guideline, ...
│
├── llm/src/
│   └── mcp/                   # NEW
│       └── server.ts          # llm_list_providers, llm_list_models,
│                              # llm_exec_capability, llm_list_prompts, ...
│
└── dashboard/src/
    ├── mcp/                   # NEW
    │   └── server.ts          # dashboard_scan, dashboard_list_reports,
    │                          # dashboard_list_orgs, dashboard_get_report, ...
    ├── services/
    │   └── agent-service.ts   # NEW — conversation orchestration + tool dispatch
    ├── db/sqlite/repositories/
    │   └── conversation-repository.ts  # NEW — CRUD for agent_conversations/messages
    └── routes/
        └── api/
            └── agent.ts       # NEW — POST /chat, GET /stream/:id
```

---

## Integration Points: New vs Modified

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `branding/src/mcp/server.ts` | Branding service | MCP tool surface for brand ops |
| `llm/src/mcp/server.ts` | LLM service | MCP tool surface for LLM admin + capability exec |
| `dashboard/src/mcp/server.ts` | Dashboard | External MCP client access to dashboard ops |
| `dashboard/src/services/agent-service.ts` | Dashboard | Agent loop: LLM calls, tool dispatch, history |
| `dashboard/src/db/sqlite/repositories/conversation-repository.ts` | Dashboard | Persist conversation turns |
| `dashboard/src/routes/api/agent.ts` | Dashboard | HTTP endpoints for agent companion |
| Migration `046_agent_conversations.ts` | Dashboard | New tables: agent_conversations, agent_messages |
| Migration `047_audit_tool_invocations.ts` | Dashboard | Audit log entries for MCP tool calls |

### Modified Components

| Component | Change |
|-----------|--------|
| `compliance/src/api/server.ts` | Add `app.post('/mcp', ...)` route (Streamable HTTP) |
| `branding/src/api/server.ts` | Add `app.post('/mcp', ...)` route |
| `llm/src/api/server.ts` | Add `app.post('/mcp', ...)` route |
| `dashboard/src/server.ts` | Register dashboard MCP route, agent routes, side panel partial |
| `dashboard/src/views/layouts/main.hbs` | Inject agent side panel partial |
| Dashboard system health page | Add agent companion status + conversation count |

---

## Build Order (Dependency Graph)

```
Phase 1: Service MCP HTTP endpoints
  compliance /mcp route (minimal — server already exists)
  branding   /mcp server + route            (no deps)
  llm        /mcp server + route            (no deps)

Phase 2: Dashboard MCP server (external access)
  depends on: none (dashboard has its own data access)
  dashboard /mcp server + route + auth middleware

Phase 3: Conversation persistence
  DB migration (agent_conversations, agent_messages, audit_tool_invocations)
  ConversationRepository                    (no deps beyond migration)

Phase 4: AgentService + routes
  depends on: Phase 1 (MCP clients need /mcp endpoints up)
  depends on: Phase 3 (needs ConversationRepository)
  AgentService: MCP client pool (one per service), tool-list builder, RBAC gate
  POST /api/v1/agent/chat + GET /api/v1/agent/stream/:id

Phase 5: HTMX side panel UI
  depends on: Phase 4 (routes must exist)
  Handlebars partial for side panel
  Plain JS EventSource for streaming
  Web Speech API integration
  Confirmation dialog for state-changing tools (native <dialog> pattern)

Phase 6: Audit + RBAC polish
  depends on: Phase 4 (tool invocations must exist)
  Audit log viewer in admin section
  Token budget / session limits per org
```

---

## Architectural Patterns to Follow

### Pattern 1: One MCP server factory per service (existing pattern)

Compliance already has `createComplianceMcpServer(options)` returning `{ server, toolNames }`. Branding and LLM should follow the same factory signature. This makes the server testable in isolation (inject a mock DB) and usable in both stdio (external CLI) and HTTP contexts.

### Pattern 2: Stateless HTTP transport (no session affinity)

Use `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` — stateless, one transport per request. This matches existing services which have no sticky session requirement and simplifies deployment (no shared transport state between Fastify worker threads).

### Pattern 3: RBAC-scoped tool list (not runtime enforcement alone)

Build the allowed tool list **before** the first LLM call, not as a runtime check after a tool_call response arrives. This prevents token waste on tool calls the agent cannot execute. Two layers: build-time filter (exclude disallowed tools from `tools[]` param) + call-time gate (double-check before executing, return error to LLM if somehow bypassed).

### Pattern 4: Agent uses LLM capability engine, not direct API calls

AgentService must route through `POST llm:4200/api/v1/capabilities/exec` (the existing capability execution engine), not call Anthropic/Ollama/OpenAI directly. This ensures per-org model selection, provider fallback, retry with exponential backoff, and prompt override all apply to agent conversations too. A new capability name `agent-conversation` needs registering in the capability engine.

### Pattern 5: Conversation history as MessageParam array

Store messages in the format the LLM API expects — `{ role: 'user' | 'assistant' | 'tool', content: string | ContentBlock[] }`. This means direct serialization to/from JSON in the `content` column with no transformation layer. Load the last N turns (e.g. 20) to stay within context window.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared MCP server singleton across requests

**What people do:** Create one `McpServer` instance and share it across all HTTP requests for efficiency.
**Why it's wrong:** McpServer is stateful during a session. Concurrent requests with different auth contexts will bleed into each other.
**Do this instead:** Create one `McpServer` per service on startup, but create a new `NodeStreamableHTTPServerTransport` per HTTP request. The transport is what's per-request; the server is shared.

### Anti-Pattern 2: Agent calls services directly instead of through MCP

**What people do:** AgentService imports compliance/branding service modules directly and calls their TypeScript functions, bypassing the MCP layer entirely.
**Why it's wrong:** Bypasses tool-level audit logging, RBAC gate, and confirmation UI — the whole safety layer. Also means external MCP clients (Claude Desktop) don't get the same behavior as the in-dashboard agent.
**Do this instead:** AgentService always uses `StreamableHTTPClientTransport` to call the services' `/mcp` endpoints, even though they're on the same server.

Exception: The AgentService can call its own (dashboard's) MCP tools in-process, but should still route through the tool gate.

### Anti-Pattern 3: HTMX for streaming chat responses

**What people do:** Use `hx-sse` or `hx-trigger="sse:..."` to stream agent responses.
**Why it's wrong:** `hx-select` and SSE inheritance has known issues (documented pitfall in project). Streaming state management is better handled in plain JS.
**Do this instead:** Plain JS `EventSource` for the SSE stream. HTMX only for the initial message submission (POST form swap).

### Anti-Pattern 4: Storing tool args in audit log without sanitization

**What people do:** Write raw tool args to the audit log including any user-provided strings.
**Why it's wrong:** Tool args can contain PII (URLs, selectors, content snippets). Raw args also make logs enormous.
**Do this instead:** Store arg keys and sizes only, not values. Or store a summary hash. Keep full args in a separate table with a shorter retention policy.

---

## Scaling Considerations

| Concern | Current Scale | Mitigation |
|---------|--------------|------------|
| Agent SSE connections | One per active user; SQLite is fine | Redis pubsub if > 50 concurrent users |
| Conversation history growth | ~1KB per turn, 20 turns per session | `agent_messages` pruned after 90 days via scheduled sweep |
| MCP transport overhead | One HTTP round-trip per tool call; acceptable for batch capabilities | No change needed — LLM latency dominates |
| Token budget | Agent conversations are expensive | Per-org daily token limit in org settings table |
| Concurrent agent sessions | SQLite writer lock on `agent_messages` inserts | Use WAL mode (already enabled in dashboard) |

---

## Sources

- `packages/compliance/src/mcp/server.ts` — existing MCP server pattern (direct inspection, HIGH confidence)
- `packages/core/src/mcp.ts` — existing stdio MCP server with 6 tools (direct inspection, HIGH confidence)
- `packages/compliance/src/a2a/agent-card.ts` + `tasks.ts` — A2A task streaming over SSE (direct inspection, HIGH confidence)
- `packages/monitor/src/mcp/server.ts` — monitor MCP server (direct inspection, HIGH confidence)
- `@modelcontextprotocol/sdk` v1.27.1 — Fastify Streamable HTTP transport docs via Context7 (HIGH confidence)
- `packages/dashboard/src/server.ts` — Fastify server wiring, plugin registration pattern (direct inspection, HIGH confidence)
- `packages/dashboard/src/db/sqlite/migrations.ts` + `repositories/` — migration and repository patterns (direct inspection, HIGH confidence)
- Project memory: `feedback_htmx_inheritance.md`, `feedback_htmx_partials.md` — HTMX constraints (HIGH confidence)
- Project memory: `feedback_service_auth_pattern.md` — OAuth2 inter-service auth (HIGH confidence)

---

*Architecture research for: MCP Servers + Agent Companion (v3.0.0)*
*Researched: 2026-04-16*
