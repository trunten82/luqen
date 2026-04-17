/**
 * Shared path helper for Bearer-only routes on the dashboard.
 *
 * The dashboard's default authentication is cookie-session (via
 * @fastify/session). The MCP endpoint at /api/v1/mcp is the FIRST route
 * in the dashboard that uses Bearer-only auth (PITFALLS.md #9 — cookie
 * sessions on a tool-invoking endpoint expose CSRF risk). The session-guard
 * bypass in server.ts defers to the scoped Bearer preHandler on the MCP
 * route using this shared predicate — no hardcoded path strings duplicated
 * across bypass sites.
 */

export const MCP_PATH = '/api/v1/mcp' as const;

/**
 * Exact-match predicate for Bearer-only routes that must bypass the
 * dashboard's cookie-session guard and the user-dependent downstream
 * hooks (org context loader, service token injector, CSRF injector).
 *
 * Exact equality on the path portion only — does NOT match nested or
 * similar paths (e.g. /api/v1/mcp/anything, /api/v1/mcpfake).
 */
export function isBearerOnlyPath(path: string): boolean {
  return path === MCP_PATH;
}
