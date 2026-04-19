/**
 * DASHBOARD_TOOL_METADATA — per-tool RBAC annotations for the Phase 30
 * dashboard MCP tools. Consumed by the shared @luqen/core/mcp HTTP plugin
 * to filter tools/list by the caller's effective permissions (D-07) and
 * by the Phase 31.2 per-tool runtime guard on tools/call (D-08).
 *
 * Combines two sub-metadata arrays:
 *   - DASHBOARD_DATA_TOOL_METADATA — 6 data tools (owned by plan 30-02)
 *   - DASHBOARD_ADMIN_TOOL_METADATA — 13 admin tools (owned by plan 30-03;
 *     imported from ./tools/admin.js which is stubbed empty in 30-02 and
 *     populated in 30-03 without touching server.ts or metadata.ts)
 *
 * Permission strings match ALL_PERMISSION_IDS in
 * packages/dashboard/src/permissions.ts. `destructive: true` is a UI hint
 * consumed by MCP clients that surface confirmation prompts (e.g. Claude
 * Desktop) — the HTTP plugin itself does not act on it.
 *
 * Phase 31.2 D-09 drift guard: every entry MUST declare requiredPermission.
 * Enforced by tests/mcp/tool-metadata-drift.test.ts — adding a tool without
 * a permission (or with a typo'd permission id) breaks CI.
 */

import type { ToolMetadata } from '@luqen/core/mcp';
import { DASHBOARD_ADMIN_TOOL_METADATA } from './tools/admin.js';

export const DASHBOARD_DATA_TOOL_METADATA: readonly ToolMetadata[] = [
  { name: 'dashboard_scan_site',         requiredPermission: 'scans.create',  destructive: true },
  { name: 'dashboard_list_reports',      requiredPermission: 'reports.view' },
  { name: 'dashboard_get_report',        requiredPermission: 'reports.view' },
  { name: 'dashboard_query_issues',      requiredPermission: 'reports.view' },
  { name: 'dashboard_list_brand_scores', requiredPermission: 'branding.view' },
  { name: 'dashboard_get_brand_score',   requiredPermission: 'branding.view' },
];

export const DASHBOARD_TOOL_METADATA: readonly ToolMetadata[] = [
  ...DASHBOARD_DATA_TOOL_METADATA,
  ...DASHBOARD_ADMIN_TOOL_METADATA,
];
