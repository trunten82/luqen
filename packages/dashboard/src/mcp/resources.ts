/**
 * registerResources — Dashboard MCP Resources (Phase 30 plan 30-04).
 *
 * Plan 30-04 replaces the stub below with scan://report/{id} +
 * brand://score/{siteUrl} ResourceTemplate registrations (MCPI-05).
 *
 * Note on ResourceMetadata typing: plan 30-01 (Wave 1, parallel) extends
 * @luqen/core/mcp with an exported `ResourceMetadata` interface plus
 * `filterResourcesByPermissions` / `filterResourcesByScope` helpers. Until
 * the core changes land, we declare a locally-compatible shape here so
 * this stub compiles in isolation; the named import from '@luqen/core/mcp'
 * will replace this local type after 30-01's branch is merged.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StorageAdapter } from '../db/index.js';

/**
 * Local placeholder for the ResourceMetadata interface that plan 30-01
 * adds to @luqen/core/mcp. Shape mirrors ToolMetadata: a URI scheme plus
 * an optional required permission string. Replace `export interface
 * ResourceMetadata { ... }` with `import type { ResourceMetadata } from
 * '@luqen/core/mcp'` once the core types land (Rule 3 cross-plan fix).
 */
export interface ResourceMetadata {
  readonly uriScheme: string;
  readonly requiredPermission?: string;
}

export const DASHBOARD_RESOURCE_METADATA: readonly ResourceMetadata[] = [];

export interface RegisterResourcesOptions {
  readonly storage: StorageAdapter;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerResources(_server: McpServer, _opts: RegisterResourcesOptions): void {
  // Plan 30-04 populates this with scan://report/{id} + brand://score/{siteUrl}
  // ResourceTemplate registrations, pulling the list via storage.scans and
  // storage.brandScores for the caller's org.
}
