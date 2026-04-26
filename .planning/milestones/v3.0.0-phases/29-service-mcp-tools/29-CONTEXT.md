# Phase 29: Service MCP Tools - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate the empty `luqen-branding` and `luqen-llm` MCP server stubs (left in Phase 28) with their first real tool catalogues, wired through the shared `createMcpHttpPlugin()` factory. Compliance MCP stays at the 11 reference-data tools from Phase 28 — no additions. MCP Resources (MCPI-05) and MCP Prompts (MCPI-06) are deferred to Phase 30 because their natural content (scan reports, brand scores, cross-service workflows) lives on the dashboard. The result of Phase 29 is: three services (compliance, branding, LLM) each serve a non-empty, RBAC-filtered, org-scoped tool catalogue at `POST /api/v1/mcp`.

</domain>

<decisions>
## Implementation Decisions

### Compliance MCP surface
- **D-01:** Compliance MCP tool catalogue is unchanged from Phase 28. The 11 reference-data tools (all GLOBAL, classified with `// orgId: N/A (global reference data)`) remain the complete compliance MCP surface. No new tools registered in Phase 29.
- **D-02:** Scan/report/issue tools — named in MCPT-01 success criterion — are rescoped to Phase 30 (Dashboard MCP) because scans, reports, and issues live in `packages/dashboard` (ScanRepository, scan-service, scanner/orchestrator), not in `packages/compliance`. Requirements traceability must update: MCPT-01 → Phase 30.

### Branding MCP surface
- **D-03:** `createBrandingMcpServer` is upgraded from the Phase 28 empty stub to register 4 tools, all ORG-SCOPED, all `requiredPermission: 'branding.view'`, all non-destructive, all reading `context.orgId` from the ToolContext (never from args — D-05/D-06 from Phase 28):
  1. `branding_list_guidelines` — wraps `GET /api/v1/guidelines`
  2. `branding_get_guideline` — wraps `GET /api/v1/guidelines/:id`
  3. `branding_list_sites` — wraps `GET /api/v1/guidelines/:id/sites`
  4. `branding_match` — wraps `POST /api/v1/match` (brand match against supplied issues)
- **D-04:** `get_brand_score` is NOT on branding MCP in Phase 29. `brand_scores` rows live in `dashboard.db` (BrandScoreRepository), not in the branding service. The tool moves to Phase 30 (Dashboard MCP) alongside scan/report tools. Requirements traceability: MCPT-02's "retrieve brand scores" → Phase 30.
- **D-05:** `discover_branding` does NOT register on branding MCP. Branding service does not host the discovery capability — the LLM service does. See D-08.

