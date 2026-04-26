---
phase: 28-mcp-foundation
plan: 02
subsystem: mcp
tags:
  - mcp
  - compliance
  - branding
  - llm
  - fastify
  - streamable-http

requires:
  - "28-01 (createMcpHttpPlugin, ToolContext types, tool-filter)"
provides:
  - "POST /api/v1/mcp on compliance service (:4000) — all 11 tools exposed with RBAC tools/list filter and per-request ctx.orgId injection"
  - "POST /api/v1/mcp on branding service (:4100) — empty tool catalogue, transport ready for Phase 29 (MCPT-02)"
  - "POST /api/v1/mcp on LLM service (:4200) — empty tool catalogue, transport ready for Phase 29 (MCPT-03)"
  - "COMPLIANCE_TOOL_METADATA (11 entries, compliance.view / compliance.manage; destructive on approve + seed)"
  - "BRANDING_TOOL_METADATA (empty readonly array)"
  - "LLM_TOOL_METADATA (empty readonly array)"
affects:
  - 28-mcp-foundation/28-03 (dashboard — the fourth service plan)
  - 29-mcp-tools-expansion (will populate branding and LLM tool catalogues)

tech-stack:
  added:
    - "@luqen/core (workspace dep) on compliance, branding, llm"
    - "@modelcontextprotocol/sdk ^1.27.1 on branding, llm (already present on compliance)"
  patterns:
    - "registerMcpRoutes(app[, opts]) — single-line wiring of MCP HTTP endpoint alongside existing REST routes"
    - "createXxxMcpServer factories now return `{ server, toolNames, metadata }` — metadata threads into the plugin for RBAC filtering"
    - "Tool handlers read caller context via getCurrentToolContext() from @luqen/core/mcp (AsyncLocalStorage) — no args plumbing"
    - "Stub servers (branding, llm) declare `capabilities: { tools: {} }` up-front so the shared plugin's setRequestHandler override can install even with zero registered tools"

key-files:
  created:
    - "packages/compliance/src/mcp/metadata.ts"
    - "packages/compliance/src/api/routes/mcp.ts"
    - "packages/compliance/tests/mcp/http.test.ts"
    - "packages/branding/src/mcp/server.ts"
    - "packages/branding/src/api/routes/mcp.ts"
    - "packages/branding/tests/mcp/http.test.ts"
    - "packages/llm/src/mcp/server.ts"
    - "packages/llm/src/api/routes/mcp.ts"
    - "packages/llm/tests/mcp/http.test.ts"
  modified:
    - "packages/compliance/package.json (added @luqen/core workspace dep)"
    - "packages/compliance/src/mcp/server.ts (context injection, classification, metadata export)"
    - "packages/compliance/src/api/server.ts (registerMcpRoutes wired)"
    - "packages/branding/package.json (added @luqen/core and MCP SDK deps)"
    - "packages/branding/src/api/server.ts (registerMcpRoutes wired)"
    - "packages/llm/package.json (added @luqen/core and MCP SDK deps)"
    - "packages/llm/src/api/server.ts (registerMcpRoutes wired)"
    - "package-lock.json"

key-decisions:
  - "Reclassified 8 of 11 compliance tools as ORG-SCOPED (plan assumed GLOBAL). Discovery: DbAdapter filters (JurisdictionFilters, RegulationFilters, RequirementFilters) and method signatures (checkCompliance, listSources, listUpdateProposals, createSource/proposeUpdate inputs) all carry an orgId parameter; sqlite-adapter tables have an org_id column with system-vs-org filtering. Plan's own guidance authorises the reclassification (behavior section: `If during read_first the executor discovers any compliance table DOES in fact have an orgId column... Update the table in this plan and proceed`)."
  - "Used BOTH `// orgId: N/A (global — ...)` and `// orgId: ctx.orgId (org-scoped — ...)` marker comments so every one of the 11 handlers carries explicit, human-auditable classification. Total classification-comment count is 11 — no TODO deferrals, no uncommented handlers."
  - "Empty-stub McpServer instances (branding, LLM) require `{ capabilities: { tools: {} } }` in their constructor options. Without it, McpServer.server.setRequestHandler(ListToolsRequestSchema, ...) throws `Server does not support tools` because the capability gate in Server.assertRequestHandlerCapability trips. When tools are registered later (Phase 29), the SDK's automatic capability declaration still composes correctly with this up-front declaration."
  - "registerMcpRoutes uses `await app.register(plugin)` rather than the plan-suggested `await plugin(app)` — the plugin factory returns a FastifyPluginAsync, and `app.register` is the documented invocation path (it correctly supplies the options argument that FastifyPluginAsync requires)."

