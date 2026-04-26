# Phase 30: Dashboard MCP + External Clients - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate the empty `luqen-dashboard` MCP server stub (created in Phase 28) with its full tool/resource/prompt catalogue, and prove external MCP clients (Claude Desktop, IDE extensions) can connect.

Phase 30 delivers three MCP primitives on the dashboard:
1. **Tools** — dashboard-owned data (scans, reports, issues, brand scores) + admin operations (users, orgs, service-connections: read + safe writes; deletes deferred)
2. **Resources** — read-only URI-addressable projections: `scan://report/{id}` and `brand://score/{siteUrl}`
3. **Prompts** — chat-message templates (NOT tool-call pre-fills — shape locked in 29-CONTEXT.md D-12) for `/scan`, `/report`, `/fix`

Plus external-client connectivity verification via MCP Inspector automated smoke test + a manual Claude Desktop walkthrough + setup documentation.

Absorbed from Phase 29 per 29-CONTEXT D-14: MCPT-01 (scan/report/issue tools), MCPT-02 brand-score retrieval half, MCPI-05 (Resources), MCPI-06 (Prompts). MCPT-04 (admin tools) and MCPT-05 (external client proof) native to this phase.

</domain>

<decisions>
## Implementation Decisions

### Dashboard data tool catalogue (MCPT-01 + MCPT-02 brand-score half)

- **D-01:** Six dashboard data tools register on `createDashboardMcpServer`. All ORG-SCOPED (read `getCurrentToolContext().orgId` from JWT — D-05/D-06 Phase 28 invariant). None accept `orgId` in `inputSchema` (D-13 Phase 29). Required permissions per tool:
  1. `dashboard_scan_site` — `scans.create`, `destructive: true` (see D-03)
  2. `dashboard_list_reports` — `reports.view`
  3. `dashboard_get_report` — `reports.view`
  4. `dashboard_query_issues` — `reports.view`
  5. `dashboard_list_brand_scores` — `branding.view`
  6. `dashboard_get_brand_score` — `branding.view`

- **D-02:** `dashboard_scan_site` is **async**. Handler calls `ScanService.initiate()` and immediately returns `{scanId, status: 'queued', url}` in the tool response envelope. LLM polls scan progress by calling `dashboard_get_report` with the scanId — the report tool returns `{status: 'running' | 'complete' | 'failed', report?: {...}}` so no separate `dashboard_get_scan_status` tool is needed (preserves the minimum-4 tool catalogue). Avoids MCP/HTTP tool-call timeouts on multi-minute scans and avoids tying up a Fastify worker per scan.

- **D-03:** `dashboard_scan_site` declares `destructive: true` via the MCP SDK tool annotation. Rationale: triggers external network fetches, writes a new `scans` row, consumes downstream LLM quota (analyse/fix). Destructive flag trips Claude Desktop's confirmation UI in Phase 30; Phase 32 adds the dashboard-native `<dialog>` confirmation (APER-02) on top for in-app chat. All other data tools are read-only — no destructive flag.

- **D-04:** Brand-score tools follow the branding Phase 29 list+get pattern (29-CONTEXT D-03). `dashboard_list_brand_scores` returns paginated rows for the caller's org (repo already supports org scoping). `dashboard_get_brand_score` accepts `{siteUrl?: string, scanId?: string}` — exactly one of the two — and returns the most recent matching score. Neither tool accepts `orgId`.

### Admin tool surface (MCPT-04)

- **D-05:** Admin tools ship with **read + safe writes; no deletes**. Tentative surface (planner refines exact names):
  - Users: `dashboard_list_users`, `dashboard_get_user`, `dashboard_create_user`, `dashboard_update_user`
  - Orgs: `dashboard_list_orgs`, `dashboard_get_org`, `dashboard_create_org`, `dashboard_update_org`
  - Service connections: `dashboard_list_service_connections`, `dashboard_get_service_connection`, `dashboard_create_service_connection`, `dashboard_update_service_connection`, `dashboard_test_service_connection`
  - Deletes (`delete_user`, `delete_org`, `delete_service_connection`) DEFERRED to Phase 32 alongside APER-02 dashboard-native confirmation modal.
  - API-key management tools and role/team tools NOT included in Phase 30 — MCPT-04 wording covers "users, orgs, service connections" specifically; api-keys/roles/teams defer to Phase 32.

