/**
 * D-07 path 3 (Phase 87) pinned that an org-scoped API key never held a dark permission: PR #102
 * caps an org-scoped admin key at ORG_OWNER_PERMISSIONS, and that set was kept dark-free.
 *
 * Phase 89 Plan 09 (FP-18) added issues.dismiss to ORG_OWNER_PERMISSIONS, so the cap now carries
 * it. The owner accepted that at D-15 (Q4 = accept). This file now PINS the granted composition:
 * an org-scoped admin key holds exactly the Owner set, issues.dismiss included, and nothing
 * global. It does not re-test the flag, the guard carry or the /api confinement — those belong to
 * org-scoped-admin-key-containment.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveEffectivePermissions,
  ORG_OWNER_PERMISSIONS,
} from '../../src/permissions.js';

const roleRepo = {
  // A read-only key resolves through the role repository; return a realistic non-admin set.
  async getEffectivePermissions(): Promise<Set<string>> {
    return new Set(['reports.view', 'trends.view']);
  },
};

describe('org-scoped API keys after the issues.dismiss grant', () => {
  it('org-scoped admin api key resolves exactly the owner set, including issues.dismiss, and nothing global', async () => {
    const perms = await resolveEffectivePermissions(roleRepo, 'api-key', 'admin', 'org-a', { orgScopedApiKey: true });
    expect([...perms].sort()).toEqual([...ORG_OWNER_PERMISSIONS].sort());
    expect(perms.has('issues.dismiss')).toBe(true);
    expect(perms.has('admin.system')).toBe(false);
  });

  it('org-scoped non-admin api key does not gain issues.dismiss from the grant', async () => {
    const perms = await resolveEffectivePermissions(roleRepo, 'api-key', 'read-only', 'org-a', { orgScopedApiKey: true });
    expect([...perms].sort()).toEqual(['reports.view', 'trends.view']);
    expect(perms.has('issues.dismiss')).toBe(false);
  });
});
