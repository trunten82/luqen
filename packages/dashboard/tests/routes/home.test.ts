import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestServer, type TestContext } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

interface HomeData {
  template: string;
  data: {
    pageTitle: string;
    currentPath: string;
    user: unknown;
    stats: {
      totalScans: number;
      scansThisWeek: number;
      pagesScanned: number;
      issuesFound: number;
      sitesMonitored: number;
      trendDirection: string;
      complianceRate: number;
    };
    jurisdictions: Array<{ id: string; name: string }>;
    regulations: Array<{ id: string; name: string; shortName: string; jurisdictionId: string }>;
    recentScans: Array<{
      id: string;
      siteUrl: string;
      jurisdictions: string;
      createdAtDisplay: string;
      completedAtDisplay: string;
    }>;
  };
}

function createScanInput(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [] as string[],
    createdBy: 'testuser',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Home routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /', () => {
    it('redirects to /home', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers['location']).toBe('/home');
    });
  });

  describe('GET /home', () => {
    it('returns 200 with home template data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as HomeData;
      expect(body.template).toBe('home.hbs');
    });

    it('includes pageTitle and currentPath', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.pageTitle).toBe('Home');
      expect(body.data.currentPath).toBe('/home');
    });

    it('includes stats in template data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats).toBeDefined();
      expect(typeof body.data.stats.totalScans).toBe('number');
    });

    it('counts total scans correctly', async () => {
      for (let i = 0; i < 3; i++) {
        await ctx.storage.scans.createScan(createScanInput({
          siteUrl: `https://site${i}.com`,
        }));
      }

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.totalScans).toBe(3);
    });

    it('includes recent scans in template data', async () => {
      const id = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id }));

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.recentScans).toHaveLength(1);
      expect(body.data.recentScans[0].id).toBe(id);
    });

    it('limits recent scans to 10', async () => {
      for (let i = 0; i < 15; i++) {
        await ctx.storage.scans.createScan(createScanInput({
          siteUrl: `https://site${i}.com`,
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        }));
      }

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.recentScans).toHaveLength(10);
    });

    it('counts scans this week correctly', async () => {
      // Create a scan from today (within this week)
      await ctx.storage.scans.createScan(createScanInput({
        siteUrl: 'https://recent.com',
        createdAt: new Date().toISOString(),
      }));

      // Create a scan from 2 weeks ago (outside this week)
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      await ctx.storage.scans.createScan(createScanInput({
        siteUrl: 'https://old.com',
        createdAt: twoWeeksAgo,
      }));

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.scansThisWeek).toBe(1);
      expect(body.data.stats.totalScans).toBe(2);
    });

    it('sums pagesScanned across all scans', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id: id1, siteUrl: 'https://a.com' }));
      await ctx.storage.scans.createScan(createScanInput({ id: id2, siteUrl: 'https://b.com' }));
      await ctx.storage.scans.updateScan(id1, { pagesScanned: 5 });
      await ctx.storage.scans.updateScan(id2, { pagesScanned: 10 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.pagesScanned).toBe(15);
    });

    it('sums issuesFound across all scans', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id: id1, siteUrl: 'https://a.com' }));
      await ctx.storage.scans.createScan(createScanInput({ id: id2, siteUrl: 'https://b.com' }));
      await ctx.storage.scans.updateScan(id1, { totalIssues: 3 });
      await ctx.storage.scans.updateScan(id2, { totalIssues: 7 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.issuesFound).toBe(10);
    });

    it('handles scans with no pagesScanned or totalIssues (defaults to 0)', async () => {
      await ctx.storage.scans.createScan(createScanInput());

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.pagesScanned).toBe(0);
      expect(body.data.stats.issuesFound).toBe(0);
    });

    it('counts unique sites monitored from completed scans', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id: id1, siteUrl: 'https://a.com' }));
      await ctx.storage.scans.createScan(createScanInput({ id: id2, siteUrl: 'https://a.com' }));
      await ctx.storage.scans.createScan(createScanInput({ id: id3, siteUrl: 'https://b.com' }));
      await ctx.storage.scans.updateScan(id1, { status: 'completed' });
      await ctx.storage.scans.updateScan(id2, { status: 'completed' });
      await ctx.storage.scans.updateScan(id3, { status: 'completed' });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      // 2 unique URLs: a.com and b.com
      expect(body.data.stats.sitesMonitored).toBe(2);
    });

    it('reports trendDirection as "No data" when no completed scans', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.trendDirection).toBe('No data');
    });

    it('reports trendDirection as "Stable" when completed scans exist but no trend change', async () => {
      const id = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id, siteUrl: 'https://stable.com' }));
      await ctx.storage.scans.updateScan(id, { status: 'completed', totalIssues: 5 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      // Only one scan per site, so no comparison possible -> Stable
      expect(body.data.stats.trendDirection).toBe('Stable');
    });

    it('reports trendDirection as "Improving" when issues decrease', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      // Older scan with more issues
      await ctx.storage.scans.createScan(createScanInput({
        id: id1,
        siteUrl: 'https://improving.com',
        createdAt: new Date(Date.now() - 10000).toISOString(),
      }));
      await ctx.storage.scans.updateScan(id1, { status: 'completed', totalIssues: 10 });

      // Newer scan with fewer issues
      await ctx.storage.scans.createScan(createScanInput({
        id: id2,
        siteUrl: 'https://improving.com',
        createdAt: new Date().toISOString(),
      }));
      await ctx.storage.scans.updateScan(id2, { status: 'completed', totalIssues: 3 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.trendDirection).toBe('Improving');
    });

    it('reports trendDirection as "Regressing" when issues increase', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({
        id: id1,
        siteUrl: 'https://regressing.com',
        createdAt: new Date(Date.now() - 10000).toISOString(),
      }));
      await ctx.storage.scans.updateScan(id1, { status: 'completed', totalIssues: 3 });

      await ctx.storage.scans.createScan(createScanInput({
        id: id2,
        siteUrl: 'https://regressing.com',
        createdAt: new Date().toISOString(),
      }));
      await ctx.storage.scans.updateScan(id2, { status: 'completed', totalIssues: 10 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.trendDirection).toBe('Regressing');
    });

    it('reports trendDirection as "Stable" when improving equals regressing', async () => {
      // Site 1: improving (10 -> 3)
      const id1 = randomUUID();
      const id2 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({
        id: id1,
        siteUrl: 'https://improving.com',
        createdAt: new Date(Date.now() - 20000).toISOString(),
      }));
      await ctx.storage.scans.updateScan(id1, { status: 'completed', totalIssues: 10 });
      await ctx.storage.scans.createScan(createScanInput({
        id: id2,
        siteUrl: 'https://improving.com',
        createdAt: new Date(Date.now() - 10000).toISOString(),
      }));
      await ctx.storage.scans.updateScan(id2, { status: 'completed', totalIssues: 3 });

      // Site 2: regressing (3 -> 10)
      const id3 = randomUUID();
      const id4 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({
        id: id3,
        siteUrl: 'https://regressing.com',
        createdAt: new Date(Date.now() - 20000).toISOString(),
      }));
      await ctx.storage.scans.updateScan(id3, { status: 'completed', totalIssues: 3 });
      await ctx.storage.scans.createScan(createScanInput({
        id: id4,
        siteUrl: 'https://regressing.com',
        createdAt: new Date().toISOString(),
      }));
      await ctx.storage.scans.updateScan(id4, { status: 'completed', totalIssues: 10 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.trendDirection).toBe('Stable');
    });

    it('calculates complianceRate correctly', async () => {
      // 2 compliant (0 errors), 1 non-compliant (has errors)
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();

      await ctx.storage.scans.createScan(createScanInput({ id: id1, siteUrl: 'https://a.com' }));
      await ctx.storage.scans.updateScan(id1, { status: 'completed', errors: 0 });

      await ctx.storage.scans.createScan(createScanInput({ id: id2, siteUrl: 'https://b.com' }));
      await ctx.storage.scans.updateScan(id2, { status: 'completed', errors: 0 });

      await ctx.storage.scans.createScan(createScanInput({ id: id3, siteUrl: 'https://c.com' }));
      await ctx.storage.scans.updateScan(id3, { status: 'completed', errors: 5 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      // 2 out of 3 compliant => 67%
      expect(body.data.stats.complianceRate).toBe(67);
    });

    it('returns complianceRate 0 when no completed scans', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.complianceRate).toBe(0);
    });

    it('returns complianceRate 100 when all scans have 0 errors', async () => {
      const id = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id }));
      await ctx.storage.scans.updateScan(id, { status: 'completed', errors: 0 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.complianceRate).toBe(100);
    });

    it('formats recentScans with display dates and joined jurisdictions', async () => {
      const id = randomUUID();
      const now = new Date().toISOString();
      await ctx.storage.scans.createScan(createScanInput({
        id,
        jurisdictions: ['US', 'EU'],
        createdAt: now,
      }));
      await ctx.storage.scans.updateScan(id, {
        status: 'completed',
        completedAt: now,
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      const scan = body.data.recentScans[0];
      expect(scan.jurisdictions).toBe('US, EU');
      expect(scan.createdAtDisplay).toBeTruthy();
      expect(scan.completedAtDisplay).toBeTruthy();
    });

    it('returns empty completedAtDisplay for incomplete scans', async () => {
      const id = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id }));

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      const scan = body.data.recentScans[0];
      expect(scan.completedAtDisplay).toBe('');
    });

    it('returns empty jurisdictions and regulations arrays (compliance fetch fails silently)', async () => {
      // complianceUrl is set in test config but the server is not running,
      // so the fetch should fail silently and return empty arrays
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.jurisdictions).toEqual([]);
      expect(body.data.regulations).toEqual([]);
    });

    it('does not count non-completed scans in sitesMonitored', async () => {
      const id = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({ id, siteUrl: 'https://queued.com' }));
      // Status stays 'queued' by default

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      expect(body.data.stats.sitesMonitored).toBe(0);
    });

    it('ignores non-completed scans for trend calculation', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await ctx.storage.scans.createScan(createScanInput({
        id: id1,
        siteUrl: 'https://trend.com',
        createdAt: new Date(Date.now() - 10000).toISOString(),
      }));
      // Leave as queued (non-completed)
      await ctx.storage.scans.updateScan(id1, { totalIssues: 10 });

      await ctx.storage.scans.createScan(createScanInput({
        id: id2,
        siteUrl: 'https://trend.com',
        createdAt: new Date().toISOString(),
      }));
      await ctx.storage.scans.updateScan(id2, { totalIssues: 1 });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as HomeData;
      // Neither scan is completed, so no trend data
      expect(body.data.stats.trendDirection).toBe('No data');
    });
  });
});
