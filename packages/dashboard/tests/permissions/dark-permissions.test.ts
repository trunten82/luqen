/**
 * FP-17 / D-07 (Phase 87): `issues.dismiss` exists in the catalogue (so global
 * admins hold it) but is DARK — no default org role, no ORG_* permission set,
 * and no role-form checkbox carries it until Phase 89 lifts DARK_PERMISSIONS.
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

describe('dark permissions (issues.dismiss)', () => {
  it('issues.dismiss is in the catalogue and every dark id is in the catalogue', () => {
    expect(ALL_PERMISSION_IDS).toContain('issues.dismiss');
    expect([...DARK_PERMISSIONS]).toEqual(['issues.dismiss']);
    for (const id of DARK_PERMISSIONS) expect(ALL_PERMISSION_IDS).toContain(id);
  });

  it('no default org role or ORG_ permission set holds a dark permission', () => {
    const sets: Record<string, readonly string[]> = {
      ORG_OWNER_PERMISSIONS,
      ORG_ADMIN_PERMISSIONS,
      ORG_MEMBER_PERMISSIONS,
      ORG_EXECUTIVE_PERMISSIONS,
      ORG_VIEWER_PERMISSIONS,
    };
    for (const [name, set] of Object.entries(sets)) {
      for (const dark of DARK_PERMISSIONS) {
        expect(set, `${name} must not hold ${dark}`).not.toContain(dark);
      }
    }
    for (const role of DEFAULT_ORG_ROLES) {
      for (const dark of DARK_PERMISSIONS) {
        expect(role.permissions, `default role ${role.name} must not hold ${dark}`).not.toContain(dark);
      }
    }
  });

  it('getPermissionGroups lists no dark permission (role form unchanged while dark)', () => {
    const listed = getPermissionGroups().flatMap((g) => g.permissions.map((p) => p.id));
    for (const dark of DARK_PERMISSIONS) expect(listed).not.toContain(dark);
    // Control: the groups are not simply empty.
    expect(listed).toContain('issues.fix');
  });

  it('a global admin (role admin, no options) holds issues.dismiss and exactly the full catalogue', async () => {
    const perms = await resolveEffectivePermissions(noRepo, 'u1', 'admin', undefined);
    expect(perms.has('issues.dismiss')).toBe(true);
    expect([...perms].sort()).toEqual([...ALL_PERMISSION_IDS].sort());
  });

  it('isRoleGrantablePermission accepts catalogue ids except dark ones; withoutDarkPermissions does not mutate', () => {
    expect(isRoleGrantablePermission('reports.view')).toBe(true);
    expect(isRoleGrantablePermission('issues.dismiss')).toBe(false);
    expect(isRoleGrantablePermission('not.a.permission')).toBe(false);

    const input = ['reports.view', 'issues.dismiss'];
    const out = withoutDarkPermissions(input);
    expect([...out]).toEqual(['reports.view']);
    expect(input).toEqual(['reports.view', 'issues.dismiss']);
  });

  // WR-01 (87 review): parsePermissions is not the only way a role row gets
  // written, so the dark filter must hold where permissions are RESOLVED.
  it('a non-admin whose stored role rows carry a dark id does not resolve it', async () => {
    const smuggled = {
      async getEffectivePermissions(): Promise<Set<string>> {
        return new Set<string>(['reports.view', 'issues.dismiss']);
      },
    };
    const perms = await resolveEffectivePermissions(smuggled, 'u2', 'user', 'org-1');
    expect(perms.has('issues.dismiss')).toBe(false);
    // Control: the non-dark permission from the same rows survives.
    expect(perms.has('reports.view')).toBe(true);
  });

  it('an org-scoped admin key never resolves a dark id', async () => {
    const perms = await resolveEffectivePermissions(noRepo, 'k1', 'admin', 'org-1', { orgScopedApiKey: true });
    for (const dark of DARK_PERMISSIONS) expect(perms.has(dark)).toBe(false);
    expect(perms.size).toBeGreaterThan(0);
  });
});
