/**
 * HARD-19 unit: the stored-caller rule reads the user row on every call. A missing or deactivated
 * user is refused; otherwise the permissions resolve from the STORED global role.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveStoredCaller, type StoredCallerStorage } from '../../src/auth/stored-caller.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

function storageWith(
  user: { readonly role: string; readonly active: boolean } | null,
  repositoryAnswer: readonly string[] = [],
): StoredCallerStorage & { readonly roles: { getEffectivePermissions: ReturnType<typeof vi.fn> } } {
  return {
    users: { getUserById: vi.fn(async () => user) },
    roles: { getEffectivePermissions: vi.fn(async () => new Set(repositoryAnswer)) },
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
});
