import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestServer, type TestContext } from '../helpers/server.js';

interface BookmarkletData {
  template: string;
  data: {
    pageTitle: string;
    currentPath: string;
    user: unknown;
    dashboardUrl: string;
  };
}

describe('Tool routes', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('GET /tools/bookmarklet', () => {
    it('returns 200 with bookmarklet template', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as BookmarkletData;
      expect(body.template).toBe('bookmarklet.hbs');
    });

    it('includes pageTitle as Bookmarklet', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      const body = response.json() as BookmarkletData;
      expect(body.data.pageTitle).toBe('Bookmarklet');
    });

    it('includes currentPath as /tools/bookmarklet', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      const body = response.json() as BookmarkletData;
      expect(body.data.currentPath).toBe('/tools/bookmarklet');
    });

    it('includes dashboardUrl derived from request', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      const body = response.json() as BookmarkletData;
      expect(body.data.dashboardUrl).toBeTruthy();
      // The URL should contain the protocol and hostname
      expect(body.data.dashboardUrl).toMatch(/^https?:\/\/.+/);
    });

    it('user is undefined when not authenticated', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      const body = response.json() as BookmarkletData;
      // request.user is undefined when not authenticated, so JSON serialization drops it
      expect(body.data.user).toBeUndefined();
    });

    it('returns JSON content type from view stub', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/bookmarklet',
      });

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('returns 404 for non-existent tool routes', async () => {
      const response = await ctx.server.inject({
        method: 'GET',
        url: '/tools/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('does not accept POST method', async () => {
      const response = await ctx.server.inject({
        method: 'POST',
        url: '/tools/bookmarklet',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
