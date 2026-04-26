---
phase: 28-mcp-foundation
plan: 03
subsystem: mcp
tags:
  - mcp
  - dashboard
  - auth
  - rbac
  - rs256
  - bearer-only

requires:
  - 28-01-SUMMARY.md (@luqen/core/mcp shared plugin + types)
provides:
  - "POST /api/v1/mcp on dashboard (:3000) — Bearer-only Streamable HTTP transport"
  - "createDashboardJwtVerifier — RS256 jose.jwtVerify against DASHBOARD_JWT_PUBLIC_KEY"
  - "createMcpAuthPreHandler — Bearer-only Fastify preHandler that rejects cookie sessions (PITFALLS.md #9 CSRF defense)"
  - "createDashboardMcpServer — empty McpServer stub (name: 'luqen-dashboard', ZERO tools — Phase 30 populates)"
  - "isBearerOnlyPath(path) — shared exact-match predicate used by all three dashboard session-hook bypasses"
  - "DashboardConfig.jwtPublicKey + DASHBOARD_JWT_PUBLIC_KEY env var (literal \\n sequences converted to newlines)"
affects:
  - 28-mcp-foundation/28-02 (service quadrant — parallel wave 2)
  - 30-mcp-agent-companion (wires the dashboard tool catalogue into this endpoint)

tech-stack:
  added:
    - "@luqen/core (workspace dependency added to @luqen/dashboard)"
    - "@modelcontextprotocol/sdk@^1.27.1 (workspace dependency added to @luqen/dashboard)"
  patterns:
    - "Bearer-only Fastify preHandler — rejects any request without Authorization: Bearer ..., never reads cookie session"
    - "Scoped Fastify app.register so the MCP route does not inherit global cookie-session preHandlers"
    - "isBearerOnlyPath shared predicate — single source of truth for session-hook bypass sites"
    - "Fail-fast startup: createServer() throws DASHBOARD_JWT_PUBLIC_KEY error when PEM missing (no silent fallback)"
    - "RS256-only algorithm allowlist via jose.jwtVerify({ algorithms: ['RS256'] }) — HS256 + alg:none both rejected"
    - "Explicit tools capability registration for an empty McpServer (SDK auto-registers only via registerTool)"

key-files:
  created:
    - "packages/dashboard/src/mcp/paths.ts"
    - "packages/dashboard/src/mcp/server.ts"
    - "packages/dashboard/src/mcp/middleware.ts"
    - "packages/dashboard/src/mcp/verifier.ts"
    - "packages/dashboard/src/routes/api/mcp.ts"
    - "packages/dashboard/tests/mcp/middleware.test.ts"
    - "packages/dashboard/tests/mcp/verifier.test.ts"
    - "packages/dashboard/tests/mcp/http.test.ts"
  modified:
    - "packages/dashboard/package.json (added @luqen/core + @modelcontextprotocol/sdk deps)"
    - "packages/dashboard/src/config.ts (jwtPublicKey field + DASHBOARD_JWT_PUBLIC_KEY env override)"
    - "packages/dashboard/src/server.ts (imports + 3 isBearerOnlyPath bypass sites + MCP route registration)"
    - "package-lock.json (workspace resolution updated)"

key-decisions:
  - "Empty McpServer stub must register the 'tools' capability manually (server.server.registerCapabilities({ tools: { listChanged: false } })) — the SDK only auto-registers via registerTool, and Phase 28 ships zero tools. Without this the shared http-plugin's setRequestHandler(ListToolsRequestSchema) throws."
  - "Route registration uses Fastify's encapsulated app.register so the scoped Bearer preHandler runs INSTEAD of the three global cookie-session hooks — not in addition to them. Combined with isBearerOnlyPath bypasses in server.ts, cookie sessions never touch the MCP route."
  - "Integration tests use an injected stub verifier (tokens like 'valid-jwt' / 'bad-token') — the RS256 end-to-end path is exhaustively covered in verifier.test.ts (5 cases including HS256 confusion + alg:none + wrong-key). This keeps http.test.ts fast and focused on route composition."
  - "Bypass #1 (auth guard) requires BOTH isBearerOnlyPath AND Authorization: Bearer — a naked GET /api/v1/mcp without Bearer still hits the session guard (which redirects to /login for HTML requests) instead of short-circuiting. This matches the plan: '/api/v1/mcp without Bearer will 401 there (session fallthrough forbidden)'. Bypasses #2 and #3 do not check the header because they run AFTER the auth guard — if control reaches them, either the user is authenticated via cookie (not our case) or the Bearer preHandler is running (our case)."

requirements-completed:
  - MCPI-01
  - MCPI-02
  - MCPI-03
  - MCPI-04

metrics:
  duration: 24min
  tasks: 2
  files_created: 8
  files_modified: 4
  tests_added: 19
  completed: 2026-04-17
