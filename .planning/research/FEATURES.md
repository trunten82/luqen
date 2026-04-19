# Feature Research — v3.0.0 MCP Servers & Agent Companion

**Domain:** MCP server layer + multimodal dashboard AI agent for an accessibility compliance SaaS
**Researched:** 2026-04-16
**Confidence:** HIGH for MCP protocol features (official spec verified); MEDIUM for agent companion UX patterns (best practices from production implementations); HIGH for Luqen-specific integration points (codebase known)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must exist for v3.0.0 to feel complete. Missing any of these means the milestone has not delivered on its stated goal.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| MCP Tools primitive for all services | MCP without tool exposure is not an MCP server — tools are the primary primitive (model-controlled, dynamically discoverable) | MEDIUM per service | Compliance, branding, LLM, scanner, dashboard each get their own tool set; map existing REST surface 1:1 to tool definitions |
| Streamable HTTP transport (not SSE) | SSE deprecated in MCP spec 2025-03-26; Claude Desktop and Claude API connector only support Streamable HTTP for remote servers as of 2026 | LOW–MEDIUM | The `@modelcontextprotocol/sdk` 1.10.0+ supports Streamable HTTP natively; multiple `fastify-mcp` plugins available |
| OAuth2 JWT validation on MCP endpoints | MCP spec requires servers to act as OAuth 2.1 resource servers; Luqen already issues RS256 JWTs — the MCP layer validates them the same way all other services do | MEDIUM | Reuse existing `validateJWT` middleware; no new auth server needed |
| RBAC-scoped tool visibility | Tools must be filtered by the caller's permissions before being advertised in the tool list — a viewer must never see admin-only tools in the discovery response | HIGH | This is the hardest part of MCP auth; requires dynamically building the tool manifest per-caller based on JWT claims |
| Dashboard agent side panel (text input) | A dashboard without a chat UI is not an agent companion — text input is the baseline | MEDIUM | HTMX-friendly side panel; no SPA framework needed; follows existing partial pattern |
| Org-aware tool scoping | All agent tool calls must be pre-scoped to `req.orgId` — the agent must never surface cross-org data to an org-level user | HIGH | Enforced at the MCP server layer, not the agent layer; org context injected from session into every tool call |
| Per-user persistent conversation history | Stateless agents forget context between sessions; users expect the agent to remember previous conversations with them | MEDIUM | Store in dashboard SQLite (new `agent_conversations` table); load N most-recent messages as context prefix |
| Explicit confirmation UI for destructive operations | MCP security best practices and user safety both require human-in-the-loop for state-changing operations (delete, rescore, update guideline) | MEDIUM | Dialog-based confirmation before the MCP tool call is dispatched; reuse existing native `<dialog>` pattern |
| Audit log for every tool invocation | Enterprise compliance requirement; every tool call must record: user, org, tool name, args summary, outcome, latency | MEDIUM | New `agent_audit_log` table; log on tool response, not tool request (so outcome is known) |
| Agent routes through existing LLM capability engine | The agent must use the same provider fallback, retry, and per-org model overrides as other LLM capabilities — not a separate LLM client | LOW | Call `POST /api/v1/generate-fix` style endpoints internally, or expose the capability engine directly to the agent orchestrator |

### Differentiators (Competitive Advantage)

Features that make Luqen's agent meaningfully better than a generic chatbot bolted to a REST API.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Speech input via Web Speech API | Non-technical stakeholders (legal, brand, content teams) can speak their compliance questions instead of typing — lowers the barrier to using the agent | MEDIUM | `SpeechRecognition` (or `webkitSpeechRecognition`) for STT; browser-native, zero server cost; Chrome/Edge/Safari supported; Firefox has no support — must provide text fallback gracefully |
| MCP Resources primitive for scan reports | Expose scan reports and brand score history as MCP Resources (application-controlled context) so external clients like Claude Desktop can pull live Luqen data as context without writing tool code | MEDIUM | Resources complement tools — tools DO things, resources READ things; implementing both primitives makes Luqen a first-class MCP citizen |
| External MCP client support (Claude Desktop, IDEs) | Any MCP-aware client can drive Luqen — scan sites, read reports, update guidelines — without dashboard login; developer-facing automation surface | MEDIUM | Requires public-facing Streamable HTTP endpoint + OAuth2 device code flow or API key auth for CLI clients; scoped to what the token permits |
| Context-aware agent suggestions | Agent proactively references the user's recent scans, current org's brand guidelines, and active regulations when answering questions — "Based on your last scan of example.com showing 14 contrast failures, here is what to fix" | HIGH | Requires injecting org context (recent scans, active guidelines, regulations) into the system prompt before each agent turn; query the DB for latest context, not the conversation history |
| Token budget + conversation compaction | Long conversations become expensive; smart compaction (replace full history with structured summary at ~80% context window) keeps the agent usable in long sessions without surprising cost spikes | HIGH | Track token usage per conversation turn; implement sliding window or summary-based compaction; warn user at 70%, compact at 85% |
| MCP Prompts primitive (slash-command shortcuts) | Let users trigger common workflows via predefined prompts: `/scan <url>`, `/report <site>`, `/fix <issue-id>` — Prompts are the least-implemented MCP primitive and an immediate differentiator | LOW–MEDIUM | Prompts are user-controlled templates in the MCP spec; map to common Luqen workflows; minimal server-side work once tools exist |
| Server Card (`.well-known` discovery) | MCP v2.1 requires Server Cards at `.well-known/mcp.json` for external registries and crawlers to discover server capabilities without connecting — forward-compatibility with the MCP ecosystem | LOW | Static JSON describing server name, version, capabilities, auth endpoints; no logic needed |