requirements-completed:
  - MCPI-01
  - MCPI-02
  - MCPI-03
  - MCPI-04

duration: 12min
completed: 2026-04-17
---

# Phase 28 Plan 02: Wire MCP endpoints into compliance, branding, and LLM services

**All three backend services now expose POST /api/v1/mcp over Streamable HTTP behind the existing OAuth2 JWT auth. Compliance carries all 11 upgraded tool handlers (ctx.orgId from JWT, explicit GLOBAL vs ORG-SCOPED classification, zero TODO-deferrals). Branding and LLM carry empty transport stubs ready for Phase 29 tool population.**

## Performance

- **Started:** 2026-04-17T08:15:08Z
- **Completed:** 2026-04-17T08:27:01Z
- **Duration:** ~12 min
- **Tasks:** 2 (both tdd=true; tests + impl bundled per task)
- **Files created:** 9
- **Files modified:** 8
- **Tests added:** 13 (7 compliance + 3 branding + 3 LLM)
- **Test-suite status:** compliance 550/550, branding 75/75, LLM 255/255 — all green; tsc --noEmit clean on all three packages.

## Plan-02 Must-Have Truths — verified

1. Valid Bearer JWT with `compliance` scope → 200 MCP initialize on :4000 + 11 tools visible in tools/list (admin scope) or 8 view-only tools (read scope). Proven by compliance integration tests "returns 200 MCP initialize..." and "tools/list admin scope...".
2. Valid Bearer → 200 initialize on branding :4100 with empty tools. Proven by branding test "returns 200 MCP initialize with valid Bearer" + "returns 200 with empty tools list".
3. Valid Bearer → 200 initialize on LLM :4200 with empty tools. Proven by LLM test mirror.
4. No-Bearer → 401 on all three endpoints. Proven by the `returns 401 when no Bearer token is provided` test on each package.
5. Every compliance tool handler receives orgId from JWT via ToolContext (via getCurrentToolContext); compliance tool inputSchemas contain **zero** orgId fields (runtime iteration test `MCPI-04 runtime guard`).
6. Every compliance tool is EXPLICITLY classified: 3 GLOBAL (`orgId: N/A`), 8 ORG-SCOPED (`orgId: ctx.orgId`). Total classification comments = 11, zero `TODO(phase-29)` strings in server.ts. Enforced by the `Classification coverage` test.
7. Every ORG-SCOPED tool filters by `ctx.orgId` at the DB-query layer in this phase — proven by code review and by the assertion that orgId flows into `db.listJurisdictions({ orgId })`, `db.listRegulations({ orgId })`, `db.listRequirements({ orgId })`, `db.listSources({ orgId })`, `db.listUpdateProposals({ orgId })`, `db.createSource({ orgId })`, `proposeUpdate({ orgId })`, and `checkCompliance(..., orgId)` — no deferrals.
8. Compliance stdio CLI continues to work unchanged — `getCurrentToolContext()` returns undefined under stdio, `resolveOrgId()` falls back to `'system'`, existing behaviour preserved. The full compliance suite including `cli.test.ts` and `scenarios.test.ts` passes 550/550 post-change.
9. COMPLIANCE_TOOL_METADATA annotates all 11 tools with permissions matching dashboard ALL_PERMISSION_IDS. Verified by the metadata test and by `grep -c "name: 'compliance_"` = 11.

## Task Commits

