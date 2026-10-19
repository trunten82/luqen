/**
 * HARD-19 unit: the stored-caller rule reads the user row on every call. A missing or deactivated
 * user is refused, and so is a non-admin user outside the token's organization; otherwise the
 * permissions resolve from the STORED global role.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveStoredCaller, storedPermissionsOrNone, type StoredCallerStorage } from '../../src/auth/stored-caller.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

function storageWith(
  user: { readonly role: string; readonly active: boolean } | null,
  repositoryAnswer: readonly string[] = [],
  memberOf: readonly string[] = ['org-1'],
): StoredCallerStorage & { readonly roles: { getEffectivePermissions: ReturnType<typeof vi.fn> } } {
  return {
    users: { getUserById: vi.fn(async () => user) },
    roles: { getEffectivePermissions: vi.fn(async () => new Set(repositoryAnswer)) },
    organizations: { getUserOrgs: vi.fn(async () => memberOf.map((id) => ({ id }))) },
  };
}

describe('HARD-19 stored caller rule', () => {
  it('HARD-19 the stored caller rule refuses a user that does not exist', async () => {
    const storage = storageWith(null, ['reports.view']);
    expect(await resolveStoredCaller(storage, 'fabrikam-removed', 'org-1')).toEqual({ ok: false, refusal: 'unknown_user' });
  });

  it('HARD-19 the stored caller rule refuses a deactivated user', async () => {
    const storage = storageWith({ role: 'user', active: false }, ['reports.view']);
    expect(await resolveStoredCaller(storage, 'fabrikam-inactive', 'org-1')).toEqual({ ok: false, refusal: 'inactive_user' });
  });

  it('HARD-19 the stored caller rule resolves permissions from the stored global role', async () => {
    // The repository answers nothing; only the STORED role 'admin' can yield every permission.
    const admin = await resolveStoredCaller(storageWith({ role: 'admin', active: true }), 'fabrikam-admin', 'org-1');
    expect(admin.ok).toBe(true);
    if (!admin.ok) return;
    expect(admin.role).toBe('admin');
    expect([...admin.permissions].sort()).toEqual([...ALL_PERMISSION_IDS].sort());

    const user = await resolveStoredCaller(storageWith({ role: 'user', active: true }, ['reports.view']), 'fabrikam-user', 'org-1');
    expect(user).toEqual({ ok: true, role: 'user', permissions: new Set(['reports.view']) });
  });

  it('HARD-19 the agent resolves no permission for a deactivated user', async () => {
    const answer = ['reports.view', 'scans.create'];
    const inactive = await storedPermissionsOrNone(storageWith({ role: 'user', active: false }, answer), 'fabrikam-inactive', 'org-1');
    expect([...inactive]).toEqual([]);
    const missing = await storedPermissionsOrNone(storageWith(null, answer), 'fabrikam-removed', 'org-1');
    expect([...missing]).toEqual([]);
    // Control: an active stored user resolves the stored role's set.
    const active = await storedPermissionsOrNone(storageWith({ role: 'user', active: true }, answer), 'fabrikam-user', 'org-1');
    expect([...active].sort()).toEqual([...answer].sort());
  });

  it('HARD-19 the stored caller rule refuses a user outside the organization', async () => {
    const answer = ['reports.view', 'scans.create'];
    const outside = storageWith({ role: 'user', active: true }, answer, ['org-2']);
    expect(await resolveStoredCaller(outside, 'fabrikam-leaver', 'org-1')).toEqual({ ok: false, refusal: 'not_member' });
    expect([...(await storedPermissionsOrNone(outside, 'fabrikam-leaver', 'org-1'))]).toEqual([]);
    // Control: the same user is served in an organization it belongs to.
    expect(await resolveStoredCaller(outside, 'fabrikam-leaver', 'org-2')).toEqual({ ok: true, role: 'user', permissions: new Set(answer) });
  });
});