### Anti-Features (Commonly Requested, Often Problematic)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Real-time streaming LLM responses in agent chat | Feels more responsive; users see tokens appear as they are generated | Already listed as "Out of Scope" in PROJECT.md; adds SSE or WebSocket complexity to the dashboard; Ollama streaming is inconsistent across providers; batch responses with a "thinking…" indicator are sufficient for a compliance tool | Show a loading state; return complete response; use HTMX polling for progress if needed |
| Full conversation history in every LLM context | Users want the agent to "remember everything" | Quadratic token cost curve — full history re-serialized at every turn; at 20 messages × 2000 tokens each = 40k tokens of context, costing ~10x a fresh call; context limit errors are silent failures | Sliding window (last 8–10 turns) + structured summary of older turns injected as a single system message |
| Per-org custom agent personas / system prompts editable by users | Power users want to customize agent behavior | Prompt injection surface; users could override safety/scoping instructions; prompt fence markers (already built in v2.10.0) do not protect against malicious org admin overrides | Allow org admins to customize the "friendly name" and avatar of the agent only; keep system prompt locked |
| Server-side Whisper for speech transcription | Better transcription accuracy than browser STT; works in Firefox | Requires audio upload to server, storing potentially sensitive audio; additional infrastructure (Whisper API or self-hosted model); privacy concerns for EU data | Web Speech API for MVP; server-side Whisper as a future premium option behind a feature flag |
| Text-to-speech (TTS) output by default | Feels like a full voice assistant | Accessibility paradox — auto-playing speech in a compliance tool can itself be an accessibility issue (unexpected audio); WCAG 1.4.2 prohibits audio that auto-plays; adds complexity | Provide a manual "Read aloud" button using browser `SpeechSynthesis`; never auto-play |
| Cross-org tool calls for global admin | Global admins want the agent to answer "which org has the most issues?" | Cross-org queries through the agent bypass the org isolation guarantee that every Luqen feature has maintained; difficult to audit; expensive (all-orgs queries) | Global admin can switch org context in the dashboard and ask per-org questions; cross-org analytics remain in the admin dashboard, not the agent |
| MCP server as a new standalone Fastify service | Clean separation of concerns | Luqen already has 4+ services; another port increases operational overhead; the MCP layer is thin (protocol adapter over existing REST) — it does not warrant its own process | Embed MCP server routes into each existing service as a Fastify plugin; use the `fastify-mcp` or `haroldadmin/fastify-mcp` plugin |

---

## Feature Dependencies

```
[OAuth2 JWT validation on MCP endpoints]
    └──required by──> [RBAC-scoped tool visibility]
                          └──required by──> [All MCP tool sets]
                                                └──enables──> [Dashboard agent side panel]
                                                └──enables──> [External MCP client support]

[MCP Tools per service]
    └──required by──> [MCP Resources primitive]
    └──required by──> [MCP Prompts primitive]
    └──required by──> [Server Card discovery]

[Dashboard agent side panel (text input)]
    └──required by──> [Speech input via Web Speech API]
    └──required by──> [Context-aware agent suggestions]
    └──required by──> [Token budget + compaction]

[Per-user persistent conversation history]
    └──required by──> [Context-aware agent suggestions]
    └──required by──> [Token budget + compaction]

[Explicit confirmation UI for destructive operations]
    └──depends on──> [Dashboard agent side panel]

[Audit log for every tool invocation]
    └──depends on──> [MCP Tools per service]
    └──can be built in parallel with agent UI]

[Agent routes through existing LLM capability engine]
    └──required by──> [Dashboard agent side panel]
    └──required by──> [Context-aware agent suggestions]
```

### Dependency Notes