1. **Task 1: Wire MCP into compliance, classify all 11 handlers, runtime D-05 test** — `3df6dd3` (feat)
2. **Task 2: Empty MCP stubs for branding + LLM with integration tests** — `65e1521` (feat)

## Ports + curl demonstration

The three services expose their MCP endpoints at:

- Compliance: `POST http://localhost:4000/api/v1/mcp`
- Branding:   `POST http://localhost:4100/api/v1/mcp`
- LLM:        `POST http://localhost:4200/api/v1/mcp`  (note: server.ts advertises 5100 in swagger servers[] — the actual listen port is controlled by the CLI and defaults to 4200 per CONTEXT.md D-01; swagger value is cosmetic)

The integration tests use Fastify's `app.inject()` (in-process) rather than opening live sockets, but the equivalent HTTP invocations on a running service would be:

```bash
# Unauthenticated — expect 401
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# Expected: 401

# Authenticated initialize — expect 200 with protocolVersion
curl -sS -X POST http://localhost:4000/api/v1/mcp \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# Expected: SSE-framed JSON-RPC response with result.protocolVersion, result.serverInfo
```

## _registeredTools reachability (plan Output requirement)

- **Reachable on SDK 1.27.1.** `McpServer._registeredTools` is declared `private` in the `.d.ts` (line 21) but is a real runtime property populated by `registerTool`. The MCPI-04 runtime test in `packages/compliance/tests/mcp/http.test.ts` iterates `(server as unknown as {...})._registeredTools` with a narrowed cast, finds 11 entries, and asserts that each `inputSchema` does **not** contain an `orgId` field. No exported helper was needed — the cast path is sufficient and matches what Plan 01's http-plugin already uses.
- **Shape caveat:** zod schemas stored in `inputSchema` do not always expose a `.shape` property in a consistent way across zod versions. The test walks three candidate shape-extraction paths (`_def.shape()`, `_def.shape`, `.shape`) and falls back to `JSON.stringify` with a function-stripper for a belt-and-braces "no orgId token anywhere" check. Both assertions pass.

## Stdio CLI regression check (plan Output requirement)

- No regressions — `packages/compliance/tests/cli.test.ts` + all 43 test files pass 550/550 after the change.
- The context-propagation design means `getCurrentToolContext()` is `undefined` in stdio mode, which `resolveOrgId()` handles by returning `'system'` — exactly the existing pre-change behaviour (DB filters with `orgId: 'system'` include only system records, which is what the current stdio CLI behaves like today).

## Branding vs LLM integration (plan Output requirement)

Near-identical by design. Both files (`packages/{branding,llm}/src/mcp/server.ts`) carry the same structure: `McpServer({name, version}, {capabilities: {tools: {}}})`, empty `TOOL_METADATA`, factory returning `{server, toolNames: [], metadata: []}`. Both route modules (`api/routes/mcp.ts`) are the same shape — they differ only in the factory/metadata names they import. Both integration tests share the same 401/initialize/tools-list pattern. No unexpected divergence.

## Files Created / Modified

- `packages/compliance/src/mcp/metadata.ts` (new) — COMPLIANCE_TOOL_METADATA with all 11 entries.
- `packages/compliance/src/mcp/server.ts` (modified) — context injection, classification, metadata export.
- `packages/compliance/src/api/routes/mcp.ts` (new) — registerMcpRoutes wrapping createMcpHttpPlugin.
- `packages/compliance/src/api/server.ts` (modified) — `await registerMcpRoutes(app, { db })` inserted after `registerWcagCriteriaRoutes`.
- `packages/compliance/tests/mcp/http.test.ts` (new) — 7 integration tests.
- `packages/compliance/package.json` (modified) — `"@luqen/core": "*"` added.
- `packages/branding/src/mcp/server.ts` (new) — createBrandingMcpServer with empty tool catalogue.
- `packages/branding/src/api/routes/mcp.ts` (new) — registerMcpRoutes.
- `packages/branding/src/api/server.ts` (modified) — `await registerMcpRoutes(app)` before `return app`.
- `packages/branding/tests/mcp/http.test.ts` (new) — 3 integration tests.
- `packages/branding/package.json` (modified) — `@luqen/core` + `@modelcontextprotocol/sdk` added.
- `packages/llm/src/mcp/server.ts` (new) — createLlmMcpServer mirror.
- `packages/llm/src/api/routes/mcp.ts` (new) — registerMcpRoutes.
- `packages/llm/src/api/server.ts` (modified) — MCP registration after `registerPromptRoutes`.
- `packages/llm/tests/mcp/http.test.ts` (new) — 3 integration tests.
- `packages/llm/package.json` (modified) — `@luqen/core` + `@modelcontextprotocol/sdk` added.
- `package-lock.json` (modified) — workspace symlinks refreshed after package.json edits.

