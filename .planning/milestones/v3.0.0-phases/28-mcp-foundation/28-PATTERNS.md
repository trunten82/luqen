# Phase 28: MCP Foundation - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/core/src/mcp/http-plugin.ts` (NEW — shared factory) | plugin/factory | request-response (streamable HTTP) | `packages/compliance/src/api/server.ts` (plugin composition) + `packages/compliance/src/mcp/server.ts` (McpServer factory) | role-match (new abstraction) |
| `packages/core/src/mcp/auth.ts` (NEW — MCP auth wrapper) | middleware | request-response | `packages/compliance/src/auth/middleware.ts` | exact |
| `packages/core/src/mcp/tool-filter.ts` (NEW — RBAC manifest filter) | utility/middleware | request-response | `packages/dashboard/src/permissions.ts` + `packages/compliance/src/auth/scopes.ts` | role-match |
| `packages/core/src/mcp/types.ts` (NEW — ToolContext, ToolMetadata) | model/types | n/a | `packages/compliance/src/auth/oauth.ts` (TokenPayload interface) | role-match |
| `packages/compliance/src/api/server.ts` (MODIFIED — wire /api/v1/mcp) | controller/bootstrap | request-response | self — pattern already established for REST routes | exact |
| `packages/branding/src/api/server.ts` (MODIFIED — wire /api/v1/mcp) | controller/bootstrap | request-response | `packages/compliance/src/api/server.ts` | exact |
| `packages/llm/src/api/server.ts` (MODIFIED — wire /api/v1/mcp) | controller/bootstrap | request-response | `packages/compliance/src/api/server.ts` | exact |
| `packages/dashboard/src/server.ts` (MODIFIED — wire /api/v1/mcp) | controller/bootstrap | request-response | `packages/dashboard/src/server.ts` (self; register next to auth guard) | exact |
| `packages/compliance/src/mcp/server.ts` (MODIFIED — tool handlers receive context.orgId) | service/tool-registry | event-driven (tool invocations) | self — existing factory `createComplianceMcpServer` | exact |

**Scope note on existing MCP factories:** `packages/core/src/mcp.ts` (uses `mcpServer.tool(...)` positional API) and `packages/monitor/src/mcp/server.ts` are out of Phase 28 scope per CONTEXT.md D-01 (compliance, branding, LLM, dashboard are the HTTP-exposed services). The shared factory is still designed so either could opt in later.

---

## Pattern Assignments

### `packages/core/src/mcp/http-plugin.ts` (NEW — shared `createMcpHttpPlugin()` factory)

**Purpose:** Wrap any `McpServer` instance with a Fastify route at `POST /api/v1/mcp` using `NodeStreamableHTTPServerTransport` (stateless, per-request) + auth middleware + RBAC tool filter. Single factory called by all four services.

**Analog 1 — McpServer factory signature to replicate:** `packages/compliance/src/mcp/server.ts` lines 27–50
```typescript
// packages/compliance/src/mcp/server.ts:27-50
export interface McpServerOptions {
  readonly dbPath?: string;
  readonly db?: DbAdapter;
}

export async function createComplianceMcpServer(
  options: McpServerOptions = {},
): Promise<{ server: McpServer; toolNames: readonly string[] }> {
  // Initialize the DB adapter
  let db: DbAdapter;
  if (options.db != null) {
    db = options.db;
  } else {
    const dbPath = options.dbPath ?? process.env.COMPLIANCE_DB_PATH ?? './compliance.db';
    db = new SqliteAdapter(dbPath);
  }
  await db.initialize();

  const server = new McpServer({
    name: 'luqen-compliance',
    version: '1.0.0',
  });
```

**Pattern to copy:** async factory, options interface with `readonly` fields, returns plain object. `createMcpHttpPlugin()` should follow the same shape:

