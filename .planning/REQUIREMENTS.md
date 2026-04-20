# Requirements: Luqen v3.0.0

**Defined:** 2026-04-16
**Core Value:** AI-powered accessibility compliance that adapts to each organization's jurisdiction, regulation, and brand context — with admins in control of the whole stack through the dashboard, not config files.

## v3.0.0 Requirements

Requirements for the MCP Servers & Agent Companion milestone. Each maps to roadmap phases.

### MCP Infrastructure

- [x] **MCPI-01**: User can connect to any Luqen service via Streamable HTTP MCP transport
- [x] **MCPI-02**: MCP endpoints validate OAuth2 RS256 JWT on every request
- [x] **MCPI-03**: MCP tool manifest is dynamically filtered by caller's RBAC permissions
- [x] **MCPI-04**: All MCP tool calls are pre-scoped to the caller's org from JWT claims
- [ ] **MCPI-05**: MCP Resources expose scan reports and brand scores as read-only context
- [ ] **MCPI-06**: MCP Prompts expose predefined workflow shortcuts (scan, report, fix)

### MCP Service Tools

- [ ] **MCPT-01**: User can scan sites, list reports, and check issues via compliance MCP tools
- [ ] **MCPT-02**: User can list guidelines, get brand scores, and run discover-branding via branding MCP tools
- [ ] **MCPT-03**: User can generate fixes and analyse reports via LLM MCP tools
- [ ] **MCPT-04**: User can manage users, orgs, and service connections via dashboard MCP tools
- [ ] **MCPT-05**: External MCP clients (Claude Desktop, IDEs) can connect and use tools with valid credentials

### Agent Companion

- [ ] **AGENT-01**: User can interact with the agent via a text chat side panel in the dashboard
- [x] **AGENT-02**: Agent routes all LLM calls through the existing capability engine (provider fallback, per-org overrides)
- [ ] **AGENT-03**: User can use speech input via Web Speech API with text fallback for unsupported browsers
- [ ] **AGENT-04**: Agent references recent scans, active guidelines, and regulations in responses
- [ ] **AGENT-05**: Agent manages token budget with sliding window and summary compaction for long conversations

### Agent Persistence

- [ ] **APER-01**: User's conversation history persists across sessions in SQLite
- [ ] **APER-02**: State-changing tool calls require explicit user confirmation via native dialog
- [ ] **APER-03**: Every tool invocation is logged with user, org, tool, args, outcome, and latency
- [ ] **APER-04**: Admin can browse and filter agent audit logs in the dashboard

### MCP Authorization Spec Compliance (added 2026-04-19)

- [x] **MCPAUTH-01**: Each service publishes `.well-known/oauth-protected-resource` and `.well-known/oauth-authorization-server` metadata for MCP clients to discover authorization configuration automatically (per MCP spec 2025-06-18)
- [x] **MCPAUTH-02**: External MCP clients authenticate via OAuth 2.1 Authorization Code + PKCE with refresh tokens, and the resulting access tokens carry user identity (not service-client identity) so per-user RBAC via `resolveEffectivePermissions` applies
- [x] **MCPAUTH-03**: External MCP clients can self-register via Dynamic Client Registration (RFC 7591) at a Luqen DCR endpoint, subject to admin policy (open vs allowlist — decided during `/gsd-discuss-phase 31.1`)
- [ ] **MCPAUTH-04**: Opening an MCP connection requires the `mcp.use` RBAC permission in the user's active org (or `admin.system` globally). Tool visibility is RBAC ∩ scope defense-in-depth; admin.* OAuth scopes retired from `scopes_supported`; pre-existing tokens continue to work via silent admin.*-scope ignore (migration back-fills `mcp.use` onto all existing users per-org)
- [ ] **MCPAUTH-05**: Org admins (`admin.org`) can view and revoke DCR-registered OAuth clients belonging to users within their own org via `/admin/clients`; cross-org operations return 403 + audit entry; `registered_by_user_id` is populated at first consent (RFC 7591 DCR pre-auth intent preserved)

## Future Requirements