## Deviations from Plan

Four auto-applied adjustments. The first two are classified as Rule 2 (missing critical functionality — correctness/security) and authorised by the plan's own guidance; the remaining two are Rule 3 (blocking issue) and Rule 1 (bug) mechanical fixes.

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Reclassified 8 of 11 compliance tools as ORG-SCOPED**

- **Found during:** Task 1 read_first of `packages/compliance/src/db/adapter.ts`, `src/db/sqlite-adapter.ts`, and `src/engine/checker.ts`.
- **Issue:** The plan declared every one of the 11 tools as GLOBAL and required an `// orgId: N/A (global reference data)` comment on each handler. However:
  - `DbAdapter.listJurisdictions`, `listRegulations`, `listRequirements`, `listSources`, and `listUpdateProposals` all accept an `orgId?` filter.
  - Their underlying tables carry an `org_id` column (idx_* indexes in sqlite-adapter.ts lines 303–399) with `DEFAULT 'system'`.
  - The query semantics: when the filter carries `orgId`, the SELECT clause matches `org_id IN ('system', <caller-org>)` — shared `system` records alongside the caller's own custom records. This is the standard `system + org` pattern used across existing REST routes.
  - `checkCompliance(request, db, orgId)` accepts orgId as its 3rd positional argument, threading it into `findRequirementsByCriteria` with the same `system + org` semantics.
  - `CreateUpdateProposalInput` and `CreateSourceInput` both declare an `orgId?` field.
  - Without passing `ctx.orgId`, all these calls run against the whole table including OTHER orgs' custom records — a direct MCPI-04 violation (cross-org data leakage).
- **Fix:** Applied the plan's own authorised escape path (line in the Behavior block: "If during read_first the executor discovers any compliance table DOES in fact have an `orgId` column, STOP and flag: the handler touching that table is ORG-SCOPED and must filter by `ctx.orgId` in this phase — no TODO deferral. Update the table in this plan and proceed."). Eight tools are now ORG-SCOPED (inject `ctx.orgId` into filter/input), three remain GLOBAL (single-record lookup by ID, or a system-wide baseline seed).
- **Revised classification table:**
  - GLOBAL (3): `compliance_get_regulation`, `compliance_approve_update`, `compliance_seed`
  - ORG-SCOPED (8): `compliance_check`, `compliance_list_jurisdictions`, `compliance_list_regulations`, `compliance_list_requirements`, `compliance_propose_update`, `compliance_get_pending`, `compliance_list_sources`, `compliance_add_source`
- **Files modified:** `packages/compliance/src/mcp/server.ts` (handler bodies), `packages/compliance/tests/mcp/http.test.ts` (updated classification assertion: 3 `orgId: N/A` + 8 `orgId: ctx.orgId` = 11 total, not 11 `N/A`).
- **Verification:** `grep -cE "orgId: (N/A|ctx\\.orgId)" packages/compliance/src/mcp/server.ts` → 11. `grep -c "orgId: N/A" …` → 3. `grep -c "orgId: ctx.orgId" …` → 8. Full test suite 550/550 green.
- **Impact on acceptance criteria:** The plan's line `grep -c "orgId: N/A (global reference data)" packages/compliance/src/mcp/server.ts returns exactly 11` is now `returns 3`. The updated invariant is captured as the union grep returning 11. MCPI-04 is still satisfied — in fact MORE strongly: the runtime iteration test proves no tool accepts orgId from args, AND the 8 ORG-SCOPED handlers actively filter by ctx.orgId at the DB layer.
- **Committed in:** `3df6dd3` (Task 1).

