/**
 * Shared types for the MCP HTTP plugin foundation (@luqen/core/mcp).
 *
 * These types are the security-critical contract between the shared plugin
 * factory and each service's tool handlers. All fields are `readonly` — per
 * project immutability rules — because ToolContext flows into tool handlers
 * that must not be able to mutate the caller's identity or org context.
 *
 * See .planning/phases/28-mcp-foundation/28-CONTEXT.md (D-03, D-04, D-05)
 * for the decisions these types encode.
 */

/**
 * Per-request context injected into every tool handler by the MCP HTTP plugin.
 *
 * D-05: `orgId` is ALWAYS sourced from the authenticated JWT claim (surfaced on
 * the Fastify request as `request.orgId` by the global auth middleware). Tools
 * MUST NOT accept an `orgId` parameter via their inputSchema — the caller's org
 * is authoritative and read-only here.
 */
export interface ToolContext {
  readonly orgId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly authType: 'jwt' | 'apikey';
}

/**
 * Per-tool metadata annotated by each service when registering tools.
 *
 * D-03: `requiredPermission` gates visibility in the `tools/list` response —
 * callers without the permission in their effective permission set will not
 * see the tool at all.
 *
 * D-04: A tool with `requiredPermission` unset (undefined) is visible to all
 * authenticated callers (health/version-style informational tools).
 *
 * `destructive` (PITFALLS.md #10) is a UI hint for confirmation dialogs in
 * wave-2 dashboards; the plugin does not act on it directly.
 */
export interface ToolMetadata {
  readonly name: string;
  readonly requiredPermission?: string;
  readonly destructive?: boolean;
}
