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
import type { DirectScanner } from '@luqen/core';
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
import { registerFleetTools, FLEET_TOOL_NAMES } from './tools/fleet.js';
import {
  registerScanTools,
  SCAN_TOOL_NAMES,
} from './tools/scan.js';
import {
  registerFixTools,
  FIX_TOOL_NAMES,
  type LlmAccess,
} from './tools/fix.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export { DASHBOARD_TOOL_METADATA } from './metadata.js';
export { DASHBOARD_RESOURCE_METADATA } from './resources.js';
export type { ComplianceAccess } from './tools/data.js';
export type { LlmAccess } from './tools/fix.js';

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
  /**
   * Resolves the live LLM service URL + bearer token per call. When omitted
   * (or returns null at runtime) dashboard_generate_fix returns an error.
   * Wired up in registerMcpRoutes from ServiceClientRegistry.getLLMClient().
   * Secret rotation is picked up per call — no cached secret.
   */
  readonly llmAccess?: LlmAccess;
  /**
   * DirectScanner instance for dashboard_scan_page. Required when
   * llmAccess is provided (scan tool registered unconditionally so it is
   * always available to agents with scans.create). Wired up in
   * registerMcpRoutes as a DirectScanner constructed from the ScanService
   * orchestrator or injected directly.
   */
  readonly scanner?: DirectScanner;
}

export async function createDashboardMcpServer(
  options: DashboardMcpServerOptions,
): Promise<{
  readonly server: McpServer;
  readonly toolNames: readonly string[];
  readonly metadata: readonly ToolMetadata[];
}> {
  const { storage, scanService, serviceConnections, complianceAccess, llmAccess, scanner } = options;

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
  registerFleetTools(server, { storage });
  // Compliance discovery tools require an access callback; without one they
  // would only ever return errors, so we skip registration entirely (RBAC
  // filtering naturally hides them since they aren't in toolNames).
  if (complianceAccess !== undefined) {
    registerComplianceTools(server, { complianceAccess });
  }
  // Agent scan tool: registered unconditionally (scanner injected per
  // registerMcpRoutes). When scanner is undefined at runtime (should not
  // happen — routes/api/mcp.ts always provides one), the tool returns an
  // error from the scanner.scan call path rather than silently missing.
  if (scanner !== undefined) {
    registerScanTools(server, { scanner });
  }
  // Agent fix tool: registered only when llmAccess is provided (mirrors
  // registerComplianceTools guard — without llmAccess the tool would only
  // return errors, so skip registration entirely; RBAC filtering naturally
  // hides it since it is not in toolNames).
  if (llmAccess !== undefined) {
    registerFixTools(server, {
      llmAccess,
      ...(complianceAccess !== undefined ? { complianceAccess } : {}),
    });
  }
  registerResources(server, { storage });
  registerPrompts(server);

  // toolNames drives the RBAC filter for tools/list and the drift test count
  // parity. Scan tool is counted when scanner is provided; fix tool counted
  // when llmAccess is provided. Conditional to stay parity-consistent with
  // what is actually registered above — any mismatch trips the drift test.
  const toolNames = [
    ...DATA_TOOL_NAMES,
    ...(complianceAccess !== undefined ? COMPLIANCE_TOOL_NAMES : []),
    ...ADMIN_TOOL_NAMES,
    ...FLEET_TOOL_NAMES,
    ...(scanner !== undefined ? SCAN_TOOL_NAMES : []),
    ...(llmAccess !== undefined ? FIX_TOOL_NAMES : []),
  ];

  return {
    server,
    toolNames,
    metadata: DASHBOARD_TOOL_METADATA,
  };
}