```typescript
export interface McpHttpPluginOptions {
  readonly mcpServer: McpServer;              // built by each service's own factory
  readonly toolNames: readonly string[];
  readonly toolMetadata: ReadonlyMap<string, ToolMetadata>; // requiredPermission per tool
  readonly requiredScope?: Scope;             // defaults to 'read'
}
export async function createMcpHttpPlugin(options: McpHttpPluginOptions): Promise<FastifyPluginAsync>
```

**Analog 2 — Fastify route registration pattern (from ARCHITECTURE.md + existing REST routes):** `packages/compliance/src/api/routes/health.ts` lines 1–25
```typescript
// packages/compliance/src/api/routes/health.ts:1-25
import type { FastifyInstance } from 'fastify';
import { VERSION } from '../../version.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', { ... }, async (_request, reply) => {
    await reply.status(200).send({ ... });
  });
}
```

**Pattern to copy:** `registerXxxRoutes(app, ...deps)` signature, direct route registration at `/api/v1/*`, no plugin boundary. The MCP plugin should follow the same: `registerMcpRoutes(app, opts)` posting to `/api/v1/mcp`.

**Analog 3 — Streamable HTTP transport wiring (from ARCHITECTURE.md lines 91–106, derived from MCP SDK docs):**
```typescript
// Derived pattern — NOT yet in codebase, documented in ARCHITECTURE.md
app.post('/api/v1/mcp', { config: { rawBody: true } }, async (request, reply) => {
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,     // stateless, per-request (Anti-Pattern #1 in ARCHITECTURE.md)
  });
  await mcpServer.connect(transport);
  reply.raw.on('close', () => { transport.close(); });
  await transport.handleRequest(request.raw, reply.raw, request.body);
});
```

**Key invariants from PITFALLS.md:**
- One `McpServer` per service (shared across requests) — ARCHITECTURE.md Anti-Pattern #1
- One transport per request (stateless) — PITFALLS.md Pitfall 1, 5
- All logging to `stderr` (never `console.log` on stdio-enabled builds) — PITFALLS.md Pitfall 11

---

### `packages/core/src/mcp/auth.ts` (NEW — MCP auth middleware)

**Analog:** `packages/compliance/src/auth/middleware.ts` — this is the exact reuse target per CONTEXT.md D-05.

**Imports pattern** (lines 1–8):
```typescript
// packages/compliance/src/auth/middleware.ts:1-8
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { TokenVerifier, TokenPayload } from './oauth.js';
import { scopeCoversEndpoint } from './scopes.js';
import type { Scope } from './scopes.js';

// Paths that skip authentication entirely
const PUBLIC_PATHS = ['/api/v1/health', '/api/v1/openapi.json', '/api/v1/docs', '/api/v1/oauth/token', '/api/v1/oauth/revoke'];
```

**Core auth pattern to reuse** (lines 16–71): `createAuthMiddleware(verifier)` is already a Fastify preHandler. The MCP plugin should NOT reimplement — it should register the **existing** `authMiddleware` as a preHandler on the `/api/v1/mcp` route only, because the global `app.addHook('preHandler', authMiddleware)` in each `api/server.ts` already wraps MCP (MCP lives at `/api/v1/mcp` which is NOT in PUBLIC_PATHS, so it auto-inherits).

**JWT → orgId extraction** (lines 50–66):
```typescript
// packages/compliance/src/auth/middleware.ts:50-66
// JWT authentication
const token = authHeader.slice(7);
try {
  const payload = await verifier(token);
  (request as FastifyRequest & { tokenPayload: TokenPayload }).tokenPayload = payload;
  (request as FastifyRequest & { authType: string }).authType = 'jwt';
  // JWT orgId takes priority. If JWT has admin scope but no orgId
  // (system service token used on behalf of an org), honor X-Org-Id
  // header as secondary context. Non-admin JWTs cannot override org.
  let jwtOrgId = payload.orgId ?? 'system';
  if (jwtOrgId === 'system' && payload.scopes.includes('admin')) {
    const headerOrgId = request.headers['x-org-id'];
    const headerVal = Array.isArray(headerOrgId) ? headerOrgId[0] : headerOrgId;
    if (headerVal && headerVal !== 'system') {
      jwtOrgId = headerVal;
    }
  }
  (request as FastifyRequest & { orgId: string }).orgId = jwtOrgId;
} catch {
  await reply.status(401).send({ error: 'Invalid or expired token', statusCode: 401 });
}
```

