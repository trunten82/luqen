---
phase: 28-mcp-foundation
verified: 2026-04-16T08:45:00Z
status: passed
score: 4/4 success criteria verified; 4/4 requirements satisfied
overrides_applied: 0
---

# Phase 28: MCP Foundation — Verification Report

**Phase Goal:** Every Luqen service exposes a secured MCP endpoint that enforces caller identity and org isolation before any tool is reachable.

**Verified:** 2026-04-16
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement Summary

All four success criteria from ROADMAP.md are delivered in the codebase with concrete evidence (file:line references), verified through automated tests (core 208, compliance 550, branding 75, LLM 255, dashboard 2659 — all green), and upheld by runtime guards that cannot be satisfied by stubs or placeholders.

---

## Success Criterion Verdicts

### SC-1 — MCP session at POST /api/v1/mcp across compliance, branding, LLM (Streamable HTTP)

**Verdict:** PASS

Each backend service registers `POST /api/v1/mcp` via the shared plugin from `@luqen/core/mcp`, which constructs a stateless `StreamableHTTPServerTransport` per request.

Evidence:

- `packages/core/src/mcp/http-plugin.ts:41` imports `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js` (SDK 1.27.1 resolved correctly).
- `packages/core/src/mcp/http-plugin.ts:163` constructs the transport with `sessionIdGenerator: undefined` (stateless per-request, no session-as-auth).
- `packages/core/src/mcp/http-plugin.ts:79-82` factory signature `createMcpHttpPlugin(options)` with default `path = '/api/v1/mcp'`.
- `packages/compliance/src/api/routes/mcp.ts:14-25` calls `createMcpHttpPlugin({ mcpServer, toolMetadata: COMPLIANCE_TOOL_METADATA, requiredScope: 'read' })` and registers via `app.register(plugin)`.
- `packages/compliance/src/api/server.ts:173` wires `await registerMcpRoutes(app, { db })` after all other REST routes and after global auth (`createAuthMiddleware` at line 132-133).
- `packages/branding/src/api/routes/mcp.ts:12-20` mirror of the above for branding; `packages/branding/src/api/server.ts:550` wires it in.
- `packages/llm/src/api/routes/mcp.ts:12-20` mirror for LLM; `packages/llm/src/api/server.ts:137` wires it in.
- `@luqen/core` dependency declared in all three: `packages/compliance/package.json`, `packages/branding/package.json`, `packages/llm/package.json`.
- Behavioural proof — initialize returns 200 with `protocolVersion`: `packages/compliance/tests/mcp/http.test.ts:70-88`, `packages/branding/tests/mcp/http.test.ts`, `packages/llm/tests/mcp/http.test.ts`. All three integration suites green (28 compliance MCP assertions, 3 branding, 3 LLM — dashboard also delivers its endpoint; see SC-2).

Note on transport naming: the prompt references `NodeStreamableHTTPServerTransport`; the SDK 1.27.1 actual export is `StreamableHTTPServerTransport` at `@modelcontextprotocol/sdk/server/streamableHttp.js`. This is the Node-compatible Streamable HTTP transport per MCP spec — no separate `Node*` variant exists at this SDK version. Functionally equivalent; acceptable.

### SC-2 — Missing / expired / tampered JWT returns 401 BEFORE any tool code runs

**Verdict:** PASS

Three backend services rely on the service-global `createAuthMiddleware` registered via `app.addHook('preHandler', authMiddleware)` BEFORE `registerMcpRoutes`. The `/api/v1/mcp` path is NOT in any `PUBLIC_PATHS` list, so the global preHandler runs first. The shared plugin's own extractToolContext throws → 401 when `request.tokenPayload` is missing (e.g. global middleware rejected the token earlier).

Evidence (backend services):

- `packages/compliance/src/api/server.ts:132-133` — `app.addHook('preHandler', authMiddleware)` registered BEFORE `registerMcpRoutes` at line 173.
- `packages/branding/src/api/server.ts:89-90` — auth hook added BEFORE `registerMcpRoutes(app)` at line 550.
- `packages/llm/src/api/server.ts:102-103` — auth hook added BEFORE `registerMcpRoutes(app)` at line 137.
- `packages/core/src/mcp/http-plugin.ts:144-152` — route handler calls `extractToolContext(request)`; throws if `request.tokenPayload` is missing; returns 401 `{ error: 'Not authenticated' }` before any dispatch.
- `packages/core/src/mcp/auth.ts:39-42` — exact error message `'MCP request reached tool dispatch without authenticated tokenPayload — check preHandler order'`.

Dashboard (Bearer-only, stronger guard):

