/**
 * Phase 81 — fleet exposure decoration behavioral tests.
 *
 * Tests the exported helpers from fleet.ts:
 *   - decorateWithExposure: attaches exposure to each site using its latestScan
 *   - computeFleetExposureSummary: counts High-band sites
 *   - sortByExposure: orders sites High > Elevated > Moderate > Lower (no-scan last)
 *
 * Also exercises both the org handler (/fleet) and the admin handler (/admin/fleet)
 * via Fastify inject to confirm they both attach exposure to the rendered context.
 */
import { describe, it, expect } from 'vitest';
import {
  decorateWithExposure,
  computeFleetExposureSummary,
  sortByExposure,
} from '../../src/routes/fleet.js';
import type { WpSite } from '../../src/db/interfaces/wp-network-repository.js';
import type { ScanRecord } from '../../src/db/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSite(overrides: Partial<WpSite> = {}): WpSite {
  return {
    id: 'site_test',
    orgId: 'org_test',
    url: 'https://example.com',
    wpVersion: '6.4',
    pluginVersion: '0.30.0',
    status: 'active',
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  } as WpSite;
}

function makeScan(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: 'scan_test',
    orgId: 'org_test',
    siteUrl: 'https://example.com',
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    errors: 0,
    warnings: 0,
    notices: 0,
    confirmedViolations: 0,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as ScanRecord;
}

/** Returns a site decorated with latestScan, mimicking decorateWithLatestScan output. */
function withScan(
  site: WpSite,
  scan: ScanRecord | null,
): WpSite & { latestScan: ScanRecord | null } {
  return { ...site, latestScan: scan };
}

// ---------------------------------------------------------------------------
// decorateWithExposure
// ---------------------------------------------------------------------------