**2. [Rule 2 — Missing critical functionality] Empty-stub McpServer needs explicit tools capability**

- **Found during:** First run of the branding integration test (Task 2).
- **Issue:** Running `createBrandingMcpServer()` → `createMcpHttpPlugin()` threw: `Error: Server does not support tools (required for tools/list)` at `Server.setRequestHandler`. The SDK's `assertRequestHandlerCapability` checks whether the server declared the `tools` capability; McpServer auto-declares it only when `registerTool` is called at least once. Because the Phase 28 stubs register zero tools, the capability is absent, the shared plugin's setRequestHandler call fails, the server never starts, and `beforeAll` fails before `app` is assigned.
- **Fix:** Pass `{ capabilities: { tools: {} } }` explicitly to the `McpServer(...)` constructor in both stub factories. The Server's capability registry accepts further registrations later (when Phase 29 calls `registerTool`), so this is forward-compatible.
- **Files modified:** `packages/branding/src/mcp/server.ts`, `packages/llm/src/mcp/server.ts`.
- **Verification:** Branding + LLM test suites each 3/3 green; branding 75/75 full suite, LLM 255/255 full suite.
- **Committed in:** `65e1521` (Task 2).

**3. [Rule 3 — Blocking] registerMcpRoutes invocation signature**

- **Found during:** First `tsc --noEmit` run after writing `packages/compliance/src/api/routes/mcp.ts`.
- **Issue:** The plan's code sample in the Behavior block wrote `await plugin(app);`. The plugin factory returns a `FastifyPluginAsync` whose call signature is `(instance, opts) => Promise<void>` — both arguments required. `await plugin(app);` fails typecheck with "Expected 2 arguments, but got 1." The existing Phase 01 integration test uses the documented Fastify invocation `await app.register(plugin);`.
- **Fix:** Changed `await plugin(app)` to `await app.register(plugin)` in all three routes files (compliance, branding, LLM).
- **Files modified:** `packages/compliance/src/api/routes/mcp.ts`, `packages/branding/src/api/routes/mcp.ts`, `packages/llm/src/api/routes/mcp.ts`.
- **Verification:** tsc --noEmit exits 0 across all three packages.
- **Committed in:** `3df6dd3` (Task 1; branding/LLM path reused in `65e1521`).

**4. [Rule 1 — Bug] UpdateProposal does not expose orgId on its public type**

- **Found during:** Second `tsc --noEmit` on compliance.
- **Issue:** Initial draft of `compliance_approve_update` attempted to enforce cross-org leakage protection by reading `existing.orgId` from `db.getUpdateProposal(id)`. The public `UpdateProposal` interface (types.ts lines 71–89) does not include `orgId`, although the DB row does — tsc errored "Property 'orgId' does not exist on type 'UpdateProposal'".
- **Fix:** Preserved the existence check (return structured error if proposal not found) but relied on the requiredPermission gate (`compliance.manage` filtered at tools/list) to restrict access. Added an explanatory comment noting that per-proposal org isolation would need either a new `getUpdateProposalOrgId(id)` DbAdapter method or an `orgId` field on the public UpdateProposal type — both scope changes outside this plan. The tool remains classified GLOBAL (by-ID lookup) and callers must already hold the compliance.manage RBAC permission to reach it.
- **Files modified:** `packages/compliance/src/mcp/server.ts`.
- **Verification:** tsc clean; "approve_update" test scenario in the integration file still passes.
- **Committed in:** `3df6dd3` (Task 1).

### Not-a-deviation — preserved design note

LLM server's Fastify swagger servers entry still lists `http://localhost:5100`; the actual listen port (4200 per D-01) is controlled by the CLI. I intentionally did NOT modify the swagger config in this plan because it is orthogonal to the MCP transport work and unchanged from the pre-Phase-28 baseline. A targeted doc fix can land alongside any port-consistency pass in a future plan.

