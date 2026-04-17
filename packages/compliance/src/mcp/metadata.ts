/**
 * COMPLIANCE_TOOL_METADATA — per-tool RBAC annotations for the 11 compliance
 * MCP tools. Consumed by the shared @luqen/core/mcp HTTP plugin to filter the
 * `tools/list` response by the caller's effective permissions (D-03).
 *
 * Permission strings match ALL_PERMISSION_IDS in packages/dashboard/src/permissions.ts.
 *
 * The destructive flag (see MCP SDK docs) is set on tools that mutate or
 * discard shared reference data (approve + seed). The flag is a UI hint for
 * wave-2 dashboards (PITFALLS.md #10) — the plugin itself does not act on it.
 */

import type { ToolMetadata } from '@luqen/core/mcp';

export const COMPLIANCE_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'compliance_check',               requiredPermission: 'compliance.view' },
  { name: 'compliance_list_jurisdictions',  requiredPermission: 'compliance.view' },
  { name: 'compliance_list_regulations',    requiredPermission: 'compliance.view' },
  { name: 'compliance_list_requirements',   requiredPermission: 'compliance.view' },
  { name: 'compliance_get_regulation',      requiredPermission: 'compliance.view' },
  { name: 'compliance_propose_update',      requiredPermission: 'compliance.manage' },
  { name: 'compliance_get_pending',         requiredPermission: 'compliance.view' },
  { name: 'compliance_approve_update',      requiredPermission: 'compliance.manage', destructive: true },
  { name: 'compliance_list_sources',        requiredPermission: 'compliance.view' },
  { name: 'compliance_add_source',          requiredPermission: 'compliance.manage' },
  { name: 'compliance_seed',                requiredPermission: 'compliance.manage', destructive: true },
];
