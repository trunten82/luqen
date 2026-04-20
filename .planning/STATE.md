---
gsd_state_version: 1.0
milestone: v3.0.0
milestone_name: MCP Servers & Agent Companion
status: executing
stopped_at: Completed 32-04-PLAN.md
last_updated: "2026-04-20T09:00:35.251Z"
last_activity: 2026-04-20
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 32
  completed_plans: 29
  percent: 91
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control through the dashboard, not config files.
**Current focus:** Phase 32 — agent-service-chat-ui

## Current Position

```
[Phase 28] [Phase 29] [Phase 30] [Phase 30.1] [Phase 31.1] [Phase 31.2] [Phase 32] [Phase 33]
                                    ✓            ✓            ✓            ^
                                                                            |
                                                                          Next
```

Phase: 32 (agent-service-chat-ui) — EXECUTING
Plan: 5 of 8
Plans: 5 of 5
Status: Ready to execute
Last activity: 2026-04-20

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 6 |
| Requirements mapped | 20/20 |
| Coverage | 100% |
| Plans complete | 0/? |
| Phase 28-mcp-foundation P01 | 7min | 2 tasks | 11 files |
| Phase 29 P03 | 3min | 2 tasks | 2 files |
| Phase 31.1 P01 | 14m | 3 tasks | 21 files |
| Phase 31.1 P02 | 1115 | 3 tasks | 19 files |
| Phase 31.1 P03 | 200 | 3 tasks | 23 files |
| Phase 31.2 P01 | 22m | 2 tasks | 6 files |
| Phase 31.2 P02 | ~32m | 4 tasks | 10 files |
| Phase 31.2 P03 | 23m | 3 tasks | 8 files |
| Phase 31.2 P04 | ~50m | 2 tasks | 7 files | partial worktree + inline completion |
| Phase 31.2 P05 | 15m | 3 tasks | 9 files |
| Phase 32 P01 | 10min | 3 tasks | 13 files |
| Phase 32-agent-service-chat-ui P02 | ~12m | 4 tasks | 11 files |
| Phase 32-agent-service-chat-ui P03 | 11m | 2 tasks | 6 files |
| Phase 32-agent-service-chat-ui P04 | 28m | 4 tasks | 16 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Carried from v2.12.0:

- Scoring lives in dashboard, not `@luqen/branding` — single pure calculator
- Composite weights locked at `{color: 0.50, typography: 0.30, components: 0.20}`
- Dual-mode fallback policy: service outage → degraded scan, NEVER silent cross-route
- `BrandingOrchestrator` reads `orgs.branding_mode` per-request, no caching
- Zero branded contrast violations = 100% color score (post-deploy hotfix)

v3.0.0 architecture decisions (from research):