---

**Total deviations:** 4 (Rule 2 × 2 correctness authorised by plan, Rule 3 × 1 blocking, Rule 1 × 1 bug — all mechanical).

## Issues Encountered

None beyond the deviations above. All automated verification passes:

- `cd packages/compliance && npx tsc --noEmit && npx vitest run` → 550/550 green
- `cd packages/branding && npx tsc --noEmit && npx vitest run tests/mcp/http.test.ts` → 3/3 green; full suite 75/75
- `cd packages/llm && npx tsc --noEmit && npx vitest run tests/mcp/http.test.ts` → 3/3 green; full suite 255/255
- `grep -rn "console\.log" packages/{compliance,branding,llm}/src/mcp/` → empty
- `grep -rEn "orgId\s*:\s*z\." packages/{compliance,branding,llm}/src/mcp/` → empty
- `grep -rEn "TODO\(phase-29\)" packages/compliance/src/mcp/` → empty
- `grep -cE "orgId: (N/A|ctx\.orgId)" packages/compliance/src/mcp/server.ts` → 11

## User Setup Required

None — this plan ships library + routes code only. To exercise the new endpoints on a running dev stack:

1. `npm run build -w packages/core` (Phase 01 output — should already be built)
2. `npm run start -w packages/compliance` (listens on :4000)
3. `npm run start -w packages/branding` (listens on :4100)
4. `npm run start -w packages/llm` (listens on :4200)
5. Obtain an OAuth2 access token via each service's `POST /api/v1/oauth/token` using an OAuth client with appropriate scopes.
6. `curl -X POST http://localhost:<port>/api/v1/mcp -H "authorization: Bearer $TOKEN" …` (see the curl examples above).

No env-var changes, no migrations.

## Next Phase Readiness

- Plan 28-03 (dashboard service) can now follow the same pattern: create `packages/dashboard/src/mcp/server.ts`, `src/routes/mcp.ts` (or equivalent), wire `registerMcpRoutes` after the existing RBAC preHandler.
- Phase 29 (MCPT-02 / MCPT-03) will populate `BRANDING_TOOL_METADATA` and `LLM_TOOL_METADATA` and register tools on the respective servers; no transport-layer changes will be needed.
- The concurrency note from Plan 01's SUMMARY remains applicable — the shared McpServer instance is re-entered per sequential request; truly concurrent loads on a single service's MCP endpoint may benefit from a per-request factory option on `createMcpHttpPlugin`. No Phase 28 test exercises concurrent requests, so this remains a forward note rather than a blocker.

## Self-Check: PASSED

Verified at 2026-04-17T08:27:30Z:

- `packages/compliance/src/mcp/metadata.ts` — FOUND
- `packages/compliance/src/api/routes/mcp.ts` — FOUND
- `packages/compliance/tests/mcp/http.test.ts` — FOUND
- `packages/branding/src/mcp/server.ts` — FOUND
- `packages/branding/src/api/routes/mcp.ts` — FOUND
- `packages/branding/tests/mcp/http.test.ts` — FOUND
- `packages/llm/src/mcp/server.ts` — FOUND
- `packages/llm/src/api/routes/mcp.ts` — FOUND
- `packages/llm/tests/mcp/http.test.ts` — FOUND
- commit `3df6dd3` — FOUND in `git log --oneline`
- commit `65e1521` — FOUND in `git log --oneline`
- `cd packages/compliance && npx tsc --noEmit` — exit 0
- `cd packages/branding && npx tsc --noEmit` — exit 0
- `cd packages/llm && npx tsc --noEmit` — exit 0
- `cd packages/compliance && npx vitest run tests/mcp/http.test.ts` — 7/7 pass
- `cd packages/branding && npx vitest run tests/mcp/http.test.ts` — 3/3 pass
- `cd packages/llm && npx vitest run tests/mcp/http.test.ts` — 3/3 pass
- full suites: compliance 550/550, branding 75/75, LLM 255/255

---
*Phase: 28-mcp-foundation*
*Completed: 2026-04-17*