- **D-06:** **Service-connection client secrets are always redacted in tool output.** `dashboard_list_service_connections` and `dashboard_get_service_connection` return `{..., hasSecret: boolean, secretPreview: 'xxxx...last4' | null}` — never the encrypted blob, never the plaintext. Writes (`create`/`update`) accept a new `clientSecret` string in `inputSchema`; reads never expose it. `dashboard_test_service_connection` returns `{ok: boolean, error?: string, latencyMs: number}` — error messages must not echo the secret.

- **D-07:** **RBAC gating per-tool, specific permissions** (extends Phase 28 D-03). Mapping:
  - `dashboard_list_users` → `admin.users` (system-wide list; org admins see only their org's members — repo layer enforces via `orgId`)
  - `dashboard_get_user` / `create_user` / `update_user` → `admin.users`
  - `dashboard_list_orgs` → `admin.org` (org-scoped view) OR `admin.system` (all orgs) — both permissions visible to the filter; handler scopes query by caller's role
  - `dashboard_get_org` / `update_org` → `admin.org` (own org) OR `admin.system` (any)
  - `dashboard_create_org` → `admin.system` (system-wide only)
  - `dashboard_*_service_connection` (all 5) → `admin.system` (service connections are system-wide)
  - Manifest filter already enforces permission visibility via `resolveEffectivePermissions` (Phase 28 D-03 / dashboard `mcp/middleware.ts`) — no new RBAC infra required.

- **D-08:** **No app-level confirmation pattern in Phase 30.** `destructive: true` on the MCP tool annotation is the sole gate for Phase 30 — external clients (Claude Desktop) surface their own confirmation. Dashboard-native `<dialog>` confirmation (APER-02) ships in Phase 32 when the chat UI lands. Phase 30 tools stay stateless: no "confirmation token" two-phase pattern.

### MCP Resources (MCPI-05)

- **D-09:** Two URI schemes, verbatim from ROADMAP.md Phase 30 SC#5: `scan://report/{id}` and `brand://score/{siteUrl}`. The `{siteUrl}` segment is URL-encoded via `encodeURIComponent(siteUrl)` so characters `/`, `?`, `#` survive the path. `{id}` is the internal scan UUID (not the OS-local row id).

- **D-10:** **Resources List scope for an authenticated org-member caller:**
  - `scan://report/{id}` — last 50 completed scan reports (`ORDER BY completed_at DESC LIMIT 50`) for caller's `orgId`
  - `brand://score/{siteUrl}` — all brand scores for sites with an active brand-guideline assignment for caller's org (typically <50)
  - No unbounded listing — large orgs with 10k+ scans would otherwise return giant manifests. Resource pagination for >50 reports deferred to Phase 33 (agent intelligence).

- **D-11:** **Content format: JSON with `mimeType: 'application/json'`.** Resource read returns the MCP-standard envelope `{contents: [{uri, mimeType: 'application/json', text: JSON.stringify(entity)}]}`. Consistent with tool response envelope from Phase 28. `scan://report/{id}` returns the full report row including embedded issues (same shape as `dashboard_get_report` returns). `brand://score/{siteUrl}` returns the full brand score row with dimension breakdown (color/typography/components).

- **D-12:** **RBAC filter applies to Resources both at list AND read.** `scan://` entries gated by `reports.view`; `brand://` entries gated by `branding.view`. A caller without the permission: sees zero entries of that family in the list response AND gets 403 on direct read. Requires a small extension to `createMcpHttpPlugin` in `@luqen/core/mcp`: add `setRequestHandler(ListResourcesRequestSchema, ...)` and `setRequestHandler(ReadResourceRequestSchema, ...)` filters mirroring the existing `ListToolsRequestSchema` filter (Phase 28 D-03 pattern).

### MCP Prompts (MCPI-06)

- **D-13:** Three prompts in Phase 30: `/scan`, `/report`, `/fix`. Exact list from ROADMAP.md SC#6 + REQUIREMENTS.md MCPI-06. Additional prompts (e.g. `/compare`, `/brand-score`, `/assign-guideline`) deferred — add in Phase 32 when the chat UI surfaces them.

- **D-14:** **Placeholder arg schema per prompt** (MCP Prompt arg shape — `{name, description, required}`, NOT JSON Schema):
  - `/scan`: `siteUrl` (required, "The website URL to scan"), `standard` (optional, "WCAG level: WCAG2A, WCAG2AA, or WCAG2AAA — defaults to WCAG2AA")
  - `/report`: `scanId` (required, "Scan ID returned from dashboard_scan_site or dashboard_list_reports")
  - `/fix`: `issueId` (required, "The pa11y issue code, e.g. WCAG2AA.Principle1.Guideline1_1.1_1_1.H37"), `scanId` (optional, "Scan context for the issue")
  - **No `orgId` argument anywhere** — enforces D-05 Phase 28 invariant on Prompts too. Tool calls triggered by the prompt always source orgId from the JWT via the ToolContext ALS.

- **D-15:** **Prompts return chat-message templates with a tool-aware neutral system message** (29-CONTEXT D-12 locked the shape — chat-message templates, not tool-call pre-fills). Each prompt's `messages` array contains:
  - One `system` message: lists the cross-service tools available (`dashboard_scan_site`, `dashboard_get_report`, `dashboard_query_issues`, `llm_generate_fix`, `llm_analyse_report`, `branding_match`, etc.) and establishes context (`"You are a WCAG compliance assistant in the Luqen dashboard"`). Does NOT prescribe tool-call sequencing — LLM picks tools from its tools/list at call time.
  - One `user` message: the task with placeholders filled (e.g. `/scan` → `"Scan {siteUrl} for WCAG {standard} compliance and summarize the top 5 issues."`).
  - No `assistant` messages — the LLM generates those at runtime.

### External client connectivity (MCPT-05)

- **D-16:** **Three-part MCPT-05 verification:**
  1. **Automated smoke (CI):** `npx @modelcontextprotocol/inspector` in a test script against a running dashboard test server. Asserts: `tools/list` returns the 6 data tools + ≥8 admin tools; `resources/list` returns non-empty; `prompts/list` returns exactly `['/scan', '/report', '/fix']`; one tool call (`dashboard_list_reports`) succeeds and returns the expected envelope.
  2. **Manual Claude Desktop walkthrough:** developer connects Claude Desktop using `claude_desktop_config.json` pointing at `http://lxc-luqen:3000/api/v1/mcp` with OAuth2 Bearer; verifies tools/resources/prompts are listed; invokes `dashboard_list_reports`; captures screenshot or log in `30-VERIFICATION.md`.
  3. **Documentation:** `docs/mcp-client-setup.md` with Claude Desktop `claude_desktop_config.json` example, MCP Inspector invocation command, and OAuth2 Bearer token acquisition steps (existing `/oauth/token` endpoint — no new infra).
  - OAuth2 discovery metadata (`/.well-known/oauth-authorization-server`) NOT in scope — tracked as MCPE-01 (v3.1).

### Tool + Resource input schema invariant (carry-forward Phase 28 D-05, Phase 29 D-13)

- **D-17:** No tool registered in Phase 30 accepts `orgId` in its zod `inputSchema`; no prompt in Phase 30 accepts `orgId` as a placeholder arg. Enforced by the same runtime iteration test pattern used in 28-02-PLAN and 29-01/29-02: after `createDashboardMcpServer()` returns, iterate all registered tools + prompts + resources, assert no `orgId` appears in any input shape. ORG-SCOPED tools read `getCurrentToolContext().orgId` inside handlers and pass it to dashboard repositories.

### Claude's Discretion

- Exact pagination shape for `dashboard_list_reports`, `dashboard_list_brand_scores`, `dashboard_list_users`, `dashboard_list_orgs`, `dashboard_list_service_connections` (cursor vs offset; default limit — probably 50 to match Resources List default).
- Filter shape for `dashboard_query_issues` — severity array, WCAG level, standard (WCAG2A/AA/AAA), rule code prefix; planner decides based on pa11y result shape already stored.
- Directory layout under `packages/dashboard/src/mcp/` — single `server.ts` with all 6 data + 13 admin tool registrations, or split into `mcp/tools/scans.ts`, `mcp/tools/reports.ts`, `mcp/tools/admin-users.ts`, etc. Mirror whichever pattern Phase 29 settled on for LLM after execution.
- Response size cap for `dashboard_get_report` on huge reports — truncate embedded issues with a continuation hint vs always-full vs paginated via `dashboard_query_issues`.
- Whether `dashboard_test_service_connection` is `destructive: true` — runs a live OAuth probe against an external service; arguments both ways. Planner picks based on what the existing `/admin/service-connections` test button does UX-wise (it's a single click with visible spinner — not a confirmation dialog — so probably NOT destructive).
- Test strategy for the dashboard MCP: extend `packages/dashboard/tests/mcp/http.test.ts` (Phase 28) vs. add per-domain test files (scans/reports/brand-scores/admin). Planner decides based on file size.

### Folded Todos

None — todo match returned empty (`todo match-phase 30` → `{todo_count: 0}`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 + Phase 29 foundation (REQUIRED — invariants Phase 30 extends)
- `.planning/phases/28-mcp-foundation/28-CONTEXT.md` — D-01 through D-08 (endpoint routing, RBAC, org isolation, factory)
- `.planning/phases/28-mcp-foundation/28-PATTERNS.md` — Tool factory signature, response envelope, zod schema pattern, ALS-backed request-scoped context
- `.planning/phases/28-mcp-foundation/28-03-PLAN.md` — Dashboard MCP Bearer-only auth (CSRF defense), `resolveEffectivePermissions` wiring
- `.planning/phases/28-mcp-foundation/28-VERIFICATION.md` — Iteration-based `no orgId in inputSchema` test pattern
- `.planning/phases/29-service-mcp-tools/29-CONTEXT.md` — D-12 (Prompts = chat-message templates, NOT tool-call pre-fills), D-13 (tool input schema invariant), D-14 (rescope handoff), tool-naming discipline
- `.planning/phases/29-service-mcp-tools/29-01-PLAN.md` — Branding MCP list+get tool pattern (mirrored here for brand scores)
- `.planning/phases/29-service-mcp-tools/29-02-PLAN.md` — LLM MCP tool pattern + provider fallback (referenced by prompts' tool-awareness)

### Dashboard MCP stubs to populate (Phase 30 targets)
- `packages/dashboard/src/mcp/server.ts` — Empty `createDashboardMcpServer` stub; registers capability but ZERO tools. Phase 30 adds 6 data tools + 13 admin tools + resources + prompts.
- `packages/dashboard/src/mcp/middleware.ts` — Bearer-only preHandler, already wired; unchanged in Phase 30
- `packages/dashboard/src/routes/api/mcp.ts` — `registerMcpRoutes` wiring; unchanged (factory picks up new tools)
- `packages/dashboard/tests/mcp/http.test.ts` — Phase 28 test baseline; Phase 30 extends with data + admin + resource + prompt assertions

### `@luqen/core/mcp` factory (may need extension)
- `packages/core/src/mcp/http-plugin.ts` — `createMcpHttpPlugin` factory. Phase 30 D-12 requires adding `ListResourcesRequestSchema` + `ReadResourceRequestSchema` filters mirroring the existing tools/list permission filter.
- `packages/core/src/mcp/tool-filter.ts` — `filterToolsByPermissions` (Phase 28 deliverable). Phase 30 likely adds `filterResourcesByPermissions` alongside.
- `packages/core/src/mcp/context.ts` — `getCurrentToolContext` / ALS wiring; unchanged

### Dashboard repositories (reuse — no new repo methods needed)
- `packages/dashboard/src/db/sqlite/repositories/scan-repository.ts` §119 — `SqliteScanRepository` (list/get by orgId, create, update status)
- `packages/dashboard/src/db/sqlite/repositories/brand-score-repository.ts` §165 — `SqliteBrandScoreRepository` (list/get by orgId + siteUrl)
- `packages/dashboard/src/db/sqlite/repositories/user-repository.ts` — user CRUD with org scoping
- `packages/dashboard/src/db/sqlite/repositories/org-repository.ts` — org CRUD
- `packages/dashboard/src/db/service-connections-repository.ts` — service connection CRUD (encrypted clientSecret; Phase 30 handlers must redact on read — D-06)
- `packages/dashboard/src/services/scan-service.ts` §165 — `ScanService.initiate()` (D-02 async entrypoint)

### RBAC + permissions
- `packages/dashboard/src/permissions.ts` — 28 permission IDs (`scans.create`, `reports.view`, `branding.view`, `admin.users`, `admin.org`, `admin.system`, etc.). D-07 maps tools to these.
- `packages/dashboard/src/permissions.ts` §77 — `resolveEffectivePermissions(storage, userId, role, orgId)` signature

### Service-connection handling (D-06 reference)
- `packages/dashboard/src/services/service-connection-tester.ts` — existing test-button handler; D-06 redaction logic to mirror
- `packages/dashboard/src/routes/admin/` — existing admin CRUD routes; mirror their validation

### External client setup (MCPT-05 D-16)
- `docs/mcp-client-setup.md` — NEW file, Claude Desktop `claude_desktop_config.json` example + MCP Inspector command
- `packages/dashboard/src/auth/` — OAuth2 `/oauth/token` endpoint for Bearer acquisition (existing; no changes)

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — MCPT-01, MCPT-02 (brand-score half), MCPT-04, MCPT-05, MCPI-05, MCPI-06 definitions; traceability rows for Phase 30
- `.planning/ROADMAP.md` §Phase 30 — 6 success criteria (anchors for VERIFICATION.md)

### Research (background)
- `.planning/research/STACK.md` — MCP SDK 1.29.0 Resources/Prompts APIs
- `.planning/research/ARCHITECTURE.md` — Transport + resource/prompt dispatch
- `.planning/research/PITFALLS.md` — #9 cookie auth on MCP endpoint (already handled by dashboard/mcp/middleware.ts), #11 stdio-safety (no `console.log`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createDashboardMcpServer()` stub — already declares `tools` capability; Phase 30 populates tools + needs to add `resources` and `prompts` capabilities via `server.server.registerCapabilities({ tools: {...}, resources: {...}, prompts: {...} })`.
- `createMcpHttpPlugin()` from `@luqen/core/mcp` — already wraps dashboard MCP with Bearer auth + RBAC tool filter. Extension needed for Resources filter (D-12).
- `getCurrentToolContext()` (ALS-backed) — drop-in for every ORG-SCOPED tool handler.
- `ToolMetadata` + `BRANDING_TOOL_METADATA` pattern (29-01) — mirror as `DASHBOARD_DATA_TOOL_METADATA` + `DASHBOARD_ADMIN_TOOL_METADATA` or a single combined array.
- All required dashboard repositories exist with org-scoped methods — tools become thin adapters. No new repo work.
- `resolveEffectivePermissions()` already resolves the caller's permission set; used by dashboard middleware preHandler.

### Established Patterns
- Tool registration: `server.registerTool(name, { description, inputSchema: z.object({...}).describe('...'), annotations: { destructive: true } }, handler)` — every field `.describe()`'d. Destructive via SDK `annotations.destructiveHint` or metadata `destructive` flag (check which the SDK version 1.29.0 exposes).
- Response envelope: `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`; errors add `isError: true`.
- Classification comments: `// orgId: required (org-scoped — see ctx.orgId below)` — every Phase 30 handler gets one. No TODOs.
- Never add `orgId` to a zod `inputSchema`; always pull from ctx (D-05 Phase 28, D-13 Phase 29, D-17 Phase 30). Runtime iteration-tested.
- No `console.log` in `packages/dashboard/src/mcp/*` — stdio-safety still applies even though HTTP is the primary transport (CLI stdio reuse of the same server).

### Integration Points
- `packages/dashboard/src/mcp/server.ts` — primary file for tool/resource/prompt registration
- `packages/dashboard/tests/mcp/http.test.ts` — gains per-primitive assertions:
  - tools/list returns 6 data tools + N admin tools (from METADATA export)
  - resources/list returns last 50 scan:// URIs + all brand:// URIs, filtered by permission
  - prompts/list returns exactly `/scan`, `/report`, `/fix`
  - iteration test asserts no `orgId` in any tool inputSchema / prompt arg
- Resources filter extension to `@luqen/core/mcp` — new tests under `packages/core/tests/mcp/resource-filter.test.ts`
- External client smoke test — new script `packages/dashboard/tests/mcp/inspector-smoke.test.ts` (spawns inspector CLI via child_process)
- New doc file `docs/mcp-client-setup.md`

</code_context>

<specifics>
## Specific Ideas

- Tool naming continues Phase 28/29 convention: `<service>_<verb>_<noun>` lowercase snake_case (`dashboard_scan_site`, `dashboard_list_brand_scores`, `dashboard_update_service_connection`). No camelCase, no dashes.
- Tool descriptions written FOR the LLM, not humans: 1–2 sentence promise + one line of when-to-use (e.g. "Trigger an accessibility scan on a URL. Use when the user provides a website to audit or after creating a new site assignment.").
- Destructive tools get an explicit "this will run a real scan against {url} and may take minutes" note in the description so an LLM proposing the call warns the user even without the client-side confirmation dialog.
- `dashboard_get_report` description must call out the `{status}` field so LLMs know to poll rather than block (D-02).
- Service-connection tool descriptions must include "secrets are never returned — provide a new secret to rotate" so LLMs don't try to echo back existing credentials.
- Prompts' system message is intentionally tool-aware but not tool-prescriptive: it tells the LLM which tools exist across services without dictating sequencing. Aligns with D-12 Phase 29 (templates, not pre-fills) and keeps prompts portable when tools move services.
- MCP Inspector smoke test and manual Claude Desktop walkthrough should exercise tools FROM EACH service (compliance, branding, llm, dashboard) to confirm Phase 28/29 work remains externally reachable under real MCP client conditions — not just the Phase 30 surface.

</specifics>

<deferred>
## Deferred Ideas

### Moved to Phase 32 (Agent Service + Chat UI)
- `dashboard_delete_user`, `dashboard_delete_org`, `dashboard_delete_service_connection` — ship alongside APER-02 dashboard-native `<dialog>` confirmation modal (D-05, D-08)
- Api-key management tools (`dashboard_list_api_keys`, `dashboard_create_api_key`, `dashboard_revoke_api_key`) — not in MCPT-04 wording; add when chat UI surfaces them
- Role + team management tools — not in MCPT-04 wording; add when chat UI surfaces them
- App-level confirmation pattern for destructive tools — native `<dialog>` arrives with APER-02

### Moved to Phase 33 (Agent Intelligence + Audit Viewer)
- `dashboard_get_brand_score_trend` (sparkline data for last N scores per site) — agent-context tool, not MCP-primary
- Resource pagination for >50 reports — large-org agent context need

### Out of scope (v3.1+)
- OAuth2 discovery metadata (`/.well-known/oauth-authorization-server`) — MCPE-01 in REQUIREMENTS.md Future
- External client auth via API key or device code flow — MCPE-02
- Server Card at `/.well-known/mcp.json` for registry discovery — MCPE-01
- A2A peer registration — MCPE-03

### Reviewed Todos (not folded)
None — todo match returned empty.

### Considered and rejected
- "One filterable brand-score tool" instead of list+get — loses symmetry with Phase 29 branding_list_guidelines/branding_get_guideline pattern; LLMs sometimes miss the "omit filter for all" idiom (Area 1 Q4)
- "Namespaced `luqen://` scheme for all resources" — diverges from ROADMAP.md SC#5 wording; bare schemes kept (Area 3 Q1)
- "Two-phase tool pattern with confirmation token" for destructive — duplicates work Phase 32 will do via chat UI; destructive-flag-only is sufficient for Phase 30 (Area 2 Q4)
- "Expanded prompt set" (add /compare, /brand-score, /assign-guideline) — scope creep; the 3 prompts in the requirement are enough for Phase 30 (Area 4 Q1)

</deferred>

---

*Phase: 30-dashboard-mcp-external-clients*
*Context gathered: 2026-04-17*
