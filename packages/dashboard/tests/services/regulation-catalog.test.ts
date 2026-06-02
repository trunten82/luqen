import { describe, it, expect, afterEach } from 'vitest';
import {
  initRegulationCatalog,
  resetRegulationCatalog,
  resolveRegulationDetails,
} from '../../src/services/regulation-catalog.js';

/** Minimal ComplianceService stand-in for the resolver's two calls. */
function fakeService(regs: Array<{ id: string; name: string; shortName?: string; reference?: string; description?: string; enforcementDate?: string; url?: string }>, opts: { throwOnList?: boolean } = {}) {
  return {
    getToken: async () => 'tkn',
    safeListRegulations: async () => {
      if (opts.throwOnList) throw new Error('compliance down');
      return regs;
    },
  } as unknown as Parameters<typeof initRegulationCatalog>[0];
}

describe('resolveRegulationDetails', () => {
  afterEach(() => resetRegulationCatalog());

  it('returns an empty map before init (graceful — never blocks the report)', async () => {
    const m = await resolveRegulationDetails(['US-ADA']);
    expect(m.size).toBe(0);
  });

  it('returns an empty map for an empty id list', async () => {
    initRegulationCatalog(fakeService([{ id: 'US-ADA', name: 'ADA' }]));
    expect((await resolveRegulationDetails([])).size).toBe(0);
  });

  it('resolves only the requested ids and carries the context fields', async () => {
    initRegulationCatalog(fakeService([
      { id: 'US-ADA', name: 'Americans with Disabilities Act', shortName: 'ADA', reference: '42 U.S.C. § 12101', description: 'desc', enforcementDate: '1990-07-26', url: 'https://x' },
      { id: 'EU-EAA', name: 'European Accessibility Act' },
      { id: 'US-508', name: 'Section 508' },
    ]));
    const m = await resolveRegulationDetails(['US-ADA', 'US-508']);
    expect([...m.keys()].sort()).toEqual(['US-508', 'US-ADA']);
    const ada = m.get('US-ADA')!;
    expect(ada.name).toBe('Americans with Disabilities Act');
    expect(ada.reference).toBe('42 U.S.C. § 12101');
    expect(ada.description).toBe('desc');
    expect(ada.enforcementDate).toBe('1990-07-26');
    expect(m.has('EU-EAA')).toBe(false);
  });

  it('degrades to an empty map when the compliance call throws', async () => {
    initRegulationCatalog(fakeService([], { throwOnList: true }));
    expect((await resolveRegulationDetails(['US-ADA'])).size).toBe(0);
  });
});