**Pattern to copy:** The MCP plugin's job is to read `request.tokenPayload` and `request.orgId` (already populated by the existing middleware) and thread them into the tool handler context. This is the D-05 “inject orgId into every tool call context” — it is **read** from the request, not re-verified.

**requireScope pattern** (lines 73–87) — applied as preHandler on the MCP route to enforce minimum scope (likely `'read'`):
```typescript
// packages/compliance/src/auth/middleware.ts:73-87
export function requireScope(scope: Scope) {
  return async function scopeMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const payload = (request as FastifyRequest & { tokenPayload?: TokenPayload }).tokenPayload;
    if (payload == null) {
      await reply.status(401).send({ error: 'Not authenticated', statusCode: 401 });
      return;
    }
    if (!scopeCoversEndpoint(payload.scopes, scope)) {
      await reply.status(403).send({ error: `Insufficient scope. Required: ${scope}`, statusCode: 403 });
    }
  };
}
```

**TokenPayload shape (authoritative)** — `packages/compliance/src/auth/oauth.ts` lines 11–17:
```typescript
// packages/compliance/src/auth/oauth.ts:11-17
export interface TokenPayload {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId?: string;
  readonly iat?: number;
  readonly exp?: number;
}
```

---

### `packages/core/src/mcp/tool-filter.ts` (NEW — RBAC manifest filter)

**Purpose:** Implement D-03 — filter the tool manifest returned to a caller by the caller's effective permissions.

**Analog 1 — permission resolution:** `packages/dashboard/src/permissions.ts` lines 82–94
```typescript
// packages/dashboard/src/permissions.ts:82-94
export async function resolveEffectivePermissions(
  roleRepository: { getEffectivePermissions(userId: string, orgId?: string): Promise<Set<string>> },
  userId: string,
  userRole: string,
  orgId?: string,
): Promise<Set<string>> {
  // Admin users get all permissions regardless of org context
  if (userRole === 'admin') {
    return new Set(ALL_PERMISSION_IDS);
  }

  return roleRepository.getEffectivePermissions(userId, orgId);
}
```

**Pattern to copy:** Returns `Set<string>` of permission IDs. Tool filter should accept this Set and test each tool's `requiredPermission` against it:

```typescript
// Proposed shape for tool-filter.ts
export interface ToolMetadata {
  readonly name: string;
  readonly requiredPermission?: string; // D-04: undefined = visible to all authenticated users
}

export function filterToolsByPermissions(
  allTools: readonly ToolMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allTools
    .filter(t => t.requiredPermission == null || effectivePerms.has(t.requiredPermission))
    .map(t => t.name);
}
```

**Analog 2 — scope hierarchy gate (for scope-based fallback when no RBAC is available, e.g., service-to-service):** `packages/compliance/src/auth/scopes.ts` lines 17–28
```typescript
// packages/compliance/src/auth/scopes.ts:17-28
export function scopeCoversEndpoint(
  tokenScopes: readonly string[],
  requiredScope: Scope,
): boolean {
  for (const scope of tokenScopes) {
    const covered = SCOPE_HIERARCHY[scope as Scope];
    if (covered && covered.includes(requiredScope)) {
      return true;
    }
  }
  return false;
}
```

**Pattern to copy:** For service-to-service MCP callers (no user — just a scoped OAuth client), the tool filter should fall back to `scopeCoversEndpoint` — admin scope sees all tools, write scope sees read+write tools, read scope sees read-only tools.

**D-04 rule:** Tools without `requiredPermission` are always visible (health/version tools). The filter short-circuits on `requiredPermission == null`.

