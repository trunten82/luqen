/**
 * LLM_TOOL_METADATA — per-tool RBAC annotations for the 4 LLM MCP tools.
 * Consumed by the shared @luqen/core/mcp HTTP plugin to filter the
 * `tools/list` response by the caller's effective permissions.
 *
 * Permission strings match ALL_PERMISSION_IDS in packages/dashboard/src/permissions.ts.
 *
 * All 4 tools are GLOBAL (no org-scoped DB reads — inputs are supplied by
 * caller, outputs are derived from the LLM provider response). orgId is
 * used only for per-org prompt overrides inside the capability executors,
 * not for data isolation.
 *
 * All 4 tools are non-destructive read-path capability invocations.
 */

import type { ToolMetadata } from '@luqen/core/mcp';

export const LLM_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'llm_generate_fix',         requiredPermission: 'llm.view' },
  { name: 'llm_analyse_report',       requiredPermission: 'llm.view' },
  { name: 'llm_discover_branding',    requiredPermission: 'llm.view' },
  { name: 'llm_extract_requirements', requiredPermission: 'llm.view' },
];
