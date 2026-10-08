/**
 * D-07 path 3 (Phase 87): an org-scoped API key never holds a dark permission.
 *
 * PR #102 caps an org-scoped admin key at ORG_OWNER_PERMISSIONS; Task 1's
 * path-1 invariant keeps every ORG_* set free of dark ids, so the cap carries
 * no dark id. This file PINS that composition against regression. It does not
 * re-test the flag, the guard carry or the /api confinement — those belong to
 * org-scoped-admin-key-containment.test.ts.
 *
 * When Phase 89 lifts the dark set (adds issues.dismiss to ORG_OWNER_PERMISSIONS
 * deliberately) this pin must be updated in the same change.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveEffectivePermissions,
  ORG_OWNER_PERMISSIONS,
  DARK_PERMISSIONS,
} from '../../src/permissions.js';

const roleRepo = {
  // A read-only key resolves through the role repository; return a realistic non-admin set.
  async getEffectivePermissions(): Promise<Set<string>> {
    return new Set(['reports.view', 'trends.view']);
  },
};

describe('org-scoped API key and dark permissions', () => {
  it('org-scoped admin api key resolves the owner set and no dark permission', async () => {
    const perms = await resolveEffectivePermissions(roleRepo, 'api-key', 'admin', 'org-a', { orgScopedApiKey: true });
    expect([...perms].sort()).toEqual([...ORG_OWNER_PERMISSIONS].sort());
    for (const dark of DARK_PERMISSIONS) {
      expect(perms.has(dark), `org-scoped admin key must not hold ${dark}`).toBe(false);
    }
    expect(perms.has('issues.dismiss')).toBe(false);
  });

  it('org-scoped non-admin api key resolves no dark permission', async () => {
    const perms = await resolveEffectivePermissions(roleRepo, 'api-key', 'read-only', 'org-a', { orgScopedApiKey: true });
    expect(perms.size).toBeGreaterThan(0);
    for (const dark of DARK_PERMISSIONS) {
      expect(perms.has(dark), `org-scoped read-only key must not hold ${dark}`).toBe(false);
    }
  });
});