---

# Phase 28 Plan 03: Dashboard MCP endpoint — Summary

Dashboard exposes `POST /api/v1/mcp` over Streamable HTTP with Bearer-only authentication (RS256 jose.jwtVerify, no HS256, no unsigned, no cookie session, no shared secret); empty McpServer stub (`luqen-dashboard`, zero tools — Phase 30 scope); RBAC-filtered tools/list via `resolveEffectivePermissions`; `isBearerOnlyPath` shared predicate used by all three dashboard session-hook bypasses; startup fails loudly when `DASHBOARD_JWT_PUBLIC_KEY` is missing.

## Performance

- **Duration:** ~24 min
- **Started:** 2026-04-17T08:14:08Z
- **Completed:** 2026-04-17T08:37:53Z
- **Tasks:** 2 (both `tdd="true"` — RED tests + implementation bundled per task)
- **Files created:** 8
- **Files modified:** 4
- **Tests added:** 19 (6 middleware + 5 verifier + 8 integration)
- **Dashboard suite after changes:** 2659/2659 passing (no regressions)

## Accomplishments

### RS256 verifier path (blocker 2 fix)

```
DASHBOARD_JWT_PUBLIC_KEY env var
  → config.jwtPublicKey (applyEnvOverrides in packages/dashboard/src/config.ts)
  → createDashboardJwtVerifier(pem)
  → jose.importSPKI(pem, 'RS256') + jose.jwtVerify(token, key, { algorithms: ['RS256'] })
```

- Startup throws `DASHBOARD_JWT_PUBLIC_KEY is required ...` when PEM is empty/whitespace.
- Algorithm allowlist is `['RS256']` — HS256, alg:none, and any other algorithm are rejected by jose.
- Wrong-key tokens also rejected (verifier.test.ts "Test 5").

### Bearer-only middleware (PITFALLS.md #9)

- `createMcpAuthPreHandler` reads ONLY `request.headers.authorization`.
- Responds 401 `{ error: 'Bearer token required' }` if header missing / non-Bearer.
- Responds 401 `{ error: 'Invalid or expired token' }` on `verifyToken` rejection.
- Never reads `request.session` / `request.user` — acceptance grep confirms (returns no matches).
- Decorates request with `tokenPayload` / `authType='jwt'` / `orgId` / `permissions` in the shape the shared `extractToolContext` from `@luqen/core/mcp` expects.
- RBAC resolved via the dashboard's `resolveEffectivePermissions` — admin role short-circuits to full `ALL_PERMISSION_IDS` set.

### Session-guard bypass (W3 fix — shared predicate)

Three bypass sites in `packages/dashboard/src/server.ts` all use `isBearerOnlyPath(request.url.split('?')[0])` — exact-match on `/api/v1/mcp` only. No `/api/v1/mcp/anything` or `/api/v1/mcpfake` match:

1. **Auth guard hook** — bypasses when BOTH `isBearerOnlyPath` AND `Authorization: Bearer` present (the scoped preHandler handles auth).
2. **Org + permissions loader** — bypasses unconditionally for MCP paths (the scoped preHandler populates the same decorations).
3. **Service-token injector** — bypasses unconditionally for MCP paths (no compliance/branding token injection needed for MCP dispatch).

`grep -cE "isBearerOnlyPath\(request.url.split\('\?'\)\[0\]\)" packages/dashboard/src/server.ts` returns **3**; hardcoded `'/api/v1/mcp'` bypass strings return **0**.

### Route registration

