/**
 * createDashboardMcpServer — orchestrator for the dashboard MCP server.
 *
 * Composes four registration modules (registerDataTools, registerAdminTools,
 * registerResources, registerPrompts) into a single McpServer with all three
 * MCP capabilities (tools, resources, prompts) declared up-front.
 *
 * Plan 30-02 owns this file skeleton; plans 30-03, 30-04, 30-05 populate
 * their respective registration modules WITHOUT touching server.ts — this
 * layout is deliberate so Wave 2 can run those three plans in parallel
 * without producing conflicting diffs on the same file.
 *
 * The capability object is declared up-front in the McpServer constructor
 * (rather than registered lazily via server.server.registerCapabilities)
 * because 30-04's ListResourcesRequestSchema override and 30-05's
 * ListPromptsRequestSchema override install via setRequestHandler at plugin
 * construction time, and the SDK rejects `setRequestHandler` calls for
 * capabilities that were never declared (see 30-PATTERNS.md lines 65-74).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { StorageAdapter } from '../db/index.js';
import type { ScanService } from '../services/scan-service.js';
import { VERSION } from '../version.js';
import { DASHBOARD_TOOL_METADATA } from './metadata.js';
import { registerDataTools, DATA_TOOL_NAMES } from './tools/data.js';
import { registerAdminTools, ADMIN_TOOL_NAMES } from './tools/admin.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export { DASHBOARD_TOOL_METADATA } from './metadata.js';
export { DASHBOARD_RESOURCE_METADATA } from './resources.js';

export interface DashboardMcpServerOptions {
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
}

export async function createDashboardMcpServer(
  options: DashboardMcpServerOptions,
): Promise<{
  readonly server: McpServer;
  readonly toolNames: readonly string[];
  readonly metadata: readonly ToolMetadata[];
}> {
  const { storage, scanService } = options;

  const server = new McpServer(
    { name: 'luqen-dashboard', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerDataTools(server, { storage, scanService });
  registerAdminTools(server, { storage });
  registerResources(server, { storage });
  registerPrompts(server);

  return {
    server,
    toolNames: [...DATA_TOOL_NAMES, ...ADMIN_TOOL_NAMES],
    metadata: DASHBOARD_TOOL_METADATA,
  };
}
