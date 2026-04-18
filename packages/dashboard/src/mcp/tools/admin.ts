/**
 * registerAdminTools — Dashboard MCP admin tools (Phase 30 plan 30-03).
 *
 * This file is a STUB owned by plan 30-02; plan 30-03 replaces the empty
 * implementation with 13 admin tool registrations (MCPT-04) and extends
 * DASHBOARD_ADMIN_TOOL_METADATA with the per-tool RBAC annotations.
 *
 * Keeping the admin registration in its own file (instead of inline in
 * server.ts) is deliberate: plans 30-03, 30-04, and 30-05 can each edit
 * their own registration module without touching server.ts, which
 * eliminates merge conflicts when the three plans run in parallel.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolMetadata } from '@luqen/core/mcp';
import type { StorageAdapter } from '../../db/index.js';

export const ADMIN_TOOL_NAMES: readonly string[] = [];

export const DASHBOARD_ADMIN_TOOL_METADATA: readonly ToolMetadata[] = [];

export interface RegisterAdminToolsOptions {
  readonly storage: StorageAdapter;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerAdminTools(_server: McpServer, _opts: RegisterAdminToolsOptions): void {
  // Plan 30-03 populates this with 13 admin tool registrations wrapping
  // the existing user/org/service-connection repositories.
}