`registerMcpRoutes(server, { verifyToken, storage })` wraps the shared `createMcpHttpPlugin` in a Fastify `app.register(async (scoped) => { ... })` so the scoped Bearer preHandler is the sole auth gate for the route. The plugin is invoked as `plugin(scoped, {})` (Fastify's 2-arg signature).

### Empty tools capability workaround

The SDK only auto-registers the `tools` capability via `McpServer.registerTool`. Since Phase 28 ships ZERO dashboard tools, `createDashboardMcpServer` declares `server.server.registerCapabilities({ tools: { listChanged: false } })` explicitly. Without this, `createMcpHttpPlugin`'s `setRequestHandler(ListToolsRequestSchema)` call throws "Server does not support tools (required for tools/list)". This was caught during Task 2 integration tests and fixed inline (Rule 3 — blocking).

## Task Commits

1. **Task 1 (MCP auth middleware, RS256 verifier, config + stub)** — `21010f6` feat
2. **Task 2 (register /api/v1/mcp + session-guard bypass + integration test)** — `68806cc` feat
3. **Docs tweak (rephrase verifier.ts comment to satisfy grep invariant)** — `3f5cff9` docs

## Example PEM block format

### Generate a local-dev keypair

```sh
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

### Env var form (single-line escape)

```sh
export DASHBOARD_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----\n"
```

The `applyEnvOverrides` in `packages/dashboard/src/config.ts` converts literal `\n` sequences to real newlines before passing to `jose.importSPKI`.

### Dashboard config JSON form (real newlines)

```json
{
  "jwtPublicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----"
}
```

## Rate-limit inheritance confirmation

Dashboard `server.ts` registers `@fastify/rate-limit` globally before the route phase. Because `registerMcpRoutes` is invoked via `server.register(async (scoped) => ...)` AFTER the global rate-limit hook is installed, the scoped context inherits the rate limit automatically — the `/api/v1/mcp` route gets the same per-IP limiter as every other route on the instance.

**Caveat:** The plan's T-28-24 mitigation note held up in code review; however, no dedicated MCP rate-limit test was added in this plan (scope: core behaviour + auth + RBAC). Rate-limit coverage for MCP specifically is recommended for Phase 29/30 when real tool catalogues introduce higher load.

## Example curl commands (against a running dashboard on :3000)

### 1. 401 — no Bearer header
```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.1"}}}'
# → 401  {"error":"Bearer token required","statusCode":401}
```

### 2. 401 — bad Bearer
```sh
curl -sS -X POST http://localhost:3000/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer tampered.token.signature' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.1"}}}'
# → 401  {"error":"Invalid or expired token","statusCode":401}
```

### 3. 401 — cookie only (no Bearer)
```sh
curl -sS -X POST http://localhost:3000/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -H 'Cookie: session=valid-in-cookie-flow' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.1"}}}'
# → 401  {"error":"Bearer token required","statusCode":401}
# (Cookie sessions are deliberately rejected — PITFALLS.md #9 CSRF defense.)
```

### 4. 200 — valid Bearer + initialize
```sh
JWT=$(generate-a-real-rs256-signed-jwt-here)
curl -sS -X POST http://localhost:3000/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $JWT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.1"}}}'
# → 200  (SSE-framed)  { ...result: { protocolVersion: '2025-11-25', serverInfo: { name: 'luqen-dashboard', ... } } }
```

### 5. 200 — tools/list empty (Phase 28 scope)
```sh
curl -sS -X POST http://localhost:3000/api/v1/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $JWT" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
# → 200  (SSE-framed)  { ...result: { tools: [] } }
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Empty `McpServer` does not register the `tools` capability**
- **Found during:** Task 2 (first `vitest run tests/mcp/http.test.ts` — 6/8 tests failed with `Error: Server does not support tools (required for tools/list)`).
- **Issue:** The SDK's `McpServer.registerTool` auto-registers the `tools` capability on first call. Phase 28 ships with ZERO dashboard tools, so the capability was never declared, and `createMcpHttpPlugin`'s `mcpServer.server.setRequestHandler(ListToolsRequestSchema, ...)` call threw in `assertRequestHandlerCapability('tools/list')` because `_capabilities.tools` was falsy.
- **Fix:** Added an explicit `server.server.registerCapabilities({ tools: { listChanged: false } })` call inside `createDashboardMcpServer` after McpServer construction. Documented the reason in a JSDoc comment.
- **Files modified:** `packages/dashboard/src/mcp/server.ts`
- **Verification:** `npx vitest run tests/mcp/http.test.ts` → 8/8 tests pass.
- **Committed in:** `68806cc` (Task 2).

**2. [Rule 1 — Bug] `jose` v6 does not export `KeyLike` as a value-level type**
- **Found during:** Task 1 (pre-test TS authoring — reading jose's `dist/types/index.d.ts`).
- **Issue:** The plan's skeleton code imported `type KeyLike` from `jose`, but `jose@6.2.2` removed that re-export (types are now `CryptoKey | KeyObject` unions). Keeping the import would fail TS compilation.
- **Fix:** Dropped the `KeyLike` type annotation — `const key = await importSPKI(pem, 'RS256')` infers the correct type directly. No behavioural change.
- **Files modified:** `packages/dashboard/src/mcp/verifier.ts`
- **Verification:** `npx tsc --noEmit` passes; all 5 verifier tests pass.
- **Committed in:** `21010f6` (Task 1).

**3. [Rule 1 — Bug] Fastify `FastifyPluginAsync` requires 2 positional arguments**
- **Found during:** Task 2 (first `tsc --noEmit` after creating `routes/api/mcp.ts`).
- **Issue:** `createMcpHttpPlugin` returns a `FastifyPluginAsync`, which has the signature `(instance, opts) => Promise<void>` — both positional arguments are required in TS even though `opts` defaults to `{}` at runtime. The plan's skeleton called `plugin(scoped)` (one arg) which failed with TS2554.
- **Fix:** Call `plugin(scoped, {})` with an empty options object.
- **Files modified:** `packages/dashboard/src/routes/api/mcp.ts`
- **Verification:** `npx tsc --noEmit` passes.
- **Committed in:** `68806cc` (Task 2).

**4. [Rule 1 — Bug] Plan acceptance grep "no `decodeJwt` in packages/dashboard/src/mcp/" was tripped by a comment reference**
- **Found during:** Overall verification sweep.
- **Issue:** The verifier's JSDoc included the literal string `decodeJwt` as part of a prose explanation ("The dashboard currently uses `decodeJwt` (unsigned decode) only during ..."). The plan's verification grep required NO matches.
- **Fix:** Rephrased the comment to say "unsigned JWT decode helper" without the literal `decodeJwt` token — prose meaning preserved.
- **Files modified:** `packages/dashboard/src/mcp/verifier.ts`
- **Verification:** `grep -rn "decodeJwt" packages/dashboard/src/mcp/` returns no matches.
- **Committed in:** `3f5cff9` (docs).

### Rule 4 — Architectural Decisions

None. All deviations were mechanical fixes (Rule 1 bug, Rule 3 blocking).

## Issues Encountered

- Pre-existing branding-package test failures when `packages/branding/dist/` is not present. These are unrelated to this plan — they occur whenever the monorepo is freshly installed without running `npm run build -w @luqen/branding` first. After building branding, the full dashboard suite (2659 tests) passes without regression.
- `package-lock.json` changed during `npm install` to add the new workspace dependencies.

## User Setup Required

To enable the dashboard MCP endpoint, the operator MUST:

1. Generate an RSA keypair (see `openssl` commands above).
2. Set `DASHBOARD_JWT_PUBLIC_KEY` env var (with `\n` escapes for newlines in the env form) OR add `jwtPublicKey` to `dashboard.config.json`.
3. Configure the token issuer (compliance or a dedicated auth server in Phase 30) to sign JWTs with the corresponding RSA private key and include `{ sub, scopes, orgId?, role? }` claims.

Without `DASHBOARD_JWT_PUBLIC_KEY`, dashboard startup fails with the error `DASHBOARD_JWT_PUBLIC_KEY must be set to enable the dashboard MCP endpoint (RS256).` — no silent fallback.

## Next Phase Readiness

- Phase 29 and 30 can now assume all four Luqen services (compliance, branding, llm, dashboard) speak MCP over Streamable HTTP with consistent security properties: Bearer JWT, RBAC-filtered `tools/list`, org isolation via JWT claims, RS256-only signature verification.
- Phase 30 (MCPT-04) populates `DASHBOARD_TOOL_METADATA` with dashboard tools. When that happens, `server.server.registerCapabilities({ tools: ... })` can be removed from `createDashboardMcpServer` — the SDK will register the capability automatically on the first `registerTool` call.
- The `isBearerOnlyPath` helper is designed to accept additional Bearer-only routes if any future API endpoint needs the same bypass; just extend the equality check.

## Self-Check: PASSED

Verified at 2026-04-17T08:37:53Z:

- `packages/dashboard/src/mcp/paths.ts` — FOUND
- `packages/dashboard/src/mcp/server.ts` — FOUND
- `packages/dashboard/src/mcp/middleware.ts` — FOUND
- `packages/dashboard/src/mcp/verifier.ts` — FOUND
- `packages/dashboard/src/routes/api/mcp.ts` — FOUND
- `packages/dashboard/tests/mcp/middleware.test.ts` — FOUND (6 tests)
- `packages/dashboard/tests/mcp/verifier.test.ts` — FOUND (5 tests)
- `packages/dashboard/tests/mcp/http.test.ts` — FOUND (8 tests)
- Commit `21010f6` — FOUND in `git log --oneline`
- Commit `68806cc` — FOUND in `git log --oneline`
- Commit `3f5cff9` — FOUND in `git log --oneline`
- `cd packages/dashboard && npx tsc --noEmit` — exit 0
- `cd packages/dashboard && npx vitest run tests/mcp/` — 19/19 tests pass (3 test files)
- `cd packages/dashboard && npx vitest run` — 2659/2659 tests pass, 40 skipped, 0 failed
- `grep -c "isBearerOnlyPath\(request.url.split\('\?'\)\[0\]\)" packages/dashboard/src/server.ts` — 3
- `grep -rn "request.session\|request.user" packages/dashboard/src/mcp/ packages/dashboard/src/routes/api/mcp.ts` — no matches
- `grep -rn "console\.log" packages/dashboard/src/mcp/ packages/dashboard/src/routes/api/mcp.ts` — no matches
- `grep -rn "decodeJwt" packages/dashboard/src/mcp/` — no matches
- `grep -n "algorithms.*RS256" packages/dashboard/src/mcp/verifier.ts` — 1 match

---
*Phase: 28-mcp-foundation, Plan 03*
*Completed: 2026-04-17*
