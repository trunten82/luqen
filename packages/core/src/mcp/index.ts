/**
 * @luqen/core/mcp — public export surface.
 *
 * Used by each Luqen service (compliance, branding, LLM, dashboard) to wrap
 * its existing McpServer with a shared Streamable HTTP transport + RBAC tool
 * filter.
 *
 * Typical usage (from a service's api/server.ts):
 *
 *   const { server: mcpServer, toolMetadata } = await createXxxMcpServer({ db });
 *   const mcpPlugin = await createMcpHttpPlugin({ mcpServer, toolMetadata });
 *   await app.register(mcpPlugin);
 */

export { createMcpHttpPlugin, getCurrentToolContext } from './http-plugin.js';
export type { McpHttpPluginOptions } from './http-plugin.js';
export { extractToolContext } from './auth.js';
export {
  filterToolsByPermissions,
  filterToolsByRbac,
  filterToolsByScope,
  filterResourcesByPermissions,
  filterResourcesByScope,
} from './tool-filter.js';
export type { ResourceMetadata, ToolContext, ToolMetadata } from './types.js';
