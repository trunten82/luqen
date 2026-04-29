import { describe, it, expect } from 'vitest';
import {
  BrandingRepoBrandContextProvider,
  staticBrandContextProvider,
  DEFAULT_BRAND_PRIMARY_COLOR,
} from '../../src/notifications/brand-context.js';
import type { BrandingRepository } from '../../src/db/interfaces/branding-repository.js';
import type { BrandingGuidelineRecord } from '../../src/db/types.js';

function fakeRepo(byOrg: Record<string, BrandingGuidelineRecord[]>): BrandingRepository {
  return {
    listGuidelines: async (orgId: string) => byOrg[orgId] ?? [],
    listColors: async (id: string) => {
      for (const g of Object.values(byOrg).flat()) {
        if (g.id === id) return g.colors ?? [];
      }
      return [];
    },
  } as unknown as BrandingRepository;
}

describe('BrandingRepoBrandContextProvider', () => {
  it('returns null when org has no guidelines', async () => {
    const p = new BrandingRepoBrandContextProvider(fakeRepo({}));
    expect(await p.get('o')).toBeNull();
  });

  it('picks active guideline + primary color usage', async () => {
    const repo = fakeRepo({
      'o-1': [
        {
          id: 'g1', orgId: 'o-1', name: 'Brand', version: 1, active: true,
          createdAt: 'x', updatedAt: 'x',
          imagePath: '/var/lib/luqen/logo.png',
          colors: [
            { id: 'c1', guidelineId: 'g1', name: 'Brand red', hexValue: '#ff0000', usage: 'primary' },
            { id: 'c2', guidelineId: 'g1', name: 'Accent', hexValue: '#00ff00', usage: 'secondary' },
          ],
        },
      ],
    });
    const ctx = await new BrandingRepoBrandContextProvider(repo).get('o-1');
    expect(ctx?.colors.primary).toBe('#ff0000');
    expect(ctx?.colors.secondary).toBe('#00ff00');
    expect(ctx?.logoSource).toBe('/var/lib/luqen/logo.png');
  });

  it('falls back to default primary when no valid hex available', async () => {
    const repo = fakeRepo({
      'o': [
        {
          id: 'g', orgId: 'o', name: 'B', version: 1, active: true,
          createdAt: 'x', updatedAt: 'x', colors: [],
        },
      ],
    });
    const ctx = await new BrandingRepoBrandContextProvider(repo).get('o');
    expect(ctx?.colors.primary).toBe(DEFAULT_BRAND_PRIMARY_COLOR);
  });
});

describe('staticBrandContextProvider', () => {
  it('returns the configured map values', async () => {
    const p = staticBrandContextProvider({
      'org-a': { orgId: 'org-a', colors: { primary: '#abcdef' } },
    });
    expect((await p.get('org-a'))?.colors.primary).toBe('#abcdef');
    expect(await p.get('other')).toBeNull();
  });
});
