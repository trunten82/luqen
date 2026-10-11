/**
 * team(id) mirrors the org rule of routes/admin/teams.ts (canMutateTeam,
 * also used by the team listing): a global admin sees every team; anyone else
 * only teams whose orgId equals their current org. Out of scope → null,
 * exactly as a missing team.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import { NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx, makeOrgKeyCtx } from './helpers/org-ctx.js';

const TEAMS_PERM = ['admin.teams'];
const NORTHWIND_TEAM = { id: 'team-northwind-1', name: 'Northwind QA', orgId: NORTHWIND_ORG, members: [] };

function makeStorage() {
  return {
    teams: {
      listTeams: vi.fn(async () => [NORTHWIND_TEAM]),
      getTeam: vi.fn(async (id: string) => (id === NORTHWIND_TEAM.id ? NORTHWIND_TEAM : null)),
    },
  };
}

describe('GraphQL team org scoping', () => {
  it('returns null for another org team (cross-org)', async () => {
    const result = await resolvers.Query.team({}, { id: NORTHWIND_TEAM.id }, makeOrgCtx(makeStorage(), { permissions: TEAMS_PERM }));
    expect(result).toBeNull();
  });

  it('returns null for another org team to an org-scoped admin key (cross-org)', async () => {
    const result = await resolvers.Query.team({}, { id: NORTHWIND_TEAM.id }, makeOrgKeyCtx(makeStorage(), TEAMS_PERM));
    expect(result).toBeNull();
  });

  it('returns the team to a member of the owning org', async () => {
    const result = await resolvers.Query.team({}, { id: NORTHWIND_TEAM.id },
      makeOrgCtx(makeStorage(), { orgId: NORTHWIND_ORG, permissions: TEAMS_PERM }));
    expect(result).toEqual(NORTHWIND_TEAM);
  });

  it('returns any team to a global admin, as REST does', async () => {
    const result = await resolvers.Query.team({}, { id: NORTHWIND_TEAM.id }, makeGlobalAdminCtx(makeStorage(), TEAMS_PERM));
    expect(result).toEqual(NORTHWIND_TEAM);
  });
});

describe('GraphQL team/teams require admin.teams, as REST /admin/teams does', () => {
  it('team(id) refuses a caller without admin.teams (permission)', async () => {
    await expect(resolvers.Query.team({}, { id: NORTHWIND_TEAM.id },
      makeOrgCtx(makeStorage(), { orgId: NORTHWIND_ORG }))).rejects.toThrow('Forbidden: requires admin.teams');
  });

  it('teams refuses a caller without admin.teams (permission)', async () => {
    await expect(resolvers.Query.teams({}, {}, makeOrgCtx(makeStorage(), { orgId: NORTHWIND_ORG })))
      .rejects.toThrow('Forbidden: requires admin.teams');
  });

  it('teams lists the caller org teams with admin.teams', async () => {
    const result = await resolvers.Query.teams({}, {},
      makeOrgCtx(makeStorage(), { orgId: NORTHWIND_ORG, permissions: TEAMS_PERM }));
    expect(result).toEqual([NORTHWIND_TEAM]);
  });
});