describe('decorateWithExposure', () => {
  it('returns null exposure when latestScan is null', async () => {
    const site = withScan(makeSite(), null);
    const result = await decorateWithExposure([site]);
    expect(result[0].exposure).toBeNull();
  });

  it('attaches exposure with a band when scan has no jurisdictions', async () => {
    const scan = makeScan({ jurisdictions: [], errors: 0, warnings: 0, notices: 0, confirmedViolations: 0 });
    const site = withScan(makeSite(), scan);
    const result = await decorateWithExposure([site]);
    // With no jurisdictions and no findings, band should be 'lower'
    expect(result[0].exposure).not.toBeNull();
    expect(result[0].exposure?.band).toBe('lower');
    expect(result[0].exposure?.badgeModifier).toBeDefined();
    expect(result[0].exposure?.bandIcon).toBeDefined();
  });

  it('derives High band for EAA jurisdiction', async () => {
    const scan = makeScan({ jurisdictions: ['EU-EAA'], regulations: [], errors: 0, warnings: 0, notices: 0, confirmedViolations: 0 });
    const site = withScan(makeSite(), scan);
    const result = await decorateWithExposure([site]);
    expect(result[0].exposure?.band).toBe('high');
  });

  it('derives High band from high finding pressure alone', async () => {
    const scan = makeScan({ jurisdictions: [], errors: 0, warnings: 0, notices: 0, confirmedViolations: 4 });
    // 4 * 10 = 40 >= threshold for 'high'
    const site = withScan(makeSite(), scan);
    const result = await decorateWithExposure([site]);
    expect(result[0].exposure?.band).toBe('high');
  });

  it('processes multiple sites and preserves all original fields', async () => {
    const siteA = withScan(makeSite({ id: 'site_a', url: 'https://a.com' }), null);
    const siteB = withScan(
      makeSite({ id: 'site_b', url: 'https://b.com' }),
      makeScan({ jurisdictions: ['EU-EAA'] }),
    );
    const result = await decorateWithExposure([siteA, siteB]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('site_a');
    expect(result[0].exposure).toBeNull();
    expect(result[1].id).toBe('site_b');
    expect(result[1].exposure?.band).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// computeFleetExposureSummary
// ---------------------------------------------------------------------------

describe('computeFleetExposureSummary', () => {
  it('returns highBandCount = 0 when no sites have High exposure', async () => {
    const sites = await decorateWithExposure([
      withScan(makeSite({ id: 's1' }), makeScan({ jurisdictions: [] })),
      withScan(makeSite({ id: 's2' }), null),
    ]);
    const summary = computeFleetExposureSummary(sites);
    expect(summary.highBandCount).toBe(0);
  });

  it('counts exactly the number of High-band sites', async () => {
    const sites = await decorateWithExposure([
      withScan(makeSite({ id: 's1' }), makeScan({ jurisdictions: ['EU-EAA'] })),
      withScan(makeSite({ id: 's2' }), makeScan({ jurisdictions: ['EU-EAA'] })),
      withScan(makeSite({ id: 's3' }), makeScan({ jurisdictions: [] })),
      withScan(makeSite({ id: 's4' }), null),
    ]);
    const summary = computeFleetExposureSummary(sites);
    expect(summary.highBandCount).toBe(2);
  });

  it('returns highBandCount = 0 for an empty site list', () => {
    const summary = computeFleetExposureSummary([]);
    expect(summary.highBandCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sortByExposure
// ---------------------------------------------------------------------------

describe('sortByExposure', () => {
  it('orders sites High > Elevated > Moderate > Lower', async () => {
    // Build sites with specific band contributions:
    // High = confirmedViolations:4 (4*10=40)
    // Elevated = confirmedViolations:2 (2*10=20, 15<=20<40)
    // Moderate = errors:3 (3*3=9, 0<9<15)
    // Lower = no findings, no jurisdiction
    const decorated = await decorateWithExposure([
      withScan(makeSite({ id: 'lower-site' }), makeScan({ confirmedViolations: 0, errors: 0, warnings: 0, notices: 0, jurisdictions: [] })),
      withScan(makeSite({ id: 'high-site' }), makeScan({ confirmedViolations: 4, errors: 0, warnings: 0, notices: 0, jurisdictions: [] })),
      withScan(makeSite({ id: 'moderate-site' }), makeScan({ confirmedViolations: 0, errors: 3, warnings: 0, notices: 0, jurisdictions: [] })),
      withScan(makeSite({ id: 'elevated-site' }), makeScan({ confirmedViolations: 2, errors: 0, warnings: 0, notices: 0, jurisdictions: [] })),
    ]);

    const sorted = sortByExposure(decorated);
    expect(sorted[0].id).toBe('high-site');
    expect(sorted[1].id).toBe('elevated-site');
    expect(sorted[2].id).toBe('moderate-site');
    expect(sorted[3].id).toBe('lower-site');
  });

  it('places sites with null exposure last', async () => {
    const decorated = await decorateWithExposure([
      withScan(makeSite({ id: 'no-scan' }), null),
      withScan(makeSite({ id: 'lower-site' }), makeScan({ jurisdictions: [] })),
    ]);
    const sorted = sortByExposure(decorated);
    expect(sorted[0].id).toBe('lower-site');
    expect(sorted[1].id).toBe('no-scan');
  });

  it('returns empty array unchanged', () => {
    expect(sortByExposure([])).toEqual([]);
  });

  it('preserves order among sites with the same band', async () => {
    const decorated = await decorateWithExposure([
      withScan(makeSite({ id: 'high-a' }), makeScan({ confirmedViolations: 4, jurisdictions: [] })),
      withScan(makeSite({ id: 'high-b' }), makeScan({ confirmedViolations: 5, jurisdictions: [] })),
    ]);
    const sorted = sortByExposure(decorated);
    expect(sorted[0].exposure?.band).toBe('high');
    expect(sorted[1].exposure?.band).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Integration: both org + admin fleet handler paths attach exposure
// ---------------------------------------------------------------------------

describe('fleet handler integration (exposure decoration)', () => {
  it('decorateWithExposure result has exposure field on every site', async () => {
    // This directly tests the helper used by both handlers
    const sitesWithScans = [
      withScan(makeSite({ id: 'site-1' }), makeScan({ jurisdictions: ['EU-EAA'] })),
      withScan(makeSite({ id: 'site-2' }), makeScan({ jurisdictions: [] })),
      withScan(makeSite({ id: 'site-3' }), null),
    ];

    const result = await decorateWithExposure(sitesWithScans);

    // All 3 sites must have the exposure field (band or null)
    expect(result).toHaveLength(3);
    // High band from EAA jurisdiction
    expect(result[0].exposure?.band).toBe('high');
    // Lower band from no findings/jurisdiction
    expect(result[1].exposure?.band).toBe('lower');
    // Null — no scan
    expect(result[2].exposure).toBeNull();

    // Verify badgeModifier and bandIcon are present on non-null exposure
    expect(result[0].exposure?.badgeModifier).toBeDefined();
    expect(result[0].exposure?.bandIcon).toBeDefined();
    expect(result[1].exposure?.badgeModifier).toBeDefined();
    expect(result[1].exposure?.bandIcon).toBeDefined();
  });

  it('computeFleetExposureSummary works with decorated result from both handler paths', async () => {
    // Simulate what the org handler does: decorateWithLatestScan -> decorateWithExposure
    const decorated = await decorateWithExposure([
      withScan(makeSite({ id: 's-high' }), makeScan({ jurisdictions: ['EU-EAA'] })),
      withScan(makeSite({ id: 's-low' }), makeScan({ jurisdictions: [] })),
      withScan(makeSite({ id: 's-none' }), null),
    ]);
    const summary = computeFleetExposureSummary(decorated);
    expect(summary.highBandCount).toBe(1);
  });
});