**Permission IDs already defined** (`packages/dashboard/src/permissions.ts` lines 8–40) — these are the exact strings tools should annotate with:
- `compliance.view` / `compliance.manage` — for compliance_* tools
- `branding.view` / `branding.manage` — for branding_* tools
- `llm.view` / `llm.manage` — for llm_* tools
- `scans.create`, `reports.view`, `reports.delete`, `admin.org`, `admin.system` — for dashboard_* tools

---

### `packages/core/src/mcp/types.ts` (NEW — ToolContext + ToolMetadata)

**Analog:** `packages/compliance/src/auth/oauth.ts` lines 11–29
```typescript
// packages/compliance/src/auth/oauth.ts:11-29
export interface TokenPayload {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export interface SignTokenInput {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly expiresIn: string;
  readonly role?: string;
  readonly username?: string;
  readonly orgId?: string;
}

export type TokenSigner = (input: SignTokenInput) => Promise<string>;
export type TokenVerifier = (token: string) => Promise<TokenPayload>;
```

**Pattern to copy:** Use `readonly` fields on all interfaces (immutability rule from CLAUDE.md). ToolContext should include:
```typescript
export interface ToolContext {
  readonly orgId: string;           // D-05: read-only, from JWT — tools never receive from args
  readonly userId: string;          // payload.sub
  readonly scopes: readonly string[];
  readonly permissions: ReadonlySet<string>; // resolved from RBAC (dashboard) or empty (service-to-service)
  readonly authType: 'jwt' | 'apikey';
}

export interface ToolMetadata {
  readonly name: string;
  readonly requiredPermission?: string;
  readonly destructive?: boolean;   // PITFALLS.md #10 — confirmation UI hint
}
```

---

### `packages/compliance/src/api/server.ts` (MODIFIED — register MCP plugin)

**Analog:** self — the pattern for registering route groups is already established.

**Imports + route registration pattern** (lines 10–22, 157–171):
```typescript
// packages/compliance/src/api/server.ts:10-22
import { createAuthMiddleware, requireScope } from '../auth/middleware.js';
import type { ComplianceCache } from '../cache/redis.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerJurisdictionRoutes } from './routes/jurisdictions.js';
// ... more route imports

// packages/compliance/src/api/server.ts:157-171
// Register all route groups
await registerHealthRoutes(app);
await registerOAuthRoutes(app, { db, signToken, tokenExpiry });
await registerJurisdictionRoutes(app, db);
// ...
await registerWcagCriteriaRoutes(app, db);
```

**Global auth hook already in place** (lines 130–147):
```typescript
// packages/compliance/src/api/server.ts:130-147
// Global auth middleware — applied after each route's preHandler chain
const authMiddleware = createAuthMiddleware(verifyToken);
app.addHook('preHandler', authMiddleware);

// Decorate request with orgId from X-Org-Id header and authType
app.decorateRequest('orgId', 'system');
app.decorateRequest('authType', '');
app.addHook('preHandler', async (request) => {
  // Only accept X-Org-Id when authenticated via API key (service-to-service),
  // not from regular JWT tokens — prevents users from spoofing org context.
  const authType = (request as unknown as { authType: string }).authType;
  if (authType !== 'apikey') return;

  const headerVal = request.headers['x-org-id'];
  if (typeof headerVal === 'string' && headerVal.length > 0) {
    (request as unknown as { orgId: string }).orgId = headerVal;
  }
});
```

**Pattern to copy:** Add a single line alongside the existing `await registerXxxRoutes(...)` calls:
```typescript
// NEW line alongside existing route registrations
const { server: mcpServer, toolNames } = await createComplianceMcpServer({ db });
await registerMcpRoutes(app, { mcpServer, toolNames, toolMetadata: COMPLIANCE_TOOL_METADATA });
```

`registerMcpRoutes` wraps the plugin from `@luqen/core/mcp/http-plugin` — auth is inherited from the global hook, orgId is read from `request.orgId`, tool filter runs per-request.

---

### `packages/branding/src/api/server.ts` (MODIFIED — register MCP plugin)