### LLM MCP surface
- **D-06:** `createLlmMcpServer` is upgraded to register 4 tools, all GLOBAL (no org-scoped DB reads — inputs are supplied by caller, outputs are derived from provider response), all `requiredPermission: 'llm.view'`, all non-destructive. Every handler carries the `// orgId: N/A (global — inputs supplied by caller)` comment (mirror Phase 28's classification discipline — no TODOs):
  1. `llm_generate_fix` — wraps `POST /api/v1/generate-fix`
  2. `llm_analyse_report` — wraps `POST /api/v1/analyse-report`
  3. `llm_discover_branding` — wraps `POST /api/v1/discover-branding`
  4. `llm_extract_requirements` — wraps `POST /api/v1/extract-requirements` (Phase 2 capability — included so full LLM capability surface is reachable via MCP, not just the 3 named in MCPT-03)
- **D-07:** LLM MCP tool inputs mirror the existing REST body 1:1. Callers (LLMs using the MCP client) supply the full payload — raw pa11y issue context for `llm_generate_fix`, raw scan findings for `llm_analyse_report`, URL+HTML for `llm_discover_branding`. No structured-ref shape (e.g. `{ scanId, issueId }`) — that would require LLM service to read from `dashboard.db` and reintroduces the cross-service boundary problem we pushed to Phase 30.
- **D-08:** `llm_discover_branding` lives on LLM MCP (not branding MCP) because the LLM service owns the discovery capability. MCPT-02 wording adjusts in traceability: "run discover-branding" reads as "via LLM MCP tool" instead of "via branding MCP tool" — the requirement outcome is satisfied either way.
- **D-09:** When the underlying LLM provider is unavailable, MCP tools return exactly the response the REST endpoint returns today. `llm_generate_fix` falls back to the 50 hardcoded fix patterns (preserves user value); `llm_analyse_report` returns its degraded error structure. MCP tools are a protocol adapter over the existing capability endpoints — no new fallback logic.

### MCP Resources (MCPI-05) — DEFERRED
- **D-10:** MCP Resources ship on Phase 30 (Dashboard MCP) alongside scan reports and brand scores. Phase 29 registers ZERO resources on any service. MCPI-05 moves to Phase 30 in traceability.

### MCP Prompts (MCPI-06) — DEFERRED
- **D-11:** MCP Prompts (`/scan`, `/report`, `/fix`) ship on Phase 30 (Dashboard MCP) because every named workflow spans services — `/scan` triggers a dashboard scan, `/report` summarises a dashboard scan, `/fix` operates on a dashboard issue. Prompts belong where the workflow orchestrator lives.
- **D-12:** When Prompts are implemented (Phase 30), the shape is **chat-message templates** — a prompt returns a templated conversation (system+user messages with placeholders) that the MCP client feeds to its own LLM. The LLM then chooses which tools to invoke. NOT tool-call pre-fills (which would couple prompts to specific tools and break when tools live on different service MCPs). This decision is locked here so Phase 30 inherits it.

### Tool input schema invariant (carry-forward from Phase 28)
- **D-13:** No tool registered in Phase 29 accepts `orgId` in its zod inputSchema (D-05 from Phase 28). Enforced by the same runtime iteration test used in 28-02: after `createXxxMcpServer()` returns, iterate registered tools and assert each `inputSchema._def.shape` has no `orgId` key. ORG-SCOPED tools (all 4 branding tools) read `getCurrentToolContext().orgId` inside the handler and pass it to branding DB queries.

### Requirements rescope required
- **D-14:** `REQUIREMENTS.md` traceability needs updating when Phase 29 plans are written:
  - `MCPT-01` (scan/report/issue tools) → move from Phase 29 to Phase 30
  - `MCPT-02` "retrieve brand scores" half → Phase 30 (list_guidelines + discover_branding stay Phase 29)
  - `MCPI-05` (Resources) → move from Phase 29 to Phase 30
  - `MCPI-06` (Prompts) → move from Phase 29 to Phase 30
  - `MCPT-03` (LLM fix + analyse) stays Phase 29
- **D-15:** Phase 29's delivered requirements after rescope: MCPT-02 (partial: guidelines + discover), MCPT-03 (complete). Both success criteria #2 (list guidelines + invoke discover-branding) and #3 (generate fixes + analyse reports) from ROADMAP.md are satisfied.

### Claude's Discretion
- Whether `branding_match` takes the raw `BrandMatchRequest` shape from `packages/branding/src/types.ts` directly or wraps it in a simpler MCP-friendly envelope — planner decides based on how painful the existing shape is for an LLM to construct.
- Exact internal directory layout (`packages/branding/src/mcp/tools/` vs. inline in `server.ts`) — mirror whatever pattern Phase 28 settled on for compliance after execution.
- Whether to split `llm_*` tools across multiple files or keep them all in `packages/llm/src/mcp/server.ts` — consistency with existing LLM layout wins.
- Test strategy for the 4 LLM tools: share a provider-mock fixture vs. per-tool fixtures — planner/TDD guide decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 foundation (REQUIRED — defines the plugin, patterns, and invariants Phase 29 extends)
- `.planning/phases/28-mcp-foundation/28-CONTEXT.md` — D-01 through D-08 (endpoint routing, RBAC, org isolation, factory)
- `.planning/phases/28-mcp-foundation/28-PATTERNS.md` — Tool factory signature, response envelope, zod schema pattern, request-scoped context extraction
- `.planning/phases/28-mcp-foundation/28-01-PLAN.md` — Exports from `@luqen/core/mcp`: `createMcpHttpPlugin`, `getCurrentToolContext`, `ToolContext`, `ToolMetadata`, `filterToolsByPermissions`
- `.planning/phases/28-mcp-foundation/28-02-PLAN.md` — Classification discipline: every handler GLOBAL or ORG-SCOPED with explicit comment, iteration-based orgId-absent test, no TODO deferrals

### Existing MCP stubs to populate (Phase 29 targets)
- `packages/branding/src/mcp/server.ts` — Empty `createBrandingMcpServer` stub (Phase 28). 4 tools register here.
- `packages/branding/src/api/routes/mcp.ts` — `registerMcpRoutes` wiring. Unchanged in Phase 29 — adding tools to the factory is enough; the plugin picks them up.
- `packages/llm/src/mcp/server.ts` — Empty `createLlmMcpServer` stub. 4 tools register here.
- `packages/llm/src/api/routes/mcp.ts` — `registerMcpRoutes` wiring. Unchanged in Phase 29.

### Branding service endpoints to mirror as tools (D-03)
- `packages/branding/src/api/server.ts` §259 — `GET /api/v1/guidelines` handler → `branding_list_guidelines`
- `packages/branding/src/api/server.ts` §265 — `GET /api/v1/guidelines/:id` handler → `branding_get_guideline`
- `packages/branding/src/api/server.ts` §423 — `GET /api/v1/guidelines/:id/sites` handler → `branding_list_sites`
- `packages/branding/src/api/server.ts` §544 — `POST /api/v1/match` handler → `branding_match`
- `packages/branding/src/types.ts` — `BrandGuideline`, `BrandMatchRequest`, `BrandMatchResponse` shapes
- `packages/branding/src/store.ts` — `BrandingStore` interface (guidelines repository)

### LLM service endpoints to mirror as tools (D-06)
- `packages/llm/src/api/routes/capabilities-exec.ts` — all four capability route handlers:
  - `POST /api/v1/generate-fix` → `llm_generate_fix`
  - `POST /api/v1/analyse-report` → `llm_analyse_report`
  - `POST /api/v1/discover-branding` → `llm_discover_branding`
  - `POST /api/v1/extract-requirements` → `llm_extract_requirements`
- `packages/llm/src/capabilities/generate-fix.ts` — fallback-to-hardcoded-patterns logic (D-09 preservation anchor)
- `packages/llm/src/capabilities/analyse-report.ts` — error-envelope degraded shape
- `packages/llm/src/capabilities/discover-branding.ts` — provider invocation + response normalisation
- `packages/llm/src/capabilities/extract-requirements.ts` — Phase 2 capability implementation

### Auth + RBAC (patterns, do not modify)
- `packages/dashboard/src/permissions.ts` — `branding.view`, `llm.view` permission IDs (ALL_PERMISSION_IDS exports the canonical list)
- `packages/compliance/src/auth/middleware.ts` — JWT → orgId extraction pattern (already global preHandler)
- `packages/compliance/src/auth/scopes.ts` — `scopeCoversEndpoint`, Scope type

### Research (background)
- `.planning/research/STACK.md` — MCP SDK version (1.29.0), fastify-mcp, tool registration APIs
- `.planning/research/ARCHITECTURE.md` — Transport layer + tool dispatch data flow
- `.planning/research/PITFALLS.md` — #11 stdio-safety (no `console.log`), #10 destructive marker rationale

### Requirements (rescope target — D-14)
- `.planning/REQUIREMENTS.md` — MCPT-01 through MCPT-05, MCPI-05, MCPI-06 definitions + traceability table (update during planning)
- `.planning/ROADMAP.md` §Phase 29, §Phase 30 — Success criteria wording that will shift after rescope

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createMcpHttpPlugin()` from `@luqen/core/mcp` — wraps any McpServer with Streamable HTTP + auth + RBAC filter. Already wired into branding + LLM in Phase 28. Phase 29 only needs to register tools; no new plugin work.
- `getCurrentToolContext()` from `@luqen/core/mcp` — returns `ToolContext { orgId, userId, scopes, permissions, authType }` inside tool handlers. ALS-backed (Phase 28 D-01 plan decision). Drop-in for every ORG-SCOPED tool.
- `ToolMetadata` type with `{ name, requiredPermission?, destructive? }` — already defined. Phase 29 populates `BRANDING_TOOL_METADATA` (currently `[]`) and `LLM_TOOL_METADATA` (currently `[]`).
- `BrandingStore` + existing repository methods (`listGuidelines(orgId)`, `getGuideline(id, orgId)`, `listSitesForGuideline(id, orgId)`, `match(request, orgId)`) — tools become thin adapters. No new repo methods needed.
- LLM capability executors (`executeGenerateFix`, `executeAnalyseReport`, `executeDiscoverBranding`, `executeExtractRequirements`) — tool handlers call these directly, same as REST handlers. Provider fallback already inside the executors.

### Established Patterns
- Tool registration: `server.registerTool(name, { description, inputSchema: z.object({...}).describe('...') }, handler)` — every field `.describe()`'d.
- Response envelope: `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`; errors add `isError: true` (compliance server.ts lines 147–157).
- Classification comments: `// orgId: N/A (global reference data)` for GLOBAL, `// orgId: required (org-scoped — see ctx.orgId below)` for ORG-SCOPED (Phase 28 discipline).
- Never add `orgId` to a zod inputSchema; always pull from ctx (D-05 Phase 28). Runtime-tested per handler.
- No `console.log` in `packages/*/src/mcp/*` (stdio safety, PITFALLS.md #11).

### Integration Points
- `packages/branding/src/mcp/server.ts` — only touched file for branding tool additions. `createBrandingMcpServer` adds `server.registerTool(...)` calls and populates `BRANDING_TOOL_METADATA`.
- `packages/llm/src/mcp/server.ts` — same pattern for LLM. Imports capability executors from `packages/llm/src/capabilities/*`.
- `packages/branding/tests/mcp/http.test.ts`, `packages/llm/tests/mcp/http.test.ts` — Phase 28 test files gain new assertions: tools/list returns the expected 4 tools per service; iteration test asserts no orgId in any inputSchema; permission filter test asserts `branding.view`/`llm.view` callers see the tools, others do not.

</code_context>

<specifics>
## Specific Ideas

- Tool naming follows the Phase 28 compliance convention: `<service>_<verb>_<noun>` lowercase snake_case (`compliance_list_jurisdictions` → `branding_list_guidelines`, `llm_generate_fix`). No camelCase; no dash-separated names.
- Tool descriptions should be written FOR the LLM, not for humans. Each tool description is a 1–2 sentence promise of what the tool does + one line of when to use it (e.g. "List all brand guidelines for the current org. Use when the user asks about brand setup or before calling `branding_match`.").
- `branding_match` is the only tool that touches matcher logic — worth an explicit "this does not persist anything — run `scan_site` from dashboard MCP to persist" note in the description so the LLM doesn't infer side effects.
- Keep handlers thin — delegate to existing store methods / capability executors. Phase 29 is a protocol-adapter phase, not a business-logic phase.

</specifics>

<deferred>
## Deferred Ideas

### Moved to Phase 30 (Dashboard MCP + External Clients)
- `dashboard_scan_site` / `dashboard_list_reports` / `dashboard_get_report` / `dashboard_query_issues` — MCPT-01 tools; data lives in `dashboard.db` so home is dashboard MCP (D-02)
- `dashboard_get_brand_score` / `dashboard_list_brand_scores` — MCPT-02 "retrieve brand scores" half (D-04)
- All MCP Resources (MCPI-05) — scan reports + brand scores exposed as `scan://report/{id}` / `brand://score/{siteUrl}` read-only blobs (D-10)
- MCP Prompts `/scan`, `/report`, `/fix` (MCPI-06) — chat-message templates (shape locked in D-12) orchestrating cross-service workflows (D-11)

### Reviewed Todos (not folded)
None — todo match returned empty.

### Future
- Structured-ref tool shape (`{ scanId, issueId }`) for `llm_generate_fix` — considered in D-07, rejected because it couples LLM service to dashboard.db. Phase 33 (agent intelligence) is a natural place to revisit with a higher-level agent-side tool that resolves refs client-side before calling `llm_generate_fix` with full payload.
- Per-tool audit logging — Phase 31 (Conversation Persistence) adds agent_audit_log; MCP tools will route through it once it exists.
- Alias tools (e.g. `branding_discover` on branding MCP delegating to LLM MCP) — rejected in Area 2 to minimise surface area; reconsider only if external MCP clients in Phase 30 prove discoverability is poor.

</deferred>

---

*Phase: 29-service-mcp-tools*
*Context gathered: 2026-04-17*
