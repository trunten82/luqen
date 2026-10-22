/**
 * Which audit rows a caller may read. Shared by the Audit Log page (routes/admin/audit.ts), the
 * GraphQL `auditLog` query (graphql/resolvers.ts) and the menu entry (server.ts `perm.auditLogView`),
 * so all three answer the same way.
 *
 *   - A caller who bypasses organization scope (a global administrator) reads every row.
 *   - Anyone else reads the rows of the organization they are working in.
 *   - A caller who is in no organization (no current organization, or `system`) reads no rows, and
 *     the menu does not offer the page.
 */
import { bypassesOrgScope } from '../permissions.js';

export type AuditLogScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'org'; readonly orgId: string }
  | { readonly kind: 'none' };

export interface AuditLogScopeActor {
  readonly role?: string;
  readonly orgScopedApiKey?: boolean;
  readonly currentOrgId?: string;
}

export function auditLogScope(actor: AuditLogScopeActor | undefined): AuditLogScope {
  if (bypassesOrgScope(actor)) return { kind: 'all' };
  const orgId = actor?.currentOrgId ?? '';
  if (orgId === '' || orgId === 'system') return { kind: 'none' };
  return { kind: 'org', orgId };
}
