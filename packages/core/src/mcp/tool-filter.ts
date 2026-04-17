/**
 * RBAC tool-manifest filters for the MCP HTTP plugin.
 *
 * Two complementary filters, both returning the subset of tool NAMES the
 * caller is allowed to see in `tools/list`:
 *
 *   - `filterToolsByPermissions` — primary RBAC filter. Used when the caller
 *     is an end user whose effective permissions are resolved from the
 *     dashboard's role repository (see
 *     `packages/dashboard/src/permissions.ts::resolveEffectivePermissions`).
 *
 *   - `filterToolsByScope` — fallback for service-to-service callers (OAuth
 *     client credentials / API keys) who have raw `read|write|admin` scopes
 *     but no RBAC permissions. Preserves the scope hierarchy already used
 *     elsewhere in Luqen (`admin` > `write` > `read`).
 *
 * D-04: Tools with no `requiredPermission` (e.g. health/version) are always
 * visible to authenticated callers — both filters short-circuit on undefined.
 */

import type { ToolMetadata } from './types.js';

export function filterToolsByPermissions(
  allTools: readonly ToolMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allTools
    .filter((t) => t.requiredPermission == null || effectivePerms.has(t.requiredPermission))
    .map((t) => t.name);
}

export function filterToolsByScope(
  allTools: readonly ToolMetadata[],
  tokenScopes: readonly string[],
): readonly string[] {
  const hasAdmin = tokenScopes.includes('admin');
  const hasWrite = tokenScopes.includes('write') || hasAdmin;
  const hasRead = tokenScopes.includes('read') || hasWrite;

  return allTools
    .filter((t) => {
      if (t.requiredPermission == null) return true;
      if (hasAdmin) return true;
      const perm = t.requiredPermission;
      // *.manage / *.delete / admin.system / admin.org require write+ scope.
      // All other permissions (e.g. *.view, reports.view) require read+ scope.
      if (
        perm.endsWith('.manage') ||
        perm.includes('.delete') ||
        perm === 'admin.system' ||
        perm === 'admin.org'
      ) {
        return hasWrite;
      }
      return hasRead;
    })
    .map((t) => t.name);
}
