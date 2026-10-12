/**
 * FP-17 / D-07 (Phase 87) introduced DARK_PERMISSIONS: `issues.dismiss` existed in the catalogue
 * (so global admins held it) while no default org role, ORG_* set or role-form checkbox carried it.
 *
 * FP-18 / D-16 (Phase 89 Plan 09) lifted it: the dark set is EMPTY, issues.dismiss belongs to the
 * org Owner and Admin sets only, and custom roles may carry it (D-15 Q3 = A). Every test below was
 * a dark pin; each was renamed to the granted proposition and watched red against the dark source
 * first (89-09-EVIDENCE.md "Flipped pins"). The DARK_PERMISSIONS symbol and its filters stay for
 * the next dark permission.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSION_IDS,
  DARK_PERMISSIONS,
  DEFAULT_ORG_ROLES,
  ORG_OWNER_PERMISSIONS,
  ORG_ADMIN_PERMISSIONS,
  ORG_MEMBER_PERMISSIONS,
  ORG_EXECUTIVE_PERMISSIONS,
  ORG_VIEWER_PERMISSIONS,
  getPermissionGroups,
  isRoleGrantablePermission,
  withoutDarkPermissions,
  resolveEffectivePermissions,
} from '../../src/permissions.js';

const noRepo = {
  async getEffectivePermissions(): Promise<Set<string>> {
    return new Set<string>();
  },
};

describe('issues.dismiss after the Phase 89 grant (dark set lifted)', () => {
  it('the dark set is empty after the grant and issues.dismiss is in the catalogue', () => {
    expect(ALL_PERMISSION_IDS).toContain('issues.dismiss');
    expect([...DARK_PERMISSIONS]).toEqual([]);
  });

  it('Owner and Admin sets and default roles hold issues.dismiss; Member, Executive and Viewer do not', () => {
    expect(ORG_OWNER_PERMISSIONS).toContain('issues.dismiss');
    expect(ORG_ADMIN_PERMISSIONS).toContain('issues.dismiss');
    expect(ORG_MEMBER_PERMISSIONS).not.toContain('issues.dismiss');
    expect(ORG_EXECUTIVE_PERMISSIONS).not.toContain('issues.dismiss');
    expect(ORG_VIEWER_PERMISSIONS).not.toContain('issues.dismiss');
    const holders = DEFAULT_ORG_ROLES.filter((r) => r.permissions.includes('issues.dismiss')).map((r) => r.name);
    expect(holders.sort()).toEqual(['Admin', 'Owner']);
  });

  it('getPermissionGroups lists issues.dismiss (the role form offers it)', () => {
    const listed = getPermissionGroups().flatMap((g) => g.permissions.map((p) => p.id));
    expect(listed).toContain('issues.dismiss');
    // Control: every catalogue id is listed once the dark set is empty.
    expect([...listed].sort()).toEqual([...ALL_PERMISSION_IDS].sort());
  });

  it('a global admin (role admin, no options) holds issues.dismiss and exactly the full catalogue', async () => {
    const perms = await resolveEffectivePermissions(noRepo, 'u1', 'admin', undefined);
    expect(perms.has('issues.dismiss')).toBe(true);
    expect([...perms].sort()).toEqual([...ALL_PERMISSION_IDS].sort());
  });

  it('issues.dismiss is role-grantable and withoutDarkPermissions keeps it without mutating its input', () => {
    expect(isRoleGrantablePermission('reports.view')).toBe(true);
    expect(isRoleGrantablePermission('issues.dismiss')).toBe(true);
    expect(isRoleGrantablePermission('not.a.permission')).toBe(false);

    const input = ['reports.view', 'issues.dismiss'];
    const out = withoutDarkPermissions(input);
    expect([...out]).toEqual(['reports.view', 'issues.dismiss']);
    expect(out).not.toBe(input);
    expect(input).toEqual(['reports.view', 'issues.dismiss']);
  });

  it('a non-admin whose stored role rows carry issues.dismiss resolves it', async () => {
    const granted = {
      async getEffectivePermissions(): Promise<Set<string>> {
        return new Set<string>(['reports.view', 'issues.dismiss']);
      },
    };
    const perms = await resolveEffectivePermissions(granted, 'u2', 'user', 'org-1');
    expect(perms.has('issues.dismiss')).toBe(true);
    expect(perms.has('reports.view')).toBe(true);
  });

  it('an org-scoped admin key resolves issues.dismiss through the owner cap', async () => {
    const perms = await resolveEffectivePermissions(noRepo, 'k1', 'admin', 'org-1', { orgScopedApiKey: true });
    expect(perms.has('issues.dismiss')).toBe(true);
    // Still capped: no global permission.
    expect(perms.has('admin.system')).toBe(false);
  });
});
