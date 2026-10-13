/**
 * Quick 261013-dr7: mayViewScanReport is the report page's access check as ONE function, shared by
 * the page guard and the read-only Dismissed section. It must equal the inline guard it replaced
 * (`!bypassesOrgScope(user) && scan.orgId !== (user?.currentOrgId ?? 'system') && scan.orgId !==
 * 'system'` -> 404) for every signed-in caller, and refuse a missing user outright.
 */
import { describe, expect, it } from 'vitest';
import { mayViewScanReport } from '../../../src/services/issue-dismissals/scan-access.js';
import type { AuthUser } from '../../../src/auth/middleware.js';

const FABRIKAM = 'org-fabrikam';
const NORTHWIND = 'org-northwind';

const user = (u: Partial<AuthUser>): AuthUser => ({ id: 'u1', username: 'u1', role: 'user', ...u }) as AuthUser;

/** The inline check the report route used before this change, verbatim in meaning. */
function oldRouteAllows(u: AuthUser, scanOrgId: string): boolean {
  const bypass = u.role === 'admin' && u.orgScopedApiKey !== true;
  const orgId = u.currentOrgId ?? 'system';
  return !(!bypass && scanOrgId !== orgId && scanOrgId !== 'system');
}

describe('mayViewScanReport', () => {
  it('an org-B user cannot view an org-A scan', () => {
    expect(mayViewScanReport(user({ currentOrgId: NORTHWIND }), FABRIKAM)).toBe(false);
  });

  it('a user with no org cannot view an org scan', () => {
    expect(mayViewScanReport(user({}), FABRIKAM)).toBe(false);
  });

  it('a missing user can view nothing, not even a system scan', () => {
    expect(mayViewScanReport(undefined, 'system')).toBe(false);
    expect(mayViewScanReport(undefined, FABRIKAM)).toBe(false);
  });

  it('an org-scoped admin API key is held to its own org', () => {
    const key = user({ role: 'admin', orgScopedApiKey: true, currentOrgId: NORTHWIND });
    expect(mayViewScanReport(key, FABRIKAM)).toBe(false);
    expect(mayViewScanReport(key, NORTHWIND)).toBe(true);
  });

  it('matches the old inline route guard for every signed-in caller shape', () => {
    const callers: AuthUser[] = [
      user({}),
      user({ currentOrgId: FABRIKAM }),
      user({ currentOrgId: NORTHWIND }),
      user({ currentOrgId: 'system' }),
      user({ role: 'admin' }),
      user({ role: 'admin', currentOrgId: NORTHWIND }),
      user({ role: 'admin', orgScopedApiKey: true, currentOrgId: NORTHWIND }),
      user({ role: 'executive', currentOrgId: FABRIKAM }),
    ];
    let checked = 0;
    for (const c of callers) {
      for (const scanOrg of [FABRIKAM, NORTHWIND, 'system']) {
        expect(mayViewScanReport(c, scanOrg), `${JSON.stringify(c)} -> ${scanOrg}`).toBe(oldRouteAllows(c, scanOrg));
        checked++;
      }
    }
    expect(checked).toBe(24);
  });
});