Deferred to v3.1+. Tracked but not in current roadmap.

### MCP Ecosystem

- **MCPE-01**: Server Card at `.well-known/mcp.json` for external registry discovery
- **MCPE-02**: External client auth via API key or device code flow (beyond OAuth2 browser sessions)
- **MCPE-03**: A2A peer registration for agent-to-agent workflows

### Agent Enhancements

- **AGEN-01**: Manual "read aloud" button using browser SpeechSynthesis (opt-in TTS)
- **AGEN-02**: Agent proactively suggests actions based on org activity patterns

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time streaming LLM responses | Batch responses sufficient; adds SSE/WebSocket complexity |
| Per-org custom agent system prompts | Prompt injection surface; agent personality name configurable only |
| Server-side Whisper for speech transcription | Privacy concerns + infrastructure cost; Web Speech API for MVP |
| TTS auto-play on agent responses | WCAG 1.4.2 violation (unexpected audio); manual "read aloud" button deferred to v3.1 |
| Cross-org queries through agent | Violates org isolation guarantee; global admin uses dashboard analytics |
| MCP as standalone service (new port) | Thin protocol adapter — embed as Fastify plugin in each existing service |
| Full conversation history in LLM context | Quadratic token cost; sliding window + summary compaction instead |
| A2A peer registration | v3.1 consideration after MCP tools are stable |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MCPI-01 | Phase 28 | Complete |
| MCPI-02 | Phase 28 | Complete |
| MCPI-03 | Phase 28 | Complete |
| MCPI-04 | Phase 28 | Complete |
| MCPI-05 | Phase 30 | Pending |
| MCPI-06 | Phase 30 | Pending |
| MCPT-01 | Phase 30 | Pending |
| MCPT-02 | Phase 29 (guidelines + match + discover), Phase 30 (brand score retrieval) | Pending |
| MCPT-03 | Phase 29 | Pending |
| MCPT-04 | Phase 30 | Pending |
| MCPT-05 | Phase 30 | Pending |
| AGENT-01 | Phase 32 | Pending |
| AGENT-02 | Phase 32 | Complete |
| AGENT-03 | Phase 32 | Pending |
| AGENT-04 | Phase 33 | Pending |
| AGENT-05 | Phase 33 | Pending |
| APER-01 | Phase 31 | Pending |
| APER-02 | Phase 32 | Pending |
| APER-03 | Phase 31 | Pending |
| APER-04 | Phase 33 | Pending |
| MCPAUTH-01 | Phase 31.1 | Complete |
| MCPAUTH-02 | Phase 31.1 | Complete |
| MCPAUTH-03 | Phase 31.1 | Complete |
| MCPAUTH-04 | Phase 31.2 | Pending |
| MCPAUTH-05 | Phase 31.2 | Pending |

**Coverage:**
- v3.0.0 requirements: 25 total (20 original + 3 MCPAUTH-01/02/03 + 2 MCPAUTH-04/05 added 2026-04-19)
- Mapped to phases: 25
- Unmapped: 0 ✓

## Phase 29 Scope Rescope

Per `.planning/phases/29-service-mcp-tools/29-CONTEXT.md` D-14, the following
requirements moved from Phase 29 to Phase 30 because their natural data lives
in `packages/dashboard`, not in compliance/branding/llm:
- **MCPT-01** (scan/report/issue tools) — dashboard owns ScanRepository + scan orchestrator
- **MCPT-02** partial — "retrieve brand scores" half; dashboard owns BrandScoreRepository
- **MCPI-05** (MCP Resources) — resources expose dashboard-owned scan reports + brand scores
- **MCPI-06** (MCP Prompts) — prompts orchestrate cross-service workflows

Phase 29 delivered: MCPT-02 guidelines + match + discover-branding (via LLM MCP per D-08), MCPT-03 complete (4 LLM tools).

---
*Requirements defined: 2026-04-16*
*Last updated: 2026-04-17 — Phase 29 rescope (D-14): MCPT-01, MCPT-02 brand-score half, MCPI-05, MCPI-06 moved to Phase 30*
