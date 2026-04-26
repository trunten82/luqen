# Stack Research

**Domain:** MCP servers + dashboard AI agent companion (v3.0.0 milestone additions)
**Researched:** 2026-04-16
**Confidence:** HIGH for MCP SDK; MEDIUM for agent companion patterns; HIGH for speech I/O

---

## What This Document Covers

Only NET-NEW libraries needed for v3.0.0. The existing stack (Fastify 5, better-sqlite3, jose, zod 4, @fastify/rate-limit, vitest) is already validated and carries forward unchanged.

---

## Recommended Stack

### Core Technologies — MCP Layer

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server + client runtime; tool/resource definitions | Official Anthropic SDK, 78 releases, MIT, Fastify-compatible; v1.x is current stable (v2 not yet released as of April 2026) |
| `fastify-mcp` (haroldadmin) | `^2.1.0` | Fastify plugin wrapping MCP SDK's Streamable HTTP transport | Only plugin that supports both Streamable HTTP (required) and legacy SSE; ships its own session manager that fills a gap in the raw SDK; peerDep on Fastify 5 |
| `zod` | already at `^4.3.6` | Schema validation for MCP tool inputs | Already in stack; MCP SDK peer dependency — no new install needed |

### Core Technologies — Agent Companion

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` (client mode) | same as above | Dashboard calls each Luqen MCP server as an MCP client inside the agent loop | Same package covers client and server — no extra dependency |
| Browser Web Speech API | browser-native (no package) | Speech-to-text input in the agent side panel | Zero install, zero server cost for MVP; Chrome/Edge only — document this constraint clearly; good enough for non-mobile compliance stakeholders |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | already in stack | Generate stable per-user conversation thread IDs | Reuse existing import — no new install |
| `opentelemetry-api` | check existing | Structured audit log spans for tool invocations | MCP audit standard (OTel semantic conventions merged Jan 2026); add only if existing logger is insufficient for tool-call records |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `@modelcontextprotocol/inspector` | MCP Inspector — interactive test UI for MCP servers | Run via `npx @modelcontextprotocol/inspector` against each service's `/mcp` endpoint during development; no prod dependency |
| Existing `vitest` | Unit + integration tests for tool handlers | No change — use existing test setup |

---

## Transport Decision

Use **Streamable HTTP** exclusively. SSE transport was deprecated in the June 2025 spec revision. Claude Desktop currently requires stdio, but a lightweight wrapper process (`mcp-remote` or equivalent) can bridge stdio to Streamable HTTP without changing the server implementation.

**Each service exposes:** `POST /api/v1/mcp` (Streamable HTTP endpoint via `fastify-mcp` plugin)

**External stdio clients (Claude Desktop):** spawn a thin bridge process that relays stdio to the HTTP endpoint — no separate stdio server implementation required in Luqen services.

---

## Installation

```bash
# In each service package that becomes an MCP server
# (compliance, branding, llm, dashboard, and new mcp-gateway if created)
npm install @modelcontextprotocol/sdk fastify-mcp

# No other new runtime dependencies needed
# zod, fastify, better-sqlite3, jose are all already present
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `fastify-mcp` (haroldadmin) | `fastify-mcp-server` (flaviodelgrosso) | flaviodelgrosso's version requires ioredis as a dependency — adds Redis just for session state; avoid unless Redis is already in the stack |
| `fastify-mcp` (haroldadmin) | `getlarge/fastify-mcp` | getlarge variant targets the June 2025 spec with full OAuth 2.1 elicitation; useful if Luqen needs MCP-native OAuth discovery (`.well-known/oauth-protected-resource`), but Luqen already has its own OAuth2 layer — adds complexity without clear benefit |
| Raw `@modelcontextprotocol/sdk` + custom routes | Any Fastify plugin | Valid if session management needs are unusual — but the raw SDK explicitly lacks multi-session support out of the box; use the plugin |
| Web Speech API (browser-native) | AssemblyAI / Whisper server-side | Use server-side only if cross-browser support or high accuracy is required; Web Speech API routes audio to Google's servers — no data leaves the browser through Luqen, which may be a compliance advantage or concern depending on org policy |
| Per-service MCP endpoints | Dedicated MCP gateway service | A gateway (single port, routes to all services) is cleaner for external clients but adds a deployment unit; defer to post-MVP unless Claude Desktop integration is a day-one requirement |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| SSE-only MCP transport | Deprecated June 2025; not supported by future clients | Streamable HTTP via `fastify-mcp` |
| Vercel AI SDK (`ai` package) | Designed for Next.js/React; no Fastify or HTMX integration path; pulls in streaming primitives Luqen doesn't need | Custom agent loop using `@modelcontextprotocol/sdk` Client + existing LLM capability engine |
| LangChain.js | Heavyweight abstraction over primitives Luqen already owns (provider routing, retry, fallback); the existing LLM capability engine already handles all of this | Existing `@luqen/llm` capability engine |
| `fastmcp` (punkpeye) | Framework on top of SDK; opinionated structure conflicts with existing Fastify service patterns | Raw SDK + `fastify-mcp` plugin, which preserves the Fastify-native pattern |
| Redis for conversation session state | Would add a new infrastructure dependency; conversation history is per-user, durable — not cache-like | SQLite (already in stack) with a `conversations` + `messages` table using `better-sqlite3` |