- **OAuth2 + RBAC before tools:** Tool manifests are dynamically filtered per caller — the auth layer must exist before any tool can be exposed.
- **MCP tools per service before external clients:** Claude Desktop cannot connect until at least one service has a working Streamable HTTP MCP endpoint.
- **Agent side panel before speech:** Web Speech API sends transcribed text to the same text input path — speech is a progressive enhancement on text input.
- **LLM capability engine integration first:** The agent must route through the existing provider/model/fallback chain from day one — building a separate LLM client for the agent creates divergence that is expensive to merge later.
- **Conversation history before compaction:** Compaction requires stored history to summarize — implement storage first, then sliding window, then summary compaction.

---

## MVP Definition

### Launch With (v3.0.0)

The minimum needed for v3.0.0 to deliver its stated goal: "turning Luqen from a tool-you-operate into an assistant-you-converse-with."

- [ ] MCP tools for compliance service (scan, list reports, check issues) — highest-value MCP surface for external clients
- [ ] MCP tools for branding service (list guidelines, get brand score, discover branding) — second most valuable
- [ ] MCP tools for LLM service (generate-fix, analyse-report) — closes the loop between scanning and fixing
- [ ] Streamable HTTP transport on all three services — required for Claude Desktop + Claude API connector
- [ ] OAuth2 JWT validation on all MCP endpoints — security non-negotiable
- [ ] RBAC-scoped tool manifest — tools filtered to caller's permissions
- [ ] Org-aware tool scoping — all tool calls pre-scoped to org from JWT claims
- [ ] Dashboard agent side panel with text input — core user-facing feature
- [ ] Agent routes through existing LLM capability engine — avoids duplicate provider management
- [ ] Per-user persistent conversation history (last 20 turns) — makes agent useful across sessions
- [ ] Explicit confirmation UI for state-changing tool calls — user safety
- [ ] Audit log for every tool invocation — enterprise requirement stated in PROJECT.md

### Add After Validation (v3.0.x)

Features to add once the core agent+MCP layer is working and user-tested.

- [ ] Speech input via Web Speech API — after text input is stable and UX is validated
- [ ] MCP Resources primitive for scan reports and brand scores — after tools are working
- [ ] MCP Prompts primitive (slash-commands) — after basic tool invocation UX is understood
- [ ] Context-aware agent suggestions (inject recent scans/guidelines into system prompt) — after conversation history is stable
- [ ] Token budget + conversation compaction — add when users start hitting long-session issues

### Future Consideration (v3.1+)

- [ ] Server Card (`.well-known/mcp.json`) — ecosystem integration, low urgency for private deployment
- [ ] MCP tools for dashboard service itself (manage users, orgs, service connections) — dangerous surface, needs careful RBAC design
- [ ] External MCP client auth (API key / device code flow for Claude Desktop) — OAuth2 for browser sessions is phase 1; CLI auth is phase 2

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| MCP Tools: compliance service | HIGH | MEDIUM | P1 |
| MCP Tools: branding service | HIGH | MEDIUM | P1 |
| MCP Tools: LLM service | HIGH | LOW (thin wrapper) | P1 |
| Streamable HTTP transport | HIGH | LOW (fastify-mcp plugin) | P1 |
| OAuth2 JWT on MCP endpoints | HIGH | LOW (reuse existing middleware) | P1 |
| RBAC-scoped tool manifest | HIGH | HIGH | P1 |
| Org-aware tool scoping | HIGH | MEDIUM | P1 |
| Dashboard agent side panel | HIGH | MEDIUM | P1 |
| LLM capability engine integration | HIGH | LOW | P1 |
| Per-user conversation history | HIGH | MEDIUM | P1 |
| Confirmation UI for destructive tools | HIGH | LOW (existing dialog pattern) | P1 |
| Audit log for tool invocations | MEDIUM | LOW | P1 |
| Speech input (Web Speech API) | MEDIUM | LOW | P2 |
| MCP Resources primitive | MEDIUM | MEDIUM | P2 |
| MCP Prompts primitive | MEDIUM | LOW | P2 |
| Context-aware agent suggestions | HIGH | MEDIUM | P2 |
| Token budget + compaction | MEDIUM | HIGH | P2 |
| Server Card discovery | LOW | LOW | P3 |
| MCP tools for dashboard service | MEDIUM | HIGH | P3 |
| External client API key auth | MEDIUM | HIGH | P3 |

---

## Competitor Feature Analysis

Luqen is not competing with generic MCP tools — it is competing with specialist accessibility tools (Siteimprove, Level Access, Deque) that are adding AI agents. The relevant comparison is how those platforms expose AI capabilities vs what Luqen's MCP+agent approach offers.

