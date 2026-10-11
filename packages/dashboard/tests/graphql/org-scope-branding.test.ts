/**
 * Branding resolvers mirror the JSON API in routes/api/branding.ts: every
 * guideline-addressed route does `guideline === null || guideline.orgId !== orgId`
 * → 404 "Guideline not found", with NO admin bypass. GraphQL's remove* mutations
 * address a color/font/selector by its own id, so the owning guideline is
 * resolved among the caller org's guidelines; a child outside them is refused
 * exactly as a missing one.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvers } from '../../src/graphql/resolvers.js';
import { FABRIKAM_ORG, NORTHWIND_ORG, makeOrgCtx, makeGlobalAdminCtx } from './helpers/org-ctx.js';

const VIEW = ['branding.view'];
const MANAGE = ['branding.manage'];

const NW_GUIDELINE = {
  id: 'gl-northwind-1', orgId: NORTHWIND_ORG, name: 'Northwind brand', active: true,
  colors: [], fonts: [], selectors: [],
};
const NW_COLOR = { id: 'color-northwind-1', guidelineId: NW_GUIDELINE.id, name: 'Primary', hexValue: '#112233' };
const NW_FONT = { id: 'font-northwind-1', guidelineId: NW_GUIDELINE.id, family: 'Inter' };
const NW_SELECTOR = { id: 'sel-northwind-1', guidelineId: NW_GUIDELINE.id, pattern: '.nw-logo' };

function makeStorage() {
  const byOrg = (orgId: string) => (orgId === NORTHWIND_ORG ? [NW_GUIDELINE] : []);
  const ofGuideline = <T>(item: T) => async (gid: string) => (gid === NW_GUIDELINE.id ? [item] : []);
  return {
    branding: {
      getGuideline: vi.fn(async (id: string) => (id === NW_GUIDELINE.id ? NW_GUIDELINE : null)),
      listGuidelines: vi.fn(async (orgId: string) => byOrg(orgId)),
      listColors: vi.fn(ofGuideline(NW_COLOR)),
      listFonts: vi.fn(ofGuideline(NW_FONT)),
      listSelectors: vi.fn(ofGuideline(NW_SELECTOR)),
      getSiteAssignments: vi.fn(async () => []),
      deleteGuideline: vi.fn(async () => undefined),
      updateGuideline: vi.fn(async (id: string, data: Record<string, unknown>) => ({ ...NW_GUIDELINE, id, ...data })),
      addColor: vi.fn(async (gid: string, c: Record<string, unknown>) => ({ ...c, guidelineId: gid })),
      addFont: vi.fn(async (gid: string, f: Record<string, unknown>) => ({ ...f, guidelineId: gid })),
      addSelector: vi.fn(async (gid: string, s: Record<string, unknown>) => ({ ...s, guidelineId: gid })),
      removeColor: vi.fn(async () => undefined),
      removeFont: vi.fn(async () => undefined),
      removeSelector: vi.fn(async () => undefined),
      assignToSite: vi.fn(async () => undefined),
    },
    scans: { listScans: vi.fn(async () => []) },
  };
}

type Storage = ReturnType<typeof makeStorage>;
const fabrikam = (s: Storage) => makeOrgCtx(s, { orgId: FABRIKAM_ORG, permissions: [...VIEW, ...MANAGE] });
const northwind = (s: Storage) => makeOrgCtx(s, { orgId: NORTHWIND_ORG, permissions: [...VIEW, ...MANAGE] });

describe('GraphQL branding org scoping', () => {
  describe('Query.brandingGuideline', () => {
    it('returns null for another org guideline (cross-org)', async () => {
      expect(await resolvers.Query.brandingGuideline({}, { id: NW_GUIDELINE.id }, fabrikam(makeStorage()))).toBeNull();
    });

    it('returns null for another org guideline even to a global admin (cross-org)', async () => {
      const ctx = makeGlobalAdminCtx(makeStorage(), VIEW);
      expect(await resolvers.Query.brandingGuideline({}, { id: NW_GUIDELINE.id }, ctx)).toBeNull();
    });

    it('returns the guideline to its own org', async () => {
      const result = await resolvers.Query.brandingGuideline({}, { id: NW_GUIDELINE.id }, northwind(makeStorage()));
      expect(result?.id).toBe(NW_GUIDELINE.id);
    });
  });

  describe('guideline-addressed mutations', () => {
    const cases: ReadonlyArray<{
      name: string;
      run: (ctx: ReturnType<typeof fabrikam>) => Promise<unknown>;
      write: keyof Storage['branding'];
    }> = [
      { name: 'deleteBrandingGuideline', write: 'deleteGuideline',
        run: (ctx) => resolvers.Mutation.deleteBrandingGuideline({}, { id: NW_GUIDELINE.id }, ctx) },
      { name: 'toggleBrandingGuideline', write: 'updateGuideline',
        run: (ctx) => resolvers.Mutation.toggleBrandingGuideline({}, { id: NW_GUIDELINE.id }, ctx) },
      { name: 'addBrandColor', write: 'addColor',
        run: (ctx) => resolvers.Mutation.addBrandColor({}, { guidelineId: NW_GUIDELINE.id, input: { name: 'X', hexValue: '#000000' } }, ctx) },
      { name: 'addBrandFont', write: 'addFont',
        run: (ctx) => resolvers.Mutation.addBrandFont({}, { guidelineId: NW_GUIDELINE.id, input: { family: 'Arial' } }, ctx) },
      { name: 'addBrandSelector', write: 'addSelector',
        run: (ctx) => resolvers.Mutation.addBrandSelector({}, { guidelineId: NW_GUIDELINE.id, input: { pattern: '.x' } }, ctx) },
      { name: 'assignBrandingToSite', write: 'assignToSite',
        run: (ctx) => resolvers.Mutation.assignBrandingToSite({}, { guidelineId: NW_GUIDELINE.id, siteUrl: 'https://fabrikam.example' }, ctx) },
    ];

    for (const c of cases) {
      it(`${c.name} refuses another org guideline (cross-org)`, async () => {
        const storage = makeStorage();
        await expect(c.run(fabrikam(storage))).rejects.toThrow('Guideline not found');
        expect(storage.branding[c.write]).not.toHaveBeenCalled();
      });

      it(`${c.name} refuses another org guideline even for a global admin (cross-org)`, async () => {
        const storage = makeStorage();
        await expect(c.run(makeGlobalAdminCtx(storage, MANAGE))).rejects.toThrow('Guideline not found');
        expect(storage.branding[c.write]).not.toHaveBeenCalled();
      });

      it(`${c.name} works on the caller org guideline`, async () => {
        const storage = makeStorage();
        await c.run(northwind(storage));
        expect(storage.branding[c.write]).toHaveBeenCalled();
      });
    }
  });

  describe('child-addressed remove mutations', () => {
    const cases: ReadonlyArray<{
      name: string;
      id: string;
      run: (id: string, ctx: ReturnType<typeof fabrikam>) => Promise<unknown>;
      write: keyof Storage['branding'];
    }> = [
      { name: 'removeBrandColor', id: NW_COLOR.id, write: 'removeColor',
        run: (id, ctx) => resolvers.Mutation.removeBrandColor({}, { id }, ctx) },
      { name: 'removeBrandFont', id: NW_FONT.id, write: 'removeFont',
        run: (id, ctx) => resolvers.Mutation.removeBrandFont({}, { id }, ctx) },
      { name: 'removeBrandSelector', id: NW_SELECTOR.id, write: 'removeSelector',
        run: (id, ctx) => resolvers.Mutation.removeBrandSelector({}, { id }, ctx) },
    ];

    for (const c of cases) {
      it(`${c.name} refuses a child of another org guideline (cross-org)`, async () => {
        const storage = makeStorage();
        await expect(c.run(c.id, fabrikam(storage))).rejects.toThrow('not found');
        expect(storage.branding[c.write]).not.toHaveBeenCalled();
      });

      it(`${c.name} removes a child of the caller org guideline`, async () => {
        const storage = makeStorage();
        await expect(c.run(c.id, northwind(storage))).resolves.toBe(true);
        expect(storage.branding[c.write]).toHaveBeenCalledWith(c.id);
      });
    }
  });
});