---

## Stack Patterns by Variant

**MCP server registration pattern (per service):**
Each service registers `fastify-mcp` as a Fastify plugin, defines its tools using `@modelcontextprotocol/sdk`'s `McpServer` API, and mounts the endpoint at `POST /api/v1/mcp`. Authentication middleware wraps the endpoint with existing OAuth2 JWT validation — MCP tools execute in the context of the authenticated org.

**Agent companion (dashboard):**
The dashboard creates an `@modelcontextprotocol/sdk` Client per user session, connects to each service's `/api/v1/mcp` endpoint using `StreamableHTTPClientTransport` with `ClientCredentialsProvider` (using the existing dashboard OAuth2 client credentials). The agent loop calls tools, collects results, formats them for the LLM via the existing LLM capability engine, and stores each turn in SQLite (`conversations` / `messages` tables keyed by `user_id`).

**Per-user conversation persistence:**
New SQLite tables in `dashboard.db` — no new DB file, no new DB library. Schema: `conversations(id, user_id, org_id, created_at, updated_at)` and `messages(id, conversation_id, role, content, tool_calls_json, created_at)`. Sliding-window context: keep last N messages in prompt (start with N=20, tune per token budget).

**RBAC-scoped tool access:**
MCP tool handlers read the JWT claim `permissions[]` (already propagated by the OAuth2 middleware) and return a structured error for tools the user's role cannot invoke — same as existing REST endpoint guards. No new permission model needed; tool names map 1:1 to existing permission strings.

**Audit logging:**
Each tool invocation appends a row to the existing `audit_log` table (add columns: `tool_name`, `tool_args_json`, `outcome`, `latency_ms`). No OTel dependency needed for MVP — structured SQLite rows satisfy the requirement. OTel is an option for a future observability phase.

**Confirmation UI for state-changing tools:**
Dashboard agent side panel checks a `requiresConfirmation: true` flag on tool definitions (Luqen-specific metadata on each MCP tool). When the flag is set, the panel renders a confirmation dialog (using the existing `<dialog>`/`showModal()` pattern from v2.12.0) before dispatching the tool call.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.29.0` | `fastify@^5` | SDK has no Fastify peer dep — compatibility through `fastify-mcp` |
| `@modelcontextprotocol/sdk@^1.29.0` | `zod@^4.3.6` | SDK peer requires zod ≥ 3.25; zod v4 satisfies this |
| `fastify-mcp@^2.1.0` | `fastify@^5.2.1` | Plugin's peerDep is Fastify 5; existing services are already on Fastify 5 |
| `fastify-mcp@^2.1.0` | `@modelcontextprotocol/sdk@^1.24.3` | Plugin's dep is `^1.24.3`; installing `^1.29.0` satisfies this constraint |
| Web Speech API | Chrome 90+, Edge 90+ | Firefox and Safari do not support SpeechRecognition; document in agent panel UI |

---

## Sources

- `@modelcontextprotocol/sdk` npm: `npm view @modelcontextprotocol/sdk` — version 1.29.0 current stable, MIT
- Context7 `/modelcontextprotocol/typescript-sdk` — transport system docs, auth provider patterns (HIGH confidence)
- [fastify-mcp by haroldadmin](https://github.com/haroldadmin/fastify-mcp) — session management, Streamable HTTP support (HIGH confidence)
- `npm view fastify-mcp` — version 2.1.0, peerDep `fastify@^5.2.1`, dep `@modelcontextprotocol/sdk@^1.24.3`
- [MCP transport docs](https://modelcontextprotocol.info/docs/concepts/transports/) — SSE deprecated June 2025, Streamable HTTP is standard (HIGH confidence)
- [MCP SSE vs Stdio 2026](https://apigene.ai/blog/mcp-sse-vs-stdio) — Claude Desktop uses stdio bridge pattern (MEDIUM confidence)
- [MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — Chrome/Edge only, routes audio to Google (HIGH confidence)
- [MCP audit logging patterns 2026](https://bytebridge.medium.com/implementing-audit-logging-and-retention-in-mcp-cc4d28ee7c50) — OTel semantic conventions merged Jan 2026 (MEDIUM confidence)
- [fastify-mcp-server (flaviodelgrosso)](https://github.com/flaviodelgrosso/fastify-mcp-server) — requires ioredis, avoid (MEDIUM confidence)

---

*Stack research for: Luqen v3.0.0 MCP Servers and Agent Companion*
*Researched: 2026-04-16*