**Analog:** `packages/compliance/src/api/server.ts` — exact mirror.

**Existing pattern** (`packages/branding/src/api/server.ts` lines 87–101):
```typescript
// packages/branding/src/api/server.ts:87-101
// Auth middleware
const authMiddleware = createAuthMiddleware(verifyToken);
app.addHook('preHandler', authMiddleware);

// Decorate request with orgId + authType
app.decorateRequest('orgId', 'system');
app.decorateRequest('authType', '');
app.addHook('preHandler', async (request) => {
  const authType = (request as unknown as { authType: string }).authType;
  if (authType !== 'apikey') return;
  const headerVal = request.headers['x-org-id'];
  if (typeof headerVal === 'string' && headerVal.length > 0) {
    (request as unknown as { orgId: string }).orgId = headerVal;
  }
});
```

**Pattern to copy:** Branding service has no existing MCP factory — Phase 28 does NOT add branding tools (per CONTEXT.md scope: "tool definitions for individual services come in Phases 29–30"). Phase 28 only wires an **empty** MCP server or a placeholder stub (name: 'luqen-branding') at `/api/v1/mcp` so the transport + auth is testable. Tool population is Phase 29/30.

Same note applies to `packages/llm/src/api/server.ts` (lines 100–117 — identical auth wiring pattern).

---

### `packages/llm/src/api/server.ts` (MODIFIED — register MCP plugin)

**Analog:** `packages/compliance/src/api/server.ts` — exact mirror.

**Existing pattern** (`packages/llm/src/api/server.ts` lines 100–117):
```typescript
// packages/llm/src/api/server.ts:100-117
// Global auth middleware
const authMiddleware = createAuthMiddleware(verifyToken);
app.addHook('preHandler', authMiddleware);

// Decorate request with orgId and authType defaults
app.decorateRequest('orgId', 'system');
app.decorateRequest('authType', '');

// Second preHandler: apply X-Org-Id only for API key auth
app.addHook('preHandler', async (request) => {
  const authType = (request as unknown as { authType: string }).authType;
  if (authType !== 'apikey') return;

  const headerVal = request.headers['x-org-id'];
  if (typeof headerVal === 'string' && headerVal.length > 0) {
    (request as unknown as { orgId: string }).orgId = headerVal;
  }
});
```

**Pattern to copy:** Insert `registerMcpRoutes(app, { ... })` after `registerPromptRoutes(app, db)` on line 135.

---

### `packages/dashboard/src/server.ts` (MODIFIED — register MCP plugin)

**Analog:** self — register MCP endpoint alongside existing API routes.

**Key existing pattern — RBAC resolution already runs in preHandler** (lines 600–647):
```typescript
// packages/dashboard/src/server.ts:640-647
// 2. Resolve permissions WITH org context
const permissions = await resolveEffectivePermissions(
  storage.roles,
  request.user.id,
  request.user.role,
  request.user.currentOrgId,
);
(request as unknown as Record<string, unknown>)['permissions'] = permissions;
```

**Pattern to copy:** The dashboard already populates `request.permissions` as a `Set<string>`. The MCP plugin on dashboard must read this set, not re-resolve — this is the RBAC hand-off point per D-03.

**Dashboard-specific difference:** dashboard auth is session-based (not just JWT), so the MCP plugin needs a branch: if `request.user` is present (session) use `request.permissions`; if only `request.tokenPayload` is present (MCP client with OAuth2), fall back to scope-based filtering via `scopeCoversEndpoint`. The dashboard MCP endpoint at `/api/v1/mcp` should use Bearer-only auth per PITFALLS.md #9 (CSRF concern) — cookie session must NOT be accepted on the MCP endpoint.

---

### `packages/compliance/src/mcp/server.ts` (MODIFIED — tool handlers accept context.orgId)

**Analog:** self — update each existing tool to accept `context` as a second argument to the handler.