| Feature | Siteimprove / Level Access approach | Generic AI assistant approach | Luqen v3.0.0 approach |
|---------|--------------------------------------|-------------------------------|------------------------|
| AI access model | Proprietary API, no standard protocol | REST-only, no tool exposure | MCP standard — any MCP client can drive Luqen |
| Agent context | Session-scoped, no memory | No memory | Per-user persistent history, org-aware context injection |
| Voice input | None in current products | Sometimes | Web Speech API for MVP |
| RBAC on AI tools | Separate AI permission layer | Usually none | Mirrors existing Luqen RBAC exactly |
| Audit trail | Basic usage logs | Usually none | Per-invocation audit log with args + outcome |
| External client support | Vendor app only | Usually none | Claude Desktop, IDEs via Streamable HTTP |
| Destructive operations | No AI-driven changes | Ad-hoc | Explicit confirmation UI before every state change |

---

## Luqen-Specific Integration Notes

These are constraints and integration points that any implementation must respect, derived from the existing codebase and PROJECT.md.

### MCP Server Placement
Each Luqen service gets its own MCP route prefix (e.g., `/mcp` on each service's existing Fastify instance) using a Fastify plugin. The `haroldadmin/fastify-mcp` or `flaviodelgrosso/fastify-mcp-server` plugins both target this pattern. No new ports, no new processes.

### Auth Token Flow for External Clients
External MCP clients (Claude Desktop) will use the Luqen OAuth2 issuer (already running) via standard client credentials. The MCP endpoint validates the RS256 JWT the same way every other Luqen endpoint does. The MCP spec's requirement for OAuth 2.1 resource server behavior is already satisfied by Luqen's existing middleware.

### Agent Conversation Storage
New tables needed in dashboard SQLite:
- `agent_conversations` — one row per turn: `id, user_id, org_id, role (user|assistant), content, tool_calls_json, tokens_used, created_at`
- `agent_audit_log` — one row per tool invocation: `id, user_id, org_id, tool_name, args_summary, outcome, latency_ms, created_at`

Both tables follow the existing SQLite migration pattern (next migration after 045).

### Agent System Prompt Scoping
The agent's system prompt must hard-code the org constraint — it is not user-editable. Pattern from the existing prompt fence system (v2.10.0 `<!-- LOCKED:name -->` markers): the org-scoping instruction is a locked section. Only the agent's "personality" name is configurable.

### LLM Routing
The agent does not call LLM providers directly. It calls the existing LLM service capability engine (`POST /api/v1/...` on port 4200) using the dashboard's existing per-org OAuth2 client. This preserves provider fallback, retry, and per-org model overrides without any duplication.

### Speech Input Constraints
Web Speech API requires HTTPS (already satisfied by production deployment) and user gesture to start (microphone button click). The API sends audio to Google servers in Chrome — this is a privacy consideration to document for users. Firefox has no SpeechRecognition support; always provide text input as fallback. Never auto-play TTS output (WCAG 1.4.2 violation).

---

## Sources

- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — canonical tool/resource/prompt primitives (HIGH confidence)
- [MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — Streamable HTTP, Server Cards, Tasks (HIGH confidence)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) — OAuth 2.1 resource server requirements (HIGH confidence)
- [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — official TS SDK with Streamable HTTP transport (HIGH confidence)
- [haroldadmin/fastify-mcp](https://github.com/haroldadmin/fastify-mcp) — Fastify plugin for MCP (Streamable HTTP + legacy SSE) (MEDIUM confidence — verify maintenance status)
- [flaviodelgrosso/fastify-mcp-server](https://github.com/flaviodelgrosso/fastify-mcp-server) — alternative Fastify MCP plugin (MEDIUM confidence)
- [Why MCP Deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) — SSE deprecation rationale, timeline (HIGH confidence)
- [MCP Audit Logging — Tetrate](https://tetrate.io/learn/ai/mcp/mcp-audit-logging) — per-invocation logging patterns (MEDIUM confidence)
- [Securing MCP Servers — InfraCloud](https://www.infracloud.io/blogs/securing-mcp-servers/) — RBAC, scoped tokens, confirmation patterns (MEDIUM confidence)
- [Web Speech API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — browser support, HTTPS requirement, privacy notes (HIGH confidence)
- [Agent Memory — Redis](https://redis.io/blog/ai-agent-memory-stateful-systems/) — four memory types, conversation persistence architecture (MEDIUM confidence)
- [Context Window Management — Maxim](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — compaction strategies, cost curves (MEDIUM confidence)
- [MCP Security Risks — WorkOS](https://workos.com/blog/mcp-security-risks-best-practices) — prompt injection, tool scoping, human-in-the-loop (MEDIUM confidence)
- [Claude Desktop MCP Setup](https://natoma.ai/blog/how-to-enabling-mcp-in-claude-desktop) — external client connection model (MEDIUM confidence)
- [Agentic Accessibility — Siteimprove](https://www.siteimprove.com/blog/agentic-accessibility/) — competitor approach to AI agents in accessibility tools (MEDIUM confidence)

---

*Feature research for: MCP Servers & Dashboard Agent Companion (v3.0.0)*
*Researched: 2026-04-16*
