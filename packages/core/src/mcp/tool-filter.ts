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

import type { ResourceMetadata, ToolMetadata } from './types.js';

export function filterToolsByPermissions(
  allTools: readonly ToolMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allTools
    .filter((t) => t.requiredPermission == null || effectivePerms.has(t.requiredPermission))
    .map((t) => t.name);
}

/**
 * Phase 31.2 D-07 — RBAC filter composed with `filterToolsByScope` in
 * http-plugin.ts. Semantics are identical to `filterToolsByPermissions`
 * — the distinct name makes call-site intent explicit ("this is the
 * RBAC half of defense-in-depth"). The two filters are intersected at
 * the http-plugin list-tools handler:
 *
 *   visible = filterToolsByScope(tools, ctx.scopes)
 *               ∩ filterToolsByRbac(tools, ctx.permissions)
 *
 * Unannotated tools (requiredPermission == null) pass through unchanged
 * so informational tools (health/version) remain visible to any
 * authenticated caller (D-04 carry-forward).
 *
 * Rationale for not renaming filterToolsByPermissions: legacy call sites
 * (tool registries outside http-plugin) keep the old name. Two names
 * share the same implementation — the call-site label carries the
 * semantic intent.
 */
export function filterToolsByRbac(
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
      if (t.requiredPermission == null) return true; // D-04: unannotated always visible
      if (hasAdmin) return true;                     // admin scope: all tools
      const perm = t.requiredPermission;

      // Phase 30.1 → 31.2 D-14: admin.system scope values cannot be newly
      // minted post-31.2 (scopes_supported narrows to ['read','write']).
      // This branch still executes for pre-31.2 tokens carrying admin.* —
      // that's why it survives — but RBAC (filterToolsByRbac) is the
      // authoritative gate at the http-plugin composition. Returning false
      // here keeps the legacy admin.system scope value a no-op (cannot
      // privilege-escalate a pre-31.2 token into admin.system-gated tools).
      if (perm === 'admin.system') return false;

      // Write-tier permissions: .create / .update / .manage / .delete / admin.users / admin.org.
      if (
        perm.endsWith('.create') ||
        perm.endsWith('.update') ||
        perm.endsWith('.manage') ||
        perm.endsWith('.delete') ||
        perm === 'admin.users' ||
        perm === 'admin.org'
      ) {
        return hasWrite;
      }

      // Read-tier: `.view` (and any other explicitly read-shaped permission).
      if (perm.endsWith('.view')) return hasRead;

      // Default: unknown permission shape → treat as write-tier (fail safe —
      // a new permission MUST be explicitly classified, not fall through to
      // the most permissive tier).
      return hasWrite;
    })
    .map((t) => t.name);
}

/**
 * Resource equivalent of filterToolsByPermissions — returns the URI schemes
 * the caller's effective permissions allow. Used by createMcpHttpPlugin's
 * ListResourcesRequestSchema override (Phase 30 D-12).
 */
export function filterResourcesByPermissions(
  allResources: readonly ResourceMetadata[],
  effectivePerms: ReadonlySet<string>,
): readonly string[] {
  return allResources
    .filter((r) => r.requiredPermission == null || effectivePerms.has(r.requiredPermission))
    .map((r) => r.uriScheme);
}

/**
 * Resource equivalent of filterToolsByScope — scope-hierarchy fallback for
 * service-to-service callers whose JWTs carry scopes but no RBAC permissions.
 * Mirrors filterToolsByScope's rules exactly (Phase 30 D-12).
 */
export function filterResourcesByScope(
  allResources: readonly ResourceMetadata[],
  tokenScopes: readonly string[],
): readonly string[] {
  const hasAdmin = tokenScopes.includes('admin');
  const hasWrite = tokenScopes.includes('write') || hasAdmin;
  const hasRead = tokenScopes.includes('read') || hasWrite;

  return allResources
    .filter((r) => {
      if (r.requiredPermission == null) return true; // D-04: unannotated always visible
      if (hasAdmin) return true;                     // admin scope: all resources
      const perm = r.requiredPermission;

      // Phase 30.1 (OQ-1 resolution — suffix-rule rewrite; mirrors filterToolsByScope).
      // Admin-only permission: never granted below `admin` scope.
      if (perm === 'admin.system') return false;

      // Write-tier permissions: .create / .update / .manage / .delete / admin.users / admin.org.
      if (
        perm.endsWith('.create') ||
        perm.endsWith('.update') ||
        perm.endsWith('.manage') ||
        perm.endsWith('.delete') ||
        perm === 'admin.users' ||
        perm === 'admin.org'
      ) {
        return hasWrite;
      }

      // Read-tier: `.view` (and any other explicitly read-shaped permission).
      if (perm.endsWith('.view')) return hasRead;

      // Default: unknown permission shape → treat as write-tier (fail safe).
      return hasWrite;
    })
    .map((r) => r.uriScheme);
}
