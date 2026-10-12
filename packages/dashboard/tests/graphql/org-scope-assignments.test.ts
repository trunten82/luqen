/**
 * Assignment mutations mirror routes/assignments.ts. The org rule there,
 * applied to the scan on create and to the assignment on PATCH/DELETE, is:
 *   `!bypassesOrgScope(user) && owner.orgId !== orgId && owner.orgId !== 'system'`
 *   → 404 (as if the record did not exist).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import {
  NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx, makeOrgKeyCtx,
} from './helpers/org-ctx.js';

const PERMS = ['issues.assign'];
const SCANS: Record<string, { id: string; orgId: string }> = {
  'scan-northwind-1': { id: 'scan-northwind-1', orgId: NORTHWIND_ORG },
  'scan-system-1': { id: 'scan-system-1', orgId: 'system' },
};
const NORTHWIND_ASSIGNMENT = { id: 'asg-northwind-1', scanId: 'scan-northwind-1', orgId: NORTHWIND_ORG };

function makeStorage() {
  return {
    scans: {
      getScan: vi.fn(async (id: string) => SCANS[id] ?? null),
    },
    assignments: {
      getAssignment: vi.fn(async (id: string) => (id === NORTHWIND_ASSIGNMENT.id ? NORTHWIND_ASSIGNMENT : null)),
      createAssignment: vi.fn(async (input: Record<string, unknown>) => ({ ...input, status: 'open' })),
      updateAssignment: vi.fn(async () => undefined),
      deleteAssignment: vi.fn(async () => undefined),
    },
  };
}

function assignInput(scanId: string) {
  return { input: { scanId, issueFingerprint: 'fp-1', severity: 'error', message: 'Missing alt text' } };
}

describe('GraphQL assignment org scoping', () => {
  describe('assignIssue', () => {
    it('refuses to assign an issue on another org scan (cross-org)', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.assignIssue({}, assignInput('scan-northwind-1'),
        makeOrgCtx(storage, { permissions: PERMS }))).rejects.toThrow('Scan not found');
      expect(storage.assignments.createAssignment).not.toHaveBeenCalled();
    });

    it('refuses an org-scoped admin key assigning on another org scan (cross-org)', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.assignIssue({}, assignInput('scan-northwind-1'),
        makeOrgKeyCtx(storage, PERMS))).rejects.toThrow('Scan not found');
      expect(storage.assignments.createAssignment).not.toHaveBeenCalled();
    });

    it('refuses a scan id that does not exist', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.assignIssue({}, assignInput('nope'),
        makeOrgCtx(storage, { permissions: PERMS }))).rejects.toThrow('Scan not found');
    });

    it('allows a scan in the caller org', async () => {
      const storage = makeStorage();
      const result = await resolvers.Mutation.assignIssue({}, assignInput('scan-northwind-1'),
        makeOrgCtx(storage, { orgId: NORTHWIND_ORG, permissions: PERMS }));
      expect(result.scanId).toBe('scan-northwind-1');
    });

    it("allows a 'system' scan, as REST does", async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.assignIssue({}, assignInput('scan-system-1'),
        makeOrgCtx(storage, { permissions: PERMS }))).resolves.toBeDefined();
    });

    it('lets a global admin assign on any org scan, as REST does', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.assignIssue({}, assignInput('scan-northwind-1'),
        makeGlobalAdminCtx(storage, PERMS))).resolves.toBeDefined();
    });
  });

  describe('updateAssignment', () => {
    it('refuses to update another org assignment (cross-org)', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.updateAssignment({}, { id: NORTHWIND_ASSIGNMENT.id, status: 'fixed' },
        makeOrgCtx(storage, { permissions: PERMS }))).rejects.toThrow('Assignment not found');
      expect(storage.assignments.updateAssignment).not.toHaveBeenCalled();
    });

    it('lets the owning org update its assignment', async () => {
      const storage = makeStorage();
      await resolvers.Mutation.updateAssignment({}, { id: NORTHWIND_ASSIGNMENT.id, status: 'fixed' },
        makeOrgCtx(storage, { orgId: NORTHWIND_ORG, permissions: PERMS }));
      expect(storage.assignments.updateAssignment).toHaveBeenCalled();
    });

    it('lets a global admin update any assignment, as REST does', async () => {
      const storage = makeStorage();
      await resolvers.Mutation.updateAssignment({}, { id: NORTHWIND_ASSIGNMENT.id, status: 'fixed' },
        makeGlobalAdminCtx(storage, PERMS));
      expect(storage.assignments.updateAssignment).toHaveBeenCalled();
    });
  });

  describe('deleteAssignment', () => {
    it('refuses to delete another org assignment (cross-org)', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.deleteAssignment({}, { id: NORTHWIND_ASSIGNMENT.id },
        makeOrgCtx(storage, { permissions: PERMS }))).rejects.toThrow('Assignment not found');
      expect(storage.assignments.deleteAssignment).not.toHaveBeenCalled();
    });

    it('lets the owning org delete its assignment', async () => {
      const storage = makeStorage();
      await expect(resolvers.Mutation.deleteAssignment({}, { id: NORTHWIND_ASSIGNMENT.id },
        makeOrgCtx(storage, { orgId: NORTHWIND_ORG, permissions: PERMS }))).resolves.toBe(true);
    });
  });
});
