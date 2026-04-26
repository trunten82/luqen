# Phase 28: MCP Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 28-mcp-foundation
**Areas discussed:** MCP endpoint routing, RBAC tool filtering strategy, Org isolation enforcement, Existing MCP server upgrade path

---

## MCP Endpoint Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Per-service /api/v1/mcp | Each service gets its own MCP endpoint via fastify-mcp plugin. Matches existing per-service REST pattern. | ✓ |
| Per-service /mcp (shorter) | Simpler but breaks the existing URL convention. | |
| Single gateway on dashboard | Dashboard proxies all MCP requests. One endpoint for external clients, but adds a routing layer. | |

**User's choice:** Per-service /api/v1/mcp (Recommended)
**Notes:** Consistent with existing REST URL convention across all Luqen services.

---

## RBAC Tool Filtering Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Permission annotation per tool | Each tool registers with a required permission. Tool manifest filtered by user's effective permissions. | ✓ |
| Coarse group-based filtering | Group tools by permission group. If user has any permission in group, they see all tools. Simpler but less granular. | |
| You decide | Claude picks based on existing permission structure. | |

**User's choice:** Permission annotation per tool (Recommended)
**Notes:** Leverages existing 31-permission granularity from permissions.ts.

---

## Org Isolation Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Transport layer injection | MCP middleware extracts orgId from JWT, injects into every tool call context. No orgId parameter accepted from caller. | ✓ |
| Per-tool enforcement | Each tool handler validates orgId from JWT against its own DB queries. Risk of missing it in one tool. | |
| Both — belt and suspenders | Transport layer injects AND each tool handler validates. Defense in depth, but more code. | |

**User's choice:** Transport layer injection (Recommended)
**Notes:** Centralized enforcement prevents org isolation bypass if a tool forgets to check.

---

## Existing MCP Server Upgrade Path

| Option | Description | Selected |
|--------|-------------|----------|
| Shared MCP plugin factory | Create shared createMcpHttpPlugin() that wraps any McpServer with Streamable HTTP + auth. Each service calls it. | ✓ |
| Dual transport in each server | Each MCP server.ts adds HTTP transport alongside stdio internally. No shared code. | |
| You decide | Claude picks based on existing code patterns. | |

**User's choice:** Shared MCP plugin factory (Recommended)
**Notes:** Reduces duplication. Stdio stays for CLI usage.

---

## Claude's Discretion

- fastify-mcp vs raw SDK transport integration
- Session management strategy (stateless vs session-aware)
- Shared factory location in monorepo

## Deferred Ideas

None.