**Current tool handler shape** (`packages/compliance/src/mcp/server.ts` lines 53–85):
```typescript
// packages/compliance/src/mcp/server.ts:53-85
server.registerTool(
  'compliance_check',
  {
    description: 'Check pa11y accessibility issues against jurisdiction legal requirements',
    inputSchema: z.object({
      jurisdictions: z.array(z.string()).describe('List of jurisdiction IDs to check (e.g. ["EU", "US"])'),
      issues: z.array(...).describe('Pa11y issues to check'),
      includeOptional: z.boolean().optional().describe('Include optional requirements (default: false)'),
      sectors: z.array(z.string()).optional().describe('Filter regulations by sector'),
    }),
  },
  async (args) => {
    const result = await checkCompliance(
      {
        jurisdictions: args.jurisdictions,
        issues: args.issues,
        ...
      },
      db,
    );
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },
);
```

**Pattern to copy (D-05, D-06):** Handler signature must change to receive `ToolContext` as the second argument — `orgId` comes from context, NEVER from `args`:
```typescript
// NEW pattern — orgId removed from inputSchema, pulled from context
async (args, _extra, context: ToolContext) => {
  const result = await checkCompliance(
    {
      jurisdictions: args.jurisdictions,
      issues: args.issues,
      orgId: context.orgId,   // read-only from JWT, not args
      ...
    },
    db,
  );
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
```

