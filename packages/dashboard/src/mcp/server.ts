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
import type { ServiceConnectionsRepository } from '../db/service-connections-repository.js';
import { VERSION } from '../version.js';
import { DASHBOARD_TOOL_METADATA } from './metadata.js';
import {
  registerDataTools,
  DATA_TOOL_NAMES,
  type ComplianceAccess,
} from './tools/data.js';
import { registerAdminTools, ADMIN_TOOL_NAMES } from './tools/admin.js';
import {
  registerComplianceTools,
  COMPLIANCE_TOOL_NAMES,
} from './tools/compliance.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export { DASHBOARD_TOOL_METADATA } from './metadata.js';
export { DASHBOARD_RESOURCE_METADATA } from './resources.js';
export type { ComplianceAccess } from './tools/data.js';

export interface DashboardMcpServerOptions {
  readonly storage: StorageAdapter;
  readonly scanService: ScanService;
  readonly serviceConnections: ServiceConnectionsRepository;
  /**
   * Resolves the live compliance service URL + bearer token per call. When
   * omitted (or returns null at runtime) the four discovery tools surface
   * a "compliance not configured" error, and dashboard_scan_site degrades
   * to an empty compliance token (matching dashboard UI behaviour). Wired
   * up in registerMcpRoutes from ServiceClientRegistry.getComplianceTokenManager().
   */
  readonly complianceAccess?: ComplianceAccess;
}

export async function createDashboardMcpServer(
  options: DashboardMcpServerOptions,
): Promise<{
  readonly server: McpServer;
  readonly toolNames: readonly string[];
  readonly metadata: readonly ToolMetadata[];
}> {
  const { storage, scanService, serviceConnections, complianceAccess } = options;

  const server = new McpServer(
    { name: 'luqen-dashboard', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerDataTools(server, {
    storage,
    scanService,
    ...(complianceAccess !== undefined ? { complianceAccess } : {}),
  });
  registerAdminTools(server, { storage, serviceConnections });
  // Compliance discovery tools require an access callback; without one they
  // would only ever return errors, so we skip registration entirely (RBAC
  // filtering naturally hides them since they aren't in toolNames).
  if (complianceAccess !== undefined) {
    registerComplianceTools(server, { complianceAccess });
  }
  registerResources(server, { storage });
  registerPrompts(server);

  const toolNames =
    complianceAccess !== undefined
      ? [...DATA_TOOL_NAMES, ...COMPLIANCE_TOOL_NAMES, ...ADMIN_TOOL_NAMES]
      : [...DATA_TOOL_NAMES, ...ADMIN_TOOL_NAMES];

  return {
    server,
    toolNames,
    metadata: DASHBOARD_TOOL_METADATA,
  };
}
