# Phase 28: MCP Foundation - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish secured Streamable HTTP MCP endpoints with OAuth2 JWT validation, RBAC-scoped tool filtering, and org-aware tool scoping across all Luqen services. This phase delivers the transport and auth infrastructure — tool definitions for individual services come in Phases 29-30.

</domain>

<decisions>
## Implementation Decisions

### MCP Endpoint Routing
- **D-01:** Each service exposes its own MCP endpoint at `POST /api/v1/mcp`, matching the existing REST URL convention. Compliance at :4000/api/v1/mcp, branding at :4100/api/v1/mcp, LLM at :4200/api/v1/mcp, dashboard at :3000/api/v1/mcp.
- **D-02:** No gateway/proxy pattern — each service is independently addressable. External clients connect directly to the service they need.

### RBAC Tool Filtering
- **D-03:** Permission annotation per tool. Each tool registers with a `requiredPermission` field (e.g. `compliance_check` requires `compliance.view`). The tool manifest returned to callers is dynamically filtered by the user's effective permissions from `resolveEffectivePermissions(userId, orgId)`.
- **D-04:** Tools with no permission annotation are visible to all authenticated users (read-only informational tools like health/version).

### Org Isolation
- **D-05:** Org isolation enforced at the transport/middleware layer. The MCP auth middleware extracts `orgId` from the JWT and injects it into every tool call context as a read-only field. Tools never accept an `orgId` parameter from the caller — it's always from the JWT claim.
- **D-06:** Tool handlers receive `context.orgId` and use it for all DB queries. No tool can return data from another org regardless of arguments passed.

### MCP Server Upgrade Path
- **D-07:** Shared `createMcpHttpPlugin()` factory function that wraps any `McpServer` instance with Streamable HTTP transport + auth middleware. Each service calls it with their existing McpServer. Located in a shared location (likely `packages/core/src/mcp/` or a new shared MCP utilities module).
- **D-08:** Existing stdio transport remains for CLI usage. The factory adds HTTP alongside stdio, not replacing it.

### Claude's Discretion
- Whether to use `fastify-mcp@^2.1.0` plugin directly or build the Streamable HTTP integration using `@modelcontextprotocol/sdk` NodeStreamableHTTPServerTransport — Claude should evaluate which integrates better with existing Fastify patterns and auth middleware.
- Session management strategy (stateless per-request vs session-aware) — research should determine the right approach for Luqen's use case.
- Where exactly the shared factory lives in the monorepo — `packages/core/src/mcp/` vs a new shared package.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing MCP Servers (upgrade targets)
- `packages/compliance/src/mcp/server.ts` — 11 tools, stdio transport, factory pattern with McpServer
- `packages/core/src/mcp.ts` — 6 tools, stdio transport
- `packages/monitor/src/mcp/server.ts` — 3 tools, stdio transport

### Auth Infrastructure (reuse for MCP)
- `packages/compliance/src/auth/middleware.ts` — createAuthMiddleware + requireScope pattern
- `packages/compliance/src/api/server.ts` — ServerOptions interface with TokenVerifier
- `packages/llm/src/api/server.ts` — LLM service auth setup pattern
- `packages/branding/src/api/server.ts` — Branding service auth setup pattern

### RBAC System
- `packages/dashboard/src/permissions.ts` — 31 permission definitions, resolveEffectivePermissions
- `packages/dashboard/tests/db/effective-permissions.test.ts` — permission resolution tests

### Research
- `.planning/research/STACK.md` — MCP SDK versions, fastify-mcp plugin analysis
- `.planning/research/ARCHITECTURE.md` — integration architecture, data flow
- `.planning/research/PITFALLS.md` — security pitfalls, session-ID-as-auth warning

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` — already used in 3 packages
- `createAuthMiddleware()` + `requireScope()` — auth pattern consistent across all services
- `resolveEffectivePermissions(userId, orgId)` — returns Set<string> of permission IDs
- `TokenVerifier` interface — standardized JWT verification across services
- `z` (zod) — already used for MCP tool input schemas

### Established Patterns
- Factory function per service: `createComplianceMcpServer(options)` returns `{ server, toolNames }`
- Tools registered via `server.registerTool(name, { description, inputSchema }, handler)`
- Tool responses use `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
- Auth middleware decorates Fastify request with verified token claims

### Integration Points
- Each service's `server.ts` (Fastify app factory) — where the MCP plugin would be registered
- Each service's CLI — where stdio MCP transport is currently wired
- `packages/dashboard/src/server.ts` — where dashboard MCP endpoint would be added

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Key constraint: the shared factory must work identically across all 5 services with minimal per-service configuration.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 28-mcp-foundation*
*Context gathered: 2026-04-16*
