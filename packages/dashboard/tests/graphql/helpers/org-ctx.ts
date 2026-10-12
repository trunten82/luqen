/**
 * Shared GraphQL context factory for the cross-org scoping tests.
 * Org ids and names are placeholders (Fabrikam / Northwind).
 */
import type { GraphQLContext } from '../../../src/graphql/resolvers.js';

export const FABRIKAM_ORG = 'org-fabrikam';
export const NORTHWIND_ORG = 'org-northwind';

export interface CtxOptions {
  readonly orgId?: string;
  readonly role?: string;
  readonly orgScopedApiKey?: boolean;
  readonly permissions?: readonly string[];
}

/** A member of `orgId` (default Fabrikam) with role `role` (default 'user'). */
export function makeOrgCtx(storage: unknown, opts: CtxOptions = {}): GraphQLContext {
  const orgId = opts.orgId ?? FABRIKAM_ORG;
  return {
    storage: storage as GraphQLContext['storage'],
    user: {
      id: `user-${orgId}`,
      username: `user-${orgId}`,
      role: opts.role ?? 'user',
      currentOrgId: orgId,
      ...(opts.orgScopedApiKey === true ? { orgScopedApiKey: true } : {}),
    },
    permissions: new Set<string>(opts.permissions ?? []),
    orgId,
    brandingOrchestrator: {} as GraphQLContext['brandingOrchestrator'],
  };
}

/** A global dashboard admin (role 'admin', not an org-scoped key) currently in Fabrikam. */
export function makeGlobalAdminCtx(storage: unknown, permissions: readonly string[] = []): GraphQLContext {
  return makeOrgCtx(storage, { role: 'admin', permissions });
}

/** An org-scoped admin API key for Fabrikam: role 'admin' but never bypasses org scope. */
export function makeOrgKeyCtx(storage: unknown, permissions: readonly string[] = []): GraphQLContext {
  return makeOrgCtx(storage, { role: 'admin', orgScopedApiKey: true, permissions });
}