**Error handling pattern to preserve** (lines 147–157):
```typescript
// packages/compliance/src/mcp/server.ts:147-157
async (args) => {
  const regulation = await db.getRegulation(args.id);
  if (regulation == null) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Regulation "${args.id}" not found` }) }],
      isError: true,
    };
  }
  ...
}
```

**Alt error pattern from `packages/core/src/mcp.ts` lines 98–109 (try/catch):**
```typescript
// packages/core/src/mcp.ts:98-109
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message }),
      },
    ],
    isError: true,
  };
}
```

**Tool response shape (preserve exactly):** `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }` — this is consistent across all three existing MCP servers and must not change.

**Tool metadata registration (NEW):** Alongside `TOOL_NAMES`, add a `TOOL_METADATA` map so the plugin can filter on permission:
```typescript
// Proposed addition to packages/compliance/src/mcp/server.ts
export const COMPLIANCE_TOOL_METADATA: ReadonlyMap<string, ToolMetadata> = new Map([
  ['compliance_check', { name: 'compliance_check', requiredPermission: 'compliance.view' }],
  ['compliance_list_jurisdictions', { name: 'compliance_list_jurisdictions', requiredPermission: 'compliance.view' }],
  ['compliance_list_regulations', { name: 'compliance_list_regulations', requiredPermission: 'compliance.view' }],
  ['compliance_list_requirements', { name: 'compliance_list_requirements', requiredPermission: 'compliance.view' }],
  ['compliance_get_regulation', { name: 'compliance_get_regulation', requiredPermission: 'compliance.view' }],
  ['compliance_propose_update', { name: 'compliance_propose_update', requiredPermission: 'compliance.manage' }],
  ['compliance_get_pending', { name: 'compliance_get_pending', requiredPermission: 'compliance.view' }],
  ['compliance_approve_update', { name: 'compliance_approve_update', requiredPermission: 'compliance.manage', destructive: true }],
  ['compliance_list_sources', { name: 'compliance_list_sources', requiredPermission: 'compliance.view' }],
  ['compliance_add_source', { name: 'compliance_add_source', requiredPermission: 'compliance.manage' }],
  ['compliance_seed', { name: 'compliance_seed', requiredPermission: 'compliance.manage', destructive: true }],
]);
```

---

## Shared Patterns

### Authentication (reuse across all four services)
**Source:** `packages/compliance/src/auth/middleware.ts` lines 16–71
**Apply to:** compliance, branding, llm api/server.ts (already applied globally); dashboard needs branch for session vs Bearer

The existing `createAuthMiddleware(verifyToken)` runs on every request including `/api/v1/mcp` because MCP is NOT in `PUBLIC_PATHS`. No new middleware needed in the services — the MCP plugin **inherits** auth by route position.

**Critical:** The MCP plugin must NOT re-verify the JWT — it reads `request.tokenPayload` and `request.orgId` that the existing middleware already populates. This avoids double verification + timing attacks.

### Fastify plugin composition order
**Source:** `packages/compliance/src/api/server.ts` lines 84–171
**Apply to:** All four services

Order (must preserve):
1. `cors` register
2. `rateLimit` register
3. `swagger` register
4. `swaggerUi` register
5. `createAuthMiddleware` as global `preHandler`
6. `decorateRequest('orgId', 'system')` + `decorateRequest('authType', '')`
7. Second `preHandler` for X-Org-Id override (API-key only)
8. `db.initialize()`
9. `await registerXxxRoutes(app, ...)` — **MCP plugin registers here, after auth, alongside REST routes**

### MCP tool factory signature
**Source:** `packages/compliance/src/mcp/server.ts` lines 34–50
**Apply to:** All service-level MCP factories (compliance already matches; branding, llm, dashboard should copy)

```typescript
export async function createXxxMcpServer(
  options: XxxMcpServerOptions = {},
): Promise<{ server: McpServer; toolNames: readonly string[]; metadata: ReadonlyMap<string, ToolMetadata> }>
```

Phase 28 evolves this signature to also return `metadata` so the HTTP plugin can filter.

### Tool response envelope
**Source:** `packages/compliance/src/mcp/server.ts` lines 83, 99, 116, 133, 155, 188, 202, 217, 230, 248, 267; `packages/core/src/mcp.ts` lines 90–97
**Apply to:** Every tool handler, every service

```typescript
return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
// On error:
return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
```

### Zod schema for tool inputs
**Source:** `packages/compliance/src/mcp/server.ts` lines 57–71 and throughout; `packages/core/src/mcp.ts` lines 34–44
**Apply to:** Every tool's `inputSchema`

```typescript
inputSchema: z.object({
  someField: z.string().describe('Human-readable description shown to LLM'),
  optional: z.enum(['a', 'b']).optional(),
})
```

Every field must have `.describe('...')` — this populates the MCP manifest shown to the LLM. D-05 invariant: no tool's inputSchema may include an `orgId` field.

### Request-scoped context extraction
**Source:** `packages/compliance/src/auth/middleware.ts` lines 53–66; `packages/dashboard/src/server.ts` lines 640–646
**Apply to:** MCP plugin's per-tool-call wrapper

```typescript
// Inside the /api/v1/mcp route handler, before dispatching tool
const payload = (request as FastifyRequest & { tokenPayload?: TokenPayload }).tokenPayload;
const orgId = (request as FastifyRequest & { orgId: string }).orgId;
const authType = (request as FastifyRequest & { authType: string }).authType;
const permissions = (request as unknown as { permissions?: Set<string> }).permissions ?? new Set<string>();

const context: ToolContext = {
  orgId,
  userId: payload?.sub ?? 'anonymous',
  scopes: payload?.scopes ?? [],
  permissions,
  authType: authType === 'apikey' ? 'apikey' : 'jwt',
};
```

### Route path convention
**Source:** `packages/compliance/src/api/routes/health.ts` line 5; CONTEXT.md D-01
**Apply to:** All four services

All MCP endpoints at `POST /api/v1/mcp` (not `/mcp` — the `/api/v1/` prefix is mandatory per memory `feedback_service_routes_prefix.md`).

---

## No Analog Found

None. Every new file has a close existing pattern in the codebase.

---

## Metadata

**Analog search scope:**
- `packages/compliance/src/mcp/**`
- `packages/compliance/src/auth/**`
- `packages/compliance/src/api/**`
- `packages/branding/src/api/**`
- `packages/llm/src/api/**`
- `packages/dashboard/src/permissions.ts`
- `packages/dashboard/src/server.ts`
- `packages/core/src/mcp.ts`
- `packages/monitor/src/mcp/**`

**Files scanned:** 14
**Pattern extraction date:** 2026-04-16