- `packages/dashboard/src/mcp/verifier.ts:26-28` — `importSPKI(pem, 'RS256')` + `jwtVerify(token, key, { algorithms: ['RS256'] })`. RS256 allowlist rejects HS256, `alg: none`, and wrong-key tokens.
- `packages/dashboard/src/mcp/middleware.ts:57-68` — 401 `'Bearer token required'` on missing/non-Bearer header, 401 `'Invalid or expired token'` on verifyToken rejection. Runs BEFORE any MCP plugin dispatch.
- `packages/dashboard/src/routes/api/mcp.ts:43-46` — `scoped.addHook('preHandler', createMcpAuthPreHandler(opts))` registered BEFORE `plugin(scoped, {})`.
- `packages/dashboard/src/server.ts:878-881` — startup fails fast if `DASHBOARD_JWT_PUBLIC_KEY` is unset: `throw new Error('DASHBOARD_JWT_PUBLIC_KEY must be set to enable the dashboard MCP endpoint (RS256).')`.

Tests (runtime proof):

- `packages/compliance/tests/mcp/http.test.ts:60-68` asserts 401 with no Bearer (compliance).
- `packages/branding/tests/mcp/http.test.ts` asserts 401 (no Bearer).
- `packages/llm/tests/mcp/http.test.ts` asserts 401 (no Bearer).
- `packages/dashboard/tests/mcp/verifier.test.ts` — 5 tests including algorithm-confusion (HS256 rejected) and signature-mismatch rejection.
- `packages/dashboard/tests/mcp/middleware.test.ts` — 6 tests including missing header, non-Bearer, bad token, cookie-session ignored.
- `packages/dashboard/tests/mcp/http.test.ts` — 8 tests covering full route composition and startup-fail.

### SC-3 — Tool manifest filtered by RBAC — org-member never sees admin-only tools

**Verdict:** PASS

Filtering is implemented via `mcpServer.server.setRequestHandler(ListToolsRequestSchema, handler)` registered ONCE at plugin construction (SDK request-handler override — a single committed mechanism with no branching alternatives). The handler reads the current caller's ToolContext from `AsyncLocalStorage` and applies `filterToolsByPermissions` (primary RBAC) or `filterToolsByScope` (service-to-service fallback).

Evidence:

- `packages/core/src/mcp/http-plugin.ts:113-140` — single `setRequestHandler(ListToolsRequestSchema, ...)` call, reads current ToolContext from AsyncLocalStorage, filters by permissions or scope, returns `{ tools }` with full descriptors pulled from `mcpServer._registeredTools`.
- `packages/core/src/mcp/tool-filter.ts:23-30` — `filterToolsByPermissions` returns tools where `requiredPermission == null || effectivePerms.has(requiredPermission)`.
- `packages/core/src/mcp/tool-filter.ts:32-58` — `filterToolsByScope` with hierarchy (admin > write > read); `.manage`/`.delete`/admin perms require write+.
- `packages/compliance/src/mcp/metadata.ts:15-27` — COMPLIANCE_TOOL_METADATA: 8 tools annotated `compliance.view`, 3 annotated `compliance.manage` (2 of those also `destructive: true`).
- `packages/dashboard/src/mcp/middleware.ts:71-77` — dashboard uses `resolveEffectivePermissions(storage.roles, sub, role, orgId)` and attaches the permissions to the request; the shared plugin's filter sees them via `getCurrentToolContext().permissions`.

Runtime proof — org-member caller (read scope, no RBAC perms) does NOT see `compliance.manage` tools:

- `packages/compliance/tests/mcp/http.test.ts:90-117` — read-scope token: `expect(names).toContain('compliance_check')`, `expect(names).not.toContain('compliance_approve_update')`, `expect(names).not.toContain('compliance_seed')`.
- `packages/compliance/tests/mcp/http.test.ts:119-138` — admin-scope token: all 11 tools visible (`expect(names.length).toBe(11)` including approve+seed).
- `packages/core/src/mcp/__tests__/http-plugin.test.ts` — integration test for the @luqen/core plugin asserts the filtered tools/list response (covered by the 18 passing core tests).
- `packages/dashboard/tests/mcp/middleware.test.ts` — confirms admin role short-circuits to ALL_PERMISSION_IDS; member role resolves via role repository.

### SC-4 — All tool calls pre-scoped to JWT orgId; no cross-org leakage regardless of args

**Verdict:** PASS

