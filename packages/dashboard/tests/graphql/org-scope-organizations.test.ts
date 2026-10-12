/**
 * Query.organizations listed every org to any logged-in caller. REST shows the
 * full list only behind admin.system (GET /admin/organizations); a non-admin's
 * own view (/orgs/current) is about their own org. GraphQL now lists every org
 * only to a global admin and otherwise just the caller's current org.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import { FABRIKAM_ORG, NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx, makeOrgKeyCtx } from './helpers/org-ctx.js';

const ORGS = [
  { id: FABRIKAM_ORG, name: 'Fabrikam', slug: 'fabrikam' },
  { id: NORTHWIND_ORG, name: 'Northwind', slug: 'northwind' },
];

function makeStorage() {
  return {
    organizations: {
      listOrgs: vi.fn(async () => ORGS),
      getOrg: vi.fn(async (id: string) => ORGS.find((o) => o.id === id) ?? null),
    },
  };
}

describe('GraphQL organizations scoping', () => {
  it('lists only the caller current org to an org member (cross-org)', async () => {
    const result = await resolvers.Query.organizations({}, {}, makeOrgCtx(makeStorage()));
    expect(result.map((o: { id: string }) => o.id)).toEqual([FABRIKAM_ORG]);
  });

  it('lists only the caller current org to an org-scoped admin key (cross-org)', async () => {
    const result = await resolvers.Query.organizations({}, {}, makeOrgKeyCtx(makeStorage()));
    expect(result.map((o: { id: string }) => o.id)).toEqual([FABRIKAM_ORG]);
  });

  it("lists nothing to a caller whose current org is 'system' (cross-org)", async () => {
    const result = await resolvers.Query.organizations({}, {}, makeOrgCtx(makeStorage(), { orgId: 'system' }));
    expect(result).toEqual([]);
  });

  it('lists every org to a global admin', async () => {
    const result = await resolvers.Query.organizations({}, {}, makeGlobalAdminCtx(makeStorage()));
    expect(result).toHaveLength(2);
  });
});
