/**
 * BRANDING_TOOL_METADATA — per-tool RBAC annotations for the 4 branding
 * MCP tools. Consumed by the shared @luqen/core/mcp HTTP plugin to filter
 * the `tools/list` response by the caller's effective permissions (D-03).
 *
 * Permission strings match ALL_PERMISSION_IDS in packages/dashboard/src/permissions.ts.
 *
 * All 4 tools are non-destructive read-path tools (MCPT-02 Phase 29 scope).
 * Brand score retrieval and write-path tools are deferred to Phase 30.
 */

import type { ToolMetadata } from '@luqen/core/mcp';

export const BRANDING_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'branding_list_guidelines', requiredPermission: 'branding.view' },
  { name: 'branding_get_guideline',   requiredPermission: 'branding.view' },
  { name: 'branding_list_sites',      requiredPermission: 'branding.view' },
  { name: 'branding_match',           requiredPermission: 'branding.view' },
];
