/**
 * HARD-18: the one rule every scan delete path asks (src/services/scan-delete-access.ts).
 *
 * Organization first (a global administrator reaches every organization; everyone else only their
 * current organization, or 'system' when they have none), then permission (reports.delete, or being
 * the signed-in user who started the scan; an API key never counts as that user).
 * Organization ids and user names are placeholders (Fabrikam / Northwind).
 */
import { describe, expect, it } from 'vitest';
import {
  SCAN_DELETE_PERMISSION, scanDeleteRefusal, type ScanDeleteCaller, type ScanDeleteUser,
} from '../../src/services/scan-delete-access.js';
import { ALL_PERMISSION_IDS, ORG_MEMBER_PERMISSIONS, ORG_OWNER_PERMISSIONS } from '../../src/permissions.js';

const FABRIKAM = 'org-fabrikam';
const NORTHWIND = 'org-northwind';

const caller = (user: ScanDeleteUser | undefined, permissions: readonly string[]): ScanDeleteCaller => ({
  user, permissions: new Set(permissions),
});

const GLOBAL_ADMIN = caller({ id: 'u-admin', username: 'fabrikam-global-admin', role: 'admin', currentOrgId: FABRIKAM }, ALL_PERMISSION_IDS);
const OWNER = caller({ id: 'u-owner', username: 'fabrikam-owner', role: 'user', currentOrgId: FABRIKAM }, ORG_OWNER_PERMISSIONS);
const MEMBER = caller({ id: 'u-member', username: 'fabrikam-member', role: 'executive', currentOrgId: FABRIKAM }, ORG_MEMBER_PERMISSIONS);
const NO_ORG_USER = caller({ id: 'u-solo', username: 'solo-user', role: 'user' }, [SCAN_DELETE_PERMISSION, 'reports.view']);
const GLOBAL_ADMIN_KEY = caller({ id: 'api-key', username: 'api-key', role: 'admin' }, ALL_PERMISSION_IDS);
const ORG_ADMIN_KEY = caller(
  { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: FABRIKAM, orgScopedApiKey: true }, ORG_OWNER_PERMISSIONS,
);
const READ_ONLY_KEY = caller({ id: 'api-key', username: 'api-key', role: 'read-only' }, []);
const ORG_READ_ONLY_KEY = caller(
  { id: 'api-key', username: 'api-key', role: 'read-only', currentOrgId: FABRIKAM, orgScopedApiKey: true }, [],
);

describe('HARD-18 scan delete rule', () => {
  it('HARD-18 delete rule admits a holder of reports delete in its organization', () => {
    expect(SCAN_DELETE_PERMISSION).toBe('reports.delete');
    expect(scanDeleteRefusal(OWNER, { orgId: FABRIKAM, createdBy: 'fabrikam-member' })).toBeNull();
  });

  it('HARD-18 delete rule admits the signed in user who started the scan', () => {
    expect(scanDeleteRefusal(MEMBER, { orgId: FABRIKAM, createdBy: 'fabrikam-member' })).toBeNull();
  });

  it('HARD-18 delete rule refuses a signed in user who neither holds reports delete nor started the scan', () => {
    expect(ORG_MEMBER_PERMISSIONS).not.toContain(SCAN_DELETE_PERMISSION);
    expect(scanDeleteRefusal(MEMBER, { orgId: FABRIKAM, createdBy: 'fabrikam-owner' })).toBe('permission');
    expect(scanDeleteRefusal(MEMBER, { orgId: FABRIKAM })).toBe('permission');
  });

  it('HARD-18 delete rule never treats an api key sign in session as the user who started the scan', () => {
    // A /login API-key session signs in under the user name 'admin', and the scans it starts record
    // 'admin' as their starter: the session is still never the user who started them.
    const apiKeySession = caller({ id: 'api-key', username: 'admin', role: 'admin' }, []);
    expect(scanDeleteRefusal(apiKeySession, { orgId: 'system', createdBy: 'admin' })).toBe('permission');
  });

  it('HARD-18 delete rule never treats an api key as the user who started the scan', () => {
    expect(scanDeleteRefusal(READ_ONLY_KEY, { orgId: 'system', createdBy: 'api-key' })).toBe('permission');
    expect(scanDeleteRefusal(ORG_READ_ONLY_KEY, { orgId: FABRIKAM, createdBy: 'api-key' })).toBe('permission');
  });

  it('HARD-18 delete rule refuses a scan of another organization', () => {
    expect(scanDeleteRefusal(OWNER, { orgId: NORTHWIND, createdBy: 'fabrikam-owner' })).toBe('org');
    expect(scanDeleteRefusal(MEMBER, { orgId: NORTHWIND, createdBy: 'fabrikam-member' })).toBe('org');
    expect(scanDeleteRefusal(caller(undefined, ALL_PERMISSION_IDS), { orgId: FABRIKAM })).toBe('org');
  });

  it('HARD-18 delete rule refuses an organization user on a scan shared with every organization', () => {
    expect(scanDeleteRefusal(OWNER, { orgId: 'system', createdBy: 'fabrikam-owner' })).toBe('org');
  });

  it('HARD-18 delete rule admits a user without an organization on a scan shared with every organization', () => {
    expect(scanDeleteRefusal(NO_ORG_USER, { orgId: 'system', createdBy: 'someone-else' })).toBeNull();
  });

  it('HARD-18 delete rule admits a global admin on a scan of any organization', () => {
    expect(scanDeleteRefusal(GLOBAL_ADMIN, { orgId: NORTHWIND, createdBy: 'northwind-owner' })).toBeNull();
    expect(scanDeleteRefusal(GLOBAL_ADMIN, { orgId: 'system' })).toBeNull();
    expect(scanDeleteRefusal(GLOBAL_ADMIN_KEY, { orgId: NORTHWIND })).toBeNull();
  });

  it('HARD-18 delete rule keeps an organization admin api key inside its organization', () => {
    expect(scanDeleteRefusal(ORG_ADMIN_KEY, { orgId: NORTHWIND })).toBe('org');
    expect(scanDeleteRefusal(ORG_ADMIN_KEY, { orgId: 'system' })).toBe('org');
    expect(scanDeleteRefusal(ORG_ADMIN_KEY, { orgId: FABRIKAM })).toBeNull();
  });
});
