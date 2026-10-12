/**
 * canManageUser treats a team-membership row whose team no longer exists as
 * belonging to no org. SQLite cascades team deletes, so this branch is only
 * reachable through a storage adapter that does not (or a racing delete);
 * the route tests cannot reach it, so it is pinned here directly.
 */
import { describe, it, expect } from 'vitest';
import { canManageUser } from '../../src/services/user-scope.js';
import type { StorageAdapter } from '../../src/db/index.js';

const OWNER = { role: 'user', currentOrgId: 'org-fabrikam' };

function storageWith(memberships: ReadonlyArray<{ teamId: string }>): StorageAdapter {
  const teams: Record<string, { id: string; orgId: string }> = {
    'team-fb': { id: 'team-fb', orgId: 'org-fabrikam' },
  };
  return {
    users: { getUserById: async () => ({ id: 'u1', username: 'member', role: 'user', active: true }) },
    teams: {
      listTeamMembershipsForUser: async () => memberships.map((m) => ({ teamId: m.teamId, role: 'member' })),
      getTeam: async (id: string) => teams[id] ?? null,
    },
  } as unknown as StorageAdapter;
}

describe('canManageUser with a membership of a team that no longer exists', () => {
  it('ignores the dangling membership when the user is otherwise sole-org (dangling team)', async () => {
    expect(await canManageUser(storageWith([{ teamId: 'team-fb' }, { teamId: 'team-gone' }]), OWNER, 'u1')).toBe(true);
  });

  it('a dangling membership alone does not put the user in the owner org (dangling team)', async () => {
    expect(await canManageUser(storageWith([{ teamId: 'team-gone' }]), OWNER, 'u1')).toBe(false);
  });
});