`ToolContext.orgId` is sourced from `request.orgId` (populated by the service's global auth middleware from the JWT `orgId` claim). No tool inputSchema contains an `orgId` field — enforced by a runtime iteration test that inspects every registered tool's zod schema. The 8 ORG-SCOPED compliance handlers inject `ctx.orgId` into the DB query filter directly.

Evidence (architectural):

- `packages/core/src/mcp/types.ts:21-27` — `ToolContext.orgId` is `readonly`; all fields `readonly` (immutability invariant).
- `packages/core/src/mcp/auth.ts:36-58` — `extractToolContext(request)` reads `request.orgId` (NOT `request.body`, NOT tool args); returns frozen context with `scopes` spread-copied to prevent mutation.
- `packages/core/src/mcp/http-plugin.ts:171-174` — dispatch runs inside `toolContextStore.run(context, ...)` AsyncLocalStorage scope; tool handlers read context via `getCurrentToolContext()`.
- `packages/compliance/src/mcp/server.ts:58-61` — `resolveOrgId()` returns `getCurrentToolContext()?.orgId ?? 'system'`; used by every ORG-SCOPED handler.
- `packages/compliance/src/mcp/server.ts:115-340` — 11 handlers, each carrying explicit classification comment (`// orgId: ctx.orgId (org-scoped — ...)` or `// orgId: N/A (global — ...)`). 8 ORG-SCOPED handlers inject `orgId` into `db.listJurisdictions`, `db.listRegulations`, `db.listRequirements`, `db.listSources`, `db.listUpdateProposals`, `db.createSource`, `proposeUpdate`, `checkCompliance` — all with system+org filter semantics.
- `packages/compliance/src/mcp/server.ts:213-218` — `compliance_get_regulation` adds a defence-in-depth cross-org guard: returns not-found if `regulation.orgId !== 'system' && regulation.orgId !== orgId`.

Evidence (runtime enforcement):

- `packages/compliance/tests/mcp/http.test.ts:140-194` — "MCPI-04 runtime guard": iterates all 11 `_registeredTools` entries, walks each zod `inputSchema.shape` through three extraction paths, asserts `not.toHaveProperty('orgId')`, and also belt-and-braces serialises the schema to JSON and asserts `"orgId"` substring is absent.
- `packages/compliance/tests/mcp/http.test.ts:196-229` — "Classification coverage": reads `src/mcp/server.ts` source, asserts no `TODO(phase-29)` deferrals, counts 3 global + 8 org-scoped markers = exactly 11, asserts no `orgId: z.` zod schema declarations, asserts no `console.log` in the stdio-shared file.

### Additional Checks (from verification_criteria)

| Check | Verdict | Evidence |
| ----- | ------- | -------- |
| Dashboard refuses cookie sessions (Bearer-only) | PASS | `packages/dashboard/src/mcp/middleware.ts` reads only `request.headers.authorization`; grep for `request.session`/`request.user` in `packages/dashboard/src/mcp/` returns no matches. Three session-hook bypasses in `src/server.ts:602,620,676` use shared `isBearerOnlyPath`. |
| Stateless transport per request | PASS | `packages/core/src/mcp/http-plugin.ts:163` — `sessionIdGenerator: undefined` (single authoritative call site). |
| DASHBOARD_JWT_PUBLIC_KEY env var + RS256 enforcement | PASS | `packages/dashboard/src/config.ts:29,69,149-151` wires env var; `src/mcp/verifier.ts:26-28` enforces `algorithms: ['RS256']`; `src/server.ts:878-881` fails fast if unset. |
| stdio transport preserved (D-08) | PASS | `packages/compliance/src/cli.ts:9,235-238` still uses `StdioServerTransport`; `createComplianceMcpServer` factory unchanged externally (adds `metadata` field); `resolveOrgId()` falls back to `'system'` when `getCurrentToolContext()` returns undefined — matching pre-Phase-28 behaviour. Regression verified: `packages/compliance/tests/cli.test.ts` + `scenarios.test.ts` = 34/34 green. |
| All test suites pass | PASS | Core 208/208, compliance 550/550, branding 75/75, LLM 255/255, dashboard 2659 passed (40 skipped, 0 failed). `tsc --noEmit` clean on all 5 packages. |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/src/mcp/index.ts` | Public export surface (5 entry points) | VERIFIED | Exports createMcpHttpPlugin, getCurrentToolContext, extractToolContext, filterToolsByPermissions, filterToolsByScope + types. |
| `packages/core/src/mcp/http-plugin.ts` | Factory with stateless transport + setRequestHandler filter | VERIFIED | `sessionIdGenerator: undefined`, single `setRequestHandler(ListToolsRequestSchema, ...)` call, AsyncLocalStorage for per-request context, 401/403 gates. |
| `packages/core/src/mcp/auth.ts` | extractToolContext reads JWT decorations, never re-verifies | VERIFIED | Reads `request.tokenPayload`, `request.orgId`, `request.authType`, `request.permissions`; throws documented error if missing. |
| `packages/core/src/mcp/tool-filter.ts` | RBAC + scope filters | VERIFIED | filterToolsByPermissions (primary), filterToolsByScope (service-to-service fallback). |
| `packages/core/src/mcp/types.ts` | Readonly ToolContext + ToolMetadata | VERIFIED | All fields readonly per immutability rule; orgId sourced from JWT. |
| `packages/compliance/src/mcp/server.ts` | 11 tools with classification + ctx.orgId | VERIFIED | 11 tools; 8 ORG-SCOPED inject `ctx.orgId`; 3 GLOBAL with explicit comments; no TODOs; no orgId in any zod schema. |
| `packages/compliance/src/mcp/metadata.ts` | 11 entries with requiredPermission | VERIFIED | 8 × compliance.view, 3 × compliance.manage (2 also destructive:true). |
| `packages/compliance/src/api/routes/mcp.ts` | registerMcpRoutes wraps @luqen/core/mcp | VERIFIED | `createMcpHttpPlugin({ mcpServer, toolMetadata, requiredScope: 'read' })` + `app.register(plugin)`. |
| `packages/branding/src/mcp/server.ts` + `api/routes/mcp.ts` | Empty stub + route | VERIFIED | `name: 'luqen-branding'`, empty metadata, `capabilities: { tools: {} }` pre-declared to satisfy SDK capability gate. |
| `packages/llm/src/mcp/server.ts` + `api/routes/mcp.ts` | Empty stub + route | VERIFIED | `name: 'luqen-llm'`, empty metadata, `capabilities: { tools: {} }`. |
| `packages/dashboard/src/mcp/server.ts` | Empty stub with tools capability | VERIFIED | `name: 'luqen-dashboard'`, `registerCapabilities({ tools: { listChanged: false } })` explicit (no registerTool calls in Phase 28). |
| `packages/dashboard/src/mcp/middleware.ts` | Bearer-only preHandler + resolveEffectivePermissions | VERIFIED | No session/user reads; resolves RBAC via dashboard's native permission resolver. |
| `packages/dashboard/src/mcp/verifier.ts` | RS256 jose.jwtVerify | VERIFIED | `importSPKI(pem, 'RS256')` + `jwtVerify(token, key, { algorithms: ['RS256'] })`; fail-fast on empty PEM. |
| `packages/dashboard/src/mcp/paths.ts` | isBearerOnlyPath exact-match predicate | VERIFIED | Exports `MCP_PATH = '/api/v1/mcp'` and `isBearerOnlyPath(path)` (exact equality). |
| `packages/dashboard/src/routes/api/mcp.ts` | Scoped register with preHandler | VERIFIED | `app.register(async (scoped) => { scoped.addHook('preHandler', createMcpAuthPreHandler(opts)); await plugin(scoped, {}); })`. |
| `packages/dashboard/src/config.ts` | jwtPublicKey field + env override | VERIFIED | ConfigSchema line 29; DashboardConfig line 69; applyEnvOverrides line 149-151 (converts `\\n` → real newlines). |

All artifacts are substantive (no stubs, no placeholders) and wired (imports resolve, usage present, runtime tests exercise behaviour).

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| MCPI-01 | 28-01, 28-02, 28-03 | User can connect to any Luqen service via Streamable HTTP MCP transport | SATISFIED | POST /api/v1/mcp registered on all 4 services (compliance :4000, branding :4100, LLM :4200, dashboard :3000); Streamable HTTP via `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`; integration tests prove 200 initialize on all four. |
| MCPI-02 | 28-01, 28-02, 28-03 | MCP endpoints validate OAuth2 RS256 JWT on every request | SATISFIED | Backend services inherit global `createAuthMiddleware` (JWT validation). Dashboard MCP uses committed RS256-only verifier via jose (`algorithms: ['RS256']`) — HS256 and alg:none explicitly rejected (verifier.test.ts). 401 before tool code runs in all four services. |
| MCPI-03 | 28-01, 28-02, 28-03 | MCP tool manifest is dynamically filtered by caller's RBAC permissions | SATISFIED | Single committed `setRequestHandler(ListToolsRequestSchema, ...)` override reads current ToolContext from AsyncLocalStorage, applies `filterToolsByPermissions` (primary) or `filterToolsByScope` (fallback). Runtime proof: compliance read-scope token sees 8 view tools, NOT compliance.manage tools. |
| MCPI-04 | 28-01, 28-02 | All MCP tool calls are pre-scoped to the caller's org from JWT claims | SATISFIED | `ToolContext.orgId` sourced from `request.orgId` set by global middleware from JWT. No tool inputSchema accepts orgId — enforced by runtime iteration test over all 11 compliance tools asserting `not.toHaveProperty('orgId')`. 8 ORG-SCOPED compliance handlers inject `ctx.orgId` into DB queries at the query layer — no deferral to Phase 29. |

No orphaned requirements (ROADMAP maps exactly MCPI-01..04 to Phase 28; all four covered by Plans 01/02/03 `requirements` frontmatter).

---

## Anti-Pattern Scan

No blockers. No TODOs or placeholder comments deferring this phase's work to later phases.

- `grep -rn "TODO(phase-29)" packages/compliance/src/mcp/` → no matches (asserted by test).
- `grep -rn "console.log" packages/core/src/mcp/ packages/compliance/src/mcp/ packages/branding/src/mcp/ packages/llm/src/mcp/ packages/dashboard/src/mcp/` → no matches (PITFALLS.md #11 stdio-safety preserved).
- `grep -rEn "orgId\s*:\s*z\." packages/compliance/src/mcp/` → no matches (no zod orgId field — enforced by D-05 and asserted by runtime test).
- `grep -rn "decodeJwt" packages/dashboard/src/mcp/` → no matches (no unsigned-decode fallback on MCP path).
- `grep -rn "request.session|request.user" packages/dashboard/src/mcp/ packages/dashboard/src/routes/api/mcp.ts` → no matches (Bearer-only invariant upheld).
- Hardcoded `'/api/v1/mcp'` bypass strings in `packages/dashboard/src/server.ts` session hooks → none; shared `isBearerOnlyPath` predicate used exclusively.

---

## Behavioural Spot-Checks

Executed locally; all passing.

| Behaviour | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Core tests green | `npx vitest run` in packages/core | 208/208 pass, 25 test files | PASS |
| Compliance tests green | `npx vitest run` in packages/compliance | 550/550 pass, 43 test files | PASS |
| Branding tests green | `npx vitest run` in packages/branding | 75/75 pass, 11 test files | PASS |
| LLM tests green | `npx vitest run` in packages/llm | 255/255 pass, 27 test files | PASS |
| Dashboard tests green | `npx vitest run` in packages/dashboard | 2659/2659 pass (40 skipped), 169 test files | PASS |
| Stdio CLI regression | `npx vitest run tests/cli.test.ts tests/scenarios.test.ts` in compliance | 34/34 pass | PASS |
| TypeScript clean | `npx tsc --noEmit` in each of core, compliance, branding, llm, dashboard | 0 errors across all 5 packages | PASS |

---

## Human Verification Required

None. The four success criteria are fully programmatically verifiable and asserted by the test suites:

- JWT-protected HTTP transport is exercised by `app.inject()` integration tests on all four services.
- Algorithm-confusion attacks (HS256, alg:none, wrong key) are covered in `verifier.test.ts`.
- RBAC manifest filtering is proven by read-token vs admin-token tools/list response diffs.
- orgId inviolability is proven by a runtime iteration over the actual registered zod schemas.

External integration with real MCP clients (Claude Desktop, MCP Inspector) is explicitly scheduled for Phase 30 (MCPT-05) per ROADMAP. Phase 28's scope ends at the transport + auth + RBAC foundation — not client-facing UAT.

---

## Gaps Summary

No gaps. Phase 28 delivers its goal: every Luqen service (compliance, branding, LLM, dashboard) exposes a secured MCP endpoint at `POST /api/v1/mcp` that enforces caller identity and org isolation before any tool is reachable. All four success criteria are verified by concrete code evidence and runtime tests. All four requirements (MCPI-01..04) are satisfied.

Intentional deviations from the original plan (documented in 28-02-SUMMARY.md and 28-03-SUMMARY.md) strengthened rather than weakened the delivery:

- 8 of 11 compliance tools were reclassified GLOBAL → ORG-SCOPED once read_first revealed the DB tables carry `org_id` columns. This caused handlers to actively filter by `ctx.orgId` at the DB layer (stronger MCPI-04 enforcement than the plan's "all GLOBAL = trivially no leakage" shortcut).
- Empty McpServer stubs (branding, LLM, dashboard) declare `capabilities: { tools: {} }` up-front so the shared plugin's `setRequestHandler(ListToolsRequestSchema)` override installs without throwing — forward-compatible with Phase 29/30 tool registration.

---

_Verified: 2026-04-16T08:45:00Z_
_Verifier: Claude (gsd-verifier, Opus 4.7 1M)_
