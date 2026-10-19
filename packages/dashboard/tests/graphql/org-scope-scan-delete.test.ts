/**
 * deleteScan asks the shared scan delete rule (services/scan-delete-access.ts), as
 * REST DELETE /api/v1/scans/:id does: missing → "Scan not found"; a scan outside the
 * caller's organization → "Forbidden". A global admin (role 'admin', not an
 * org-scoped key) may delete any org's scan.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import {
  FABRIKAM_ORG, NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx, makeOrgKeyCtx,
} from './helpers/org-ctx.js';

const PERMS = ['reports.delete'];
const NORTHWIND_SCAN = { id: 'scan-northwind-1', orgId: NORTHWIND_ORG, siteUrl: 'https://northwind.example' };

function makeStorage() {
  return {
    scans: {
      getScan: vi.fn(async (id: string) => (id === NORTHWIND_SCAN.id ? NORTHWIND_SCAN : null)),
      deleteScan: vi.fn(async () => undefined),
    },
  };
}

describe('GraphQL deleteScan org scoping', () => {
  it('refuses an org member deleting another org scan (cross-org)', async () => {
    const storage = makeStorage();
    await expect(resolvers.Mutation.deleteScan({}, { id: NORTHWIND_SCAN.id },
      makeOrgCtx(storage, { permissions: PERMS }))).rejects.toThrow('Forbidden');
    expect(storage.scans.deleteScan).not.toHaveBeenCalled();
  });

  it('refuses an org-scoped admin API key deleting another org scan (cross-org)', async () => {
    const storage = makeStorage();
    await expect(resolvers.Mutation.deleteScan({}, { id: NORTHWIND_SCAN.id },
      makeOrgKeyCtx(storage, PERMS))).rejects.toThrow('Forbidden');
    expect(storage.scans.deleteScan).not.toHaveBeenCalled();
  });

  it('lets a global admin delete another org scan, as REST does', async () => {
    const storage = makeStorage();
    await expect(resolvers.Mutation.deleteScan({}, { id: NORTHWIND_SCAN.id },
      makeGlobalAdminCtx(storage, PERMS))).resolves.toBe(true);
    expect(storage.scans.deleteScan).toHaveBeenCalledWith(NORTHWIND_SCAN.id);
  });

  it('lets a member of the owning org delete the scan', async () => {
    const storage = makeStorage();
    await expect(resolvers.Mutation.deleteScan({}, { id: NORTHWIND_SCAN.id },
      makeOrgCtx(storage, { orgId: NORTHWIND_ORG, permissions: PERMS }))).resolves.toBe(true);
  });

  it('still reports a missing scan as not found', async () => {
    const storage = makeStorage();
    await expect(resolvers.Mutation.deleteScan({}, { id: 'nope' },
      makeOrgCtx(storage, { orgId: FABRIKAM_ORG, permissions: PERMS }))).rejects.toThrow('Scan not found');
  });
});
