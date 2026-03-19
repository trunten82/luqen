import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestServer, type TestContext } from '../helpers/server.js';
import { randomUUID } from 'node:crypto';

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
      const body = response.json() as { template: string; data: unknown };
      expect(body.template).toBe('home.hbs');
    });

    it('includes stats in template data', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as { template: string; data: { stats: { totalScans: number } } };
      expect(body.data.stats).toBeDefined();
      expect(typeof body.data.stats.totalScans).toBe('number');
    });

    it('counts total scans correctly', async () => {
      // Create 3 scans
      for (let i = 0; i < 3; i++) {
        ctx.db.createScan({
          id: randomUUID(),
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'testuser',
          createdAt: new Date().toISOString(),
        });
      }

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as { data: { stats: { totalScans: number } } };
      expect(body.data.stats.totalScans).toBe(3);
    });

    it('includes recent scans in template data', async () => {
      const id = randomUUID();
      ctx.db.createScan({
        id,
        siteUrl: 'https://example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'testuser',
        createdAt: new Date().toISOString(),
      });

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as { data: { recentScans: Array<{ id: string }> } };
      expect(body.data.recentScans).toHaveLength(1);
      expect(body.data.recentScans[0].id).toBe(id);
    });

    it('limits recent scans to 10', async () => {
      for (let i = 0; i < 15; i++) {
        ctx.db.createScan({
          id: randomUUID(),
          siteUrl: `https://site${i}.com`,
          standard: 'WCAG2AA',
          jurisdictions: [],
          createdBy: 'testuser',
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        });
      }

      const response = await ctx.server.inject({
        method: 'GET',
        url: '/home',
      });

      const body = response.json() as { data: { recentScans: unknown[] } };
      expect(body.data.recentScans).toHaveLength(10);
    });
  });
});