- MCP embedded as Fastify plugin in each service (`fastify-mcp@^2.1.0`) — not a standalone port
- Streamable HTTP transport only — SSE-only deprecated June 2025
- AgentService always calls service `/mcp` endpoints over HTTP — never direct module imports
- All LLM calls route through existing capability engine at `llm:4200` — no separate provider client
- Conversation history: SQLite in `dashboard.db` — no Redis, no new infrastructure
- Rolling window: last 20 turns in LLM context; full history stored in DB
- `pending_confirmation` status in DB — confirmation state survives page refresh
- Agent UI: HTMX POST for message submission + plain JS `EventSource` for streaming — never `hx-sse`
- Speech input: Web Speech API with feature detection; text fallback for Firefox
- RBAC tool list built from `resolveEffectivePermissions(userId, orgId)` before LLM sees any tools
- [Phase 28-mcp-foundation]: Inline scope hierarchy in http-plugin.ts rather than importing from @luqen/compliance — keeps @luqen/core leaf-of-graph and dep-free
- [Phase 28-mcp-foundation]: AsyncLocalStorage<ToolContext> — module-scope ALS lets setRequestHandler (registered once) read per-request context without SDK argument plumbing
- [Phase 28-mcp-foundation]: tools/list filter via mcpServer.server.setRequestHandler(ListToolsRequestSchema, ...) — single committed mechanism registered ONCE at plugin construction; overwrites SDK default in protocol's _requestHandlers map
- [Phase 28-mcp-foundation]: McpServer._registeredTools private-field read preserves per-tool description/inputSchema in filtered tools/list response; fallback registeredTools option documented but not needed at SDK 1.27.1
- [Phase 29]: Phase 29 rescope (D-14/D-15): MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 reassigned to Phase 30; MCPT-02 split-annotated; Phase 30 Depends-on upgraded to Phase 28+29; D-12 chat-message-template prompt shape locked into Phase 30 success criterion
- [Phase 31.1]: Tests live under packages/dashboard/tests/repositories/ to match vitest.config.ts (plan's test/ path was not scanned)
- [Phase 31.1]: Encrypted-at-rest private keys: OauthSigningKeyRepository stores ciphertext only; Plan 02 token-signer encrypts/decrypts via plugins/crypto
- [Phase 31.1]: CSRF validated at preHandler (not onRequest) so @fastify/csrf-protection reads req.body._csrf after the form body is parsed
- [Phase 31.1]: Constant-time compare (timingSafeEqual) added to verifyS256Challenge to remove a stored-challenge timing side channel
- [Phase 31.1]: pa11y accessibility evidence captured against a standalone Handlebars-rendered HTML fixture (scripts/render-consent-for-pa11y.mts) — zero WCAG 2.1 AA errors on both consent variants
- [Phase 31.1]: D-27 chose deprecation path (a): DASHBOARD_JWT_PUBLIC_KEY still works through one-shot console.warn; full removal deferred to Plan 04+
- [Phase 31.1]: MCP auth moved to a scoped route preHandler in each service (dashboard/compliance/branding/llm); /api/v1/mcp added to PUBLIC_PATHS of the global middleware so the scoped handler is the sole auth gate and RFC 8707 aud is enforced before tool dispatch
- [Phase 31.1]: D-34 NOT extracted: services' createJwksTokenVerifier kept as three byte-identical factories rather than a shared @luqen/core abstraction — per-package TokenPayload narrowing would force a generic parameter that erases more than it unifies
- [Phase 32]: [32-01]: @anthropic-ai/sdk pinned at EXACT 0.90.0 (no caret) — supply-chain posture per threat_model T-32-01-06; caret ranges disallowed for runtime SDKs
- [Phase 32]: [32-01]: LLMProviderAdapter.completeStream is OPTIONAL — the 4 existing capabilities (extract-requirements, generate-fix, analyse-report, discover-branding) stay byte-compatible; only agent-conversation (Plan 02) asserts presence
- [Phase 32]: [32-01]: Anthropic adapter uses client.messages.stream({...}).finalMessage() SDK helper — never rolls its own input_json_delta.partial_json parser (AI-SPEC §3 Pitfall 2)
- [Phase 32]: [32-01]: Ollama tool-call ids minted client-side as toolu_ollama_<uuid> — Ollama's NDJSON response shape omits ids; audit/consumer layers need stable keys for tool_result correlation
- [Phase 32]: [32-01]: D-11 ordering invariant pinned at adapter level via Anthropic Test 14 — every token frame index < the single tool_calls frame index; parity-baseline.json (3 fixtures) is the seed for AI-SPEC §5.4 CI parity gate
- [Phase 32-agent-service-chat-ui]: PromptId union (CapabilityName + 'agent-system') keeps prompt-route surface separate from capability-assignment surfaces
- [Phase 32-agent-service-chat-ui]: D-23 committed-provider semantics: first iterator step is the stream-open gate; after it yields, forward frames verbatim and terminate on error without retry
- [Phase 32-agent-service-chat-ui]: Bootstrap seed four-tier preference (Haiku -> gpt-4o-mini -> supportsTools -> first) ensures Ollama-only on-prem installs bootstrap without paid API keys
- [Phase 32-agent-service-chat-ui]: T-32-02-03 sanitiser placed at interpolation call site as defence-in-depth; Plan 08 write-time validator is the primary defense
- [Phase 32-agent-service-chat-ui]: [32-03]: Migration id bumped 050 -> 055 (050-054 occupied by Phase 31.1/31.2 OAuth + mcp.use backfill); column name agent_display_name unchanged
- [Phase 32-agent-service-chat-ui]: [32-03]: Repo layer does NOT enforce Zod length/format — Plan 08's route handler owns write-site validation; repo's sole threat mitigation is parameterised UPDATE for T-32-03-01 SQL-injection
- [Phase 32-agent-service-chat-ui]: [32-04]: AgentService re-resolves permissions at HEAD of every loop iter — never cached (D-07 + Pitfall 6)
- [Phase 32-agent-service-chat-ui]: [32-04]: Per-dispatch JWT mint via existing DashboardSigner (no new secret material); TTL 300s; client_id=__agent-internal__ for the 31.2 D-20 revoke-check carve-out
- [Phase 32-agent-service-chat-ui]: [32-04]: Rate-limit 429 JSON rewrite via onSend hook — NOT the plugin's built-in error-response override (feedback_rate_limiter.md)
- [Phase 32-agent-service-chat-ui]: [32-04]: Origin check on /agent/stream only rejects mismatched Origin; missing Origin passes (same-origin EventSource does not always send Origin)

### Architecture Notes

New packages required:

- `@modelcontextprotocol/sdk@^1.29.0` — MCP server + client runtime
- `fastify-mcp@^2.1.0` — Streamable HTTP transport + session management

New DB tables (dashboard.db):

- Migration 046: `agent_conversations` + `agent_messages` (rolling window, `pending_confirmation` status)
- Migration 047: `agent_audit_log` (user, org, tool, args, outcome, latency)

Existing MCP servers to upgrade (HTTP transport):

- `packages/compliance/src/mcp/server.ts` — stdio → add Streamable HTTP
- `packages/core/src/mcp.ts` — stdio → add Streamable HTTP
- `packages/monitor/src/mcp/server.ts` — stdio → add Streamable HTTP

New MCP servers:

- Branding service — `POST /api/v1/mcp`
- LLM service — `POST /api/v1/mcp`
- Dashboard — `POST /mcp` (external client access)

### Roadmap Evolution

- Phase 30.1 inserted after Phase 30 on 2026-04-18: Fix scope-filter bypass for OAuth client-credentials tokens — permission fallback on unknown sub currently overrides scope path, letting read-scope clients invoke destructive tools (URGENT — blocks Phase 30 SC#4 sign-off)
- Phase 31.1 inserted after Phase 31 on 2026-04-19: MCP Authorization Spec Upgrade (OAuth 2.1 + PKCE + refresh + DCR + `.well-known` metadata). Scope decision came out of `/gsd-discuss-phase 32` — MCPAUTH-01/02/03 relocated from Phase 32 to 31.1 so Phase 32 stays focused on agent runtime + UI. Phase 32 depends on 31.1 for the external-client auth story; Phase 32's internal dashboard-to-MCP path uses cookie-session + server-minted JWT and is independent.
- Phase 31.1 SHIPPED 2026-04-19: 4 plans, 26 plan commits + 8 inline smoke-gap fixes, 2869/2869 dashboard tests passing, E2E Claude Desktop smoke 10/10 pass on lxc-luqen. VERIFICATION PASSED (5/5 SC + 3/3 REQ-IDs).
- Phase 31.2 inserted after Phase 31.1 on 2026-04-19: MCP Access Control Refinement. Consolidates three gaps surfaced during 31.1 smoke — G1 org-scoped DCR client revoke (not `admin.system`-only), G9 service-side `WWW-Authenticate` header parity, G10 new `mcp.use` per-org RBAC permission with tool visibility driven by user's real RBAC rather than broad OAuth scope bundles. User's explicit ask during smoke; routed to a dedicated phase to keep the refinement cohesive instead of patches.

### Pending Todos

None.

### Blockers/Concerns

- `fastify-mcp` maintenance status flagged MEDIUM confidence — validate plugin is actively maintained during Phase 28 planning; fallback is `NodeStreamableHTTPServerTransport` from SDK directly
- `agent-conversation` capability registration in LLM engine — inspect `packages/llm/src/capabilities/` during Phase 32 planning
- Token counting approach — confirm character-count approximation vs `tiktoken` during Phase 33 planning
- Web Speech API EU data residency — confirm whether org users have constraints before Phase 32; if so, defer speech to post-MVP

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-lg8 | Strip jsonReport from dashboard_list_reports MCP tool response | 2026-04-18 | 910a3de | [260418-lg8-strip-jsonreport-from-dashboard-list-rep](./quick/260418-lg8-strip-jsonreport-from-dashboard-list-rep/) |
| 260418-mqc | Fix white-on-white text in locked prompt segments on /admin/llm?tab=prompts | 2026-04-18 | 12f3549 | [260418-mqc-fix-white-on-white-text-in-locked-prompt](./quick/260418-mqc-fix-white-on-white-text-in-locked-prompt/) |

### Known Gotchas (carried from v2.12.0)

- **HTMX OOB inside `<tr>`**: wrap in `<template>` tags
- **HTMX 2.0 `hx-select` inheritance**: use plain JS `EventSource` for streaming, never `hx-sse`
- **`@fastify/rate-limit` 429 bypass**: add `onSend` hook on agent SSE path
- **Small scans score lower**: maxPages=3 may score 0 when full-site scores 2+
- **Branding service port**: lxc-luqen runs on port 4100 (not 4300)
- **`issue.context` can be null**: all scorers must null-guard

## Session Continuity

Last session: 2026-04-20T09:00:35.246Z
Stopped at: Completed 32-04-PLAN.md
Resume file: None
Next action: `/gsd:plan-phase 28`
