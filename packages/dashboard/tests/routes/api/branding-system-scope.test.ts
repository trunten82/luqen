/**
 * /api/v1/branding resolves a caller with no current org to org 'system'
 * (getOrgId), and the system 'developer' role holds branding.manage — so an
 * org-less non-admin could WRITE the shared 'system' library: delete its
 * guidelines, add/remove their colors/fonts/selectors, create new 'system'
 * guidelines, and write system-level site assignments (which every org falls
 * back to). Reads stay as they are. Writes on a 'system' guideline are refused
 * with 404 "Guideline not found" (as the admin router does) unless the caller
 * is a global admin; create — which has no target guideline — answers 403.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { brandingApiRoutes } from '../../../src/routes/api/branding.js';

const SITE = 'https://fabrikam.example';

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly sys: string;
  readonly color: string;
  readonly font: string;
  readonly selector: string;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

/** An org-less caller (no currentOrgId) with the given system role. */
async function setup(role: string): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-branding-api-system-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'orgless', role };
  });
  await brandingApiRoutes(server, storage);
  await server.ready();
  const sys = randomUUID();
  await storage.branding.createGuideline({ id: sys, orgId: 'system', name: 'Shared library brand' });
  const color = (await storage.branding.addColor(sys, { id: randomUUID(), name: 'Base', hexValue: '#000000' })).id;
  const font = (await storage.branding.addFont(sys, { id: randomUUID(), family: 'Inter' })).id;
  const selector = (await storage.branding.addSelector(sys, { id: randomUUID(), pattern: '.logo' })).id;
  return {
    server, storage, sys, color, font, selector,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

const WRITES: ReadonlyArray<{ name: string; method: 'POST' | 'DELETE'; url: (c: Ctx) => string; body?: unknown }> = [
  { name: 'DELETE /guidelines/:id', method: 'DELETE', url: (c) => `/api/v1/branding/guidelines/${c.sys}` },
  { name: 'POST /guidelines/:id/colors', method: 'POST', url: (c) => `/api/v1/branding/guidelines/${c.sys}/colors`,
    body: { name: 'X', hexValue: '#111111' } },
  { name: 'DELETE /guidelines/:id/colors/:colorId', method: 'DELETE', url: (c) => `/api/v1/branding/guidelines/${c.sys}/colors/${c.color}` },
  { name: 'POST /guidelines/:id/fonts', method: 'POST', url: (c) => `/api/v1/branding/guidelines/${c.sys}/fonts`, body: { family: 'Arial' } },
  { name: 'DELETE /guidelines/:id/fonts/:fontId', method: 'DELETE', url: (c) => `/api/v1/branding/guidelines/${c.sys}/fonts/${c.font}` },
  { name: 'POST /guidelines/:id/selectors', method: 'POST', url: (c) => `/api/v1/branding/guidelines/${c.sys}/selectors`, body: { pattern: '.x' } },
  { name: 'DELETE /guidelines/:id/selectors/:selectorId', method: 'DELETE',
    url: (c) => `/api/v1/branding/guidelines/${c.sys}/selectors/${c.selector}` },
  { name: 'POST /guidelines/:id/sites', method: 'POST', url: (c) => `/api/v1/branding/guidelines/${c.sys}/sites`, body: { siteUrl: SITE } },
  { name: 'DELETE /guidelines/:id/sites', method: 'DELETE', url: (c) => `/api/v1/branding/guidelines/${c.sys}/sites`, body: { siteUrl: SITE } },
];

function send(c: Ctx, w: (typeof WRITES)[number]) {
  return c.server.inject({
    method: w.method, url: w.url(c),
    ...(w.body !== undefined ? { headers: JSON_HEADERS, payload: JSON.stringify(w.body) } : {}),
  });
}

describe("/api/v1/branding: org-less non-admins cannot write the 'system' library", () => {
  for (const w of WRITES) {
    it(`${w.name} answers 404 to an org-less developer (system write)`, async () => {
      ctx = await setup('developer');
      const res = await send(ctx, w);
      expect(res.statusCode).toBe(404);
    });
  }

  it('leaves the system guideline and its children untouched (system write)', async () => {
    ctx = await setup('developer');
    for (const w of WRITES) await send(ctx, w);
    expect(await ctx.storage.branding.getGuideline(ctx.sys)).not.toBeNull();
    expect(await ctx.storage.branding.listColors(ctx.sys)).toHaveLength(1);
    expect(await ctx.storage.branding.listFonts(ctx.sys)).toHaveLength(1);
    expect(await ctx.storage.branding.listSelectors(ctx.sys)).toHaveLength(1);
    expect(await ctx.storage.branding.getSiteAssignments(ctx.sys)).toHaveLength(0);
  });

  it("refuses an org-less developer creating a 'system' guideline with 403 (system write)", async () => {
    ctx = await setup('developer');
    const res = await ctx.server.inject({
      method: 'POST', url: '/api/v1/branding/guidelines', headers: JSON_HEADERS, payload: JSON.stringify({ name: 'Rogue' }),
    });
    expect(res.statusCode).toBe(403);
    expect((await ctx.storage.branding.listGuidelines('system')).map((g) => g.name)).not.toContain('Rogue');
  });

  it('still lets an org-less developer read a system guideline', async () => {
    ctx = await setup('developer');
    const res = await ctx.server.inject({ method: 'GET', url: `/api/v1/branding/guidelines/${ctx.sys}` });
    expect(res.statusCode).toBe(200);
  });

  it('still lists system guidelines to an org-less developer', async () => {
    ctx = await setup('developer');
    const res = await ctx.server.inject({ method: 'GET', url: '/api/v1/branding/guidelines' });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain(ctx.sys);
  });

  it('lets an org-less global admin remove a system color', async () => {
    ctx = await setup('admin');
    const res = await ctx.server.inject({ method: 'DELETE', url: `/api/v1/branding/guidelines/${ctx.sys}/colors/${ctx.color}` });
    expect(res.statusCode).toBe(200);
    expect(await ctx.storage.branding.listColors(ctx.sys)).toHaveLength(0);
  });

  it('lets an org-less global admin create a system guideline', async () => {
    ctx = await setup('admin');
    const res = await ctx.server.inject({
      method: 'POST', url: '/api/v1/branding/guidelines', headers: JSON_HEADERS, payload: JSON.stringify({ name: 'Library' }),
    });
    expect(res.statusCode).toBe(201);
  });
});
