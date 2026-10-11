/**
 * Org scoping for the HTML admin branding routes addressed by guideline id.
 *
 * Rule (matches this router's own list view and upload-css guard, answered as
 * /api/v1/branding does, with 404 "not found"):
 *   - a global admin (bypassesOrgScope) may act on any guideline;
 *   - anyone else only on a guideline of their current org;
 *   - read/link routes (detail page, site link/unlink) additionally admit the
 *     shared 'system' library, which org users browse and link to their sites;
 *   - child deletes (colors/fonts/selectors) also require the child to belong
 *     to the guideline in the URL.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { brandingGuidelineRoutes } from '../../../src/routes/admin/branding-guidelines.js';

const FABRIKAM_ORG = 'org-fabrikam';
const NORTHWIND_ORG = 'org-northwind';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

interface Actor { readonly role: string; readonly currentOrgId?: string; readonly orgScopedApiKey?: boolean }
interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly nw: string;
  readonly fb: string;
  readonly sys: string;
  readonly nwColor: string;
  readonly nwFont: string;
  readonly nwSelector: string;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(actor: Actor): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-branding-scope-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', ...actor };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['branding.view', 'branding.manage']);
  });
  await brandingGuidelineRoutes(server, storage, () => null);
  await server.ready();

  const nw = randomUUID();
  const fb = randomUUID();
  const sys = randomUUID();
  await storage.branding.createGuideline({ id: nw, orgId: NORTHWIND_ORG, name: 'Northwind brand' });
  await storage.branding.createGuideline({ id: fb, orgId: FABRIKAM_ORG, name: 'Fabrikam brand' });
  await storage.branding.createGuideline({ id: sys, orgId: 'system', name: 'Shared library brand' });
  const nwColor = (await storage.branding.addColor(nw, { id: randomUUID(), name: 'Primary', hexValue: '#112233' })).id;
  const nwFont = (await storage.branding.addFont(nw, { id: randomUUID(), family: 'Inter' })).id;
  const nwSelector = (await storage.branding.addSelector(nw, { id: randomUUID(), pattern: '.nw-logo' })).id;

  return {
    server, storage, nw, fb, sys, nwColor, nwFont, nwSelector,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

const fabrikamMember: Actor = { role: 'user', currentOrgId: FABRIKAM_ORG };

/** Every guideline-addressed route, targeted at the Northwind guideline. */
const EDIT_ROUTES: ReadonlyArray<{ name: string; method: 'GET' | 'POST'; url: (c: Ctx) => string; payload?: string }> = [
  { name: 'POST /:id (update)', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}`, payload: 'name=Hijacked' },
  { name: 'POST /:id/toggle-active', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/toggle-active` },
  { name: 'POST /:id/delete', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/delete` },
  { name: 'POST /:id/toggle', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/toggle` },
  { name: 'POST /:id/discover-branding', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/discover-branding`,
    payload: 'url=https%3A%2F%2Ffabrikam.example' },
  { name: 'POST /:id/colors', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/colors`, payload: 'name=X&hexValue=%23000000' },
  { name: 'POST /:id/colors/:colorId/delete', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/colors/${c.nwColor}/delete` },
  { name: 'POST /:id/fonts', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/fonts`, payload: 'family=Arial' },
  { name: 'POST /:id/fonts/:fontId/delete', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/fonts/${c.nwFont}/delete` },
  { name: 'POST /:id/selectors', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/selectors`, payload: 'pattern=.x' },
  { name: 'POST /:id/selectors/:selectorId/delete', method: 'POST',
    url: (c) => `/admin/branding-guidelines/${c.nw}/selectors/${c.nwSelector}/delete` },
  { name: 'POST /:id/image', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/image` },
  { name: 'GET /:id (detail)', method: 'GET', url: (c) => `/admin/branding-guidelines/${c.nw}` },
  { name: 'POST /:id/sites', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/sites`,
    payload: 'siteUrl=https%3A%2F%2Ffabrikam.example' },
  { name: 'POST /:id/sites/unassign', method: 'POST', url: (c) => `/admin/branding-guidelines/${c.nw}/sites/unassign`,
    payload: 'siteUrl=https%3A%2F%2Ffabrikam.example' },
];

describe('admin branding routes org scoping', () => {
  for (const r of EDIT_ROUTES) {
    it(`${r.name} answers 404 for another org guideline (cross-org)`, async () => {
      ctx = await setup(fabrikamMember);
      const res = await ctx.server.inject({
        method: r.method, url: r.url(ctx), ...(r.payload !== undefined ? { headers: FORM, payload: r.payload } : {}),
      });
      expect(res.statusCode).toBe(404);
    });
  }

  it('toggle, delete and update leave the other org guideline untouched (cross-org)', async () => {
    ctx = await setup(fabrikamMember);
    for (const suffix of ['/toggle', '/toggle-active', '/delete']) {
      await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.nw}${suffix}` });
    }
    await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.nw}`, headers: FORM, payload: 'name=Hijacked' });
    const after = await ctx.storage.branding.getGuideline(ctx.nw);
    expect(after?.name).toBe('Northwind brand');
    expect(after?.active).toBe(true);
  });

  it('an org-scoped admin key cannot toggle another org guideline (cross-org)', async () => {
    ctx = await setup({ role: 'admin', currentOrgId: FABRIKAM_ORG, orgScopedApiKey: true });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.nw}/toggle` });
    expect(res.statusCode).toBe(404);
  });

  it('refuses deleting another org color through the caller own guideline id (cross-org child)', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.fb}/colors/${ctx.nwColor}/delete` });
    expect(res.statusCode).toBe(404);
    expect((await ctx.storage.branding.listColors(ctx.nw)).map((c) => c.id)).toContain(ctx.nwColor);
  });

  it('refuses deleting another org font through the caller own guideline id (cross-org child)', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.fb}/fonts/${ctx.nwFont}/delete` });
    expect(res.statusCode).toBe(404);
    expect((await ctx.storage.branding.listFonts(ctx.nw)).map((f) => f.id)).toContain(ctx.nwFont);
  });

  it('refuses deleting another org selector through the caller own guideline id (cross-org child)', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/branding-guidelines/${ctx.fb}/selectors/${ctx.nwSelector}/delete`,
    });
    expect(res.statusCode).toBe(404);
    expect((await ctx.storage.branding.listSelectors(ctx.nw)).map((s) => s.id)).toContain(ctx.nwSelector);
  });

  it('lets an org member toggle their own org guideline', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.fb}/toggle` });
    expect(res.statusCode).toBe(200);
  });

  it('lets a global admin toggle any org guideline', async () => {
    ctx = await setup({ role: 'admin', currentOrgId: FABRIKAM_ORG });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.nw}/toggle` });
    expect(res.statusCode).toBe(200);
  });

  it('lets an org member open a system library guideline', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/branding-guidelines/${ctx.sys}` });
    expect(res.statusCode).toBe(200);
  });

  it('lets an org member link a system library guideline to their site', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({
      method: 'POST', url: `/admin/branding-guidelines/${ctx.sys}/sites`, headers: FORM,
      payload: 'siteUrl=https%3A%2F%2Ffabrikam.example',
    });
    expect(res.statusCode).toBe(200);
    expect(await ctx.storage.branding.getSiteAssignments(ctx.sys)).toHaveLength(1);
  });

  it('refuses an org member toggling a system library guideline', async () => {
    ctx = await setup(fabrikamMember);
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.sys}/toggle` });
    expect(res.statusCode).toBe(404);
  });

  it('lets an org member delete a color of their own guideline', async () => {
    ctx = await setup(fabrikamMember);
    const own = await ctx.storage.branding.addColor(ctx.fb, { id: randomUUID(), name: 'Accent', hexValue: '#445566' });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.fb}/colors/${own.id}/delete` });
    expect(res.statusCode).toBe(200);
  });

  it("refuses an org-less non-admin toggling a 'system' guideline (system org)", async () => {
    ctx = await setup({ role: 'user' });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/branding-guidelines/${ctx.sys}/toggle` });
    expect(res.statusCode).toBe(404);
    expect((await ctx.storage.branding.getGuideline(ctx.sys))?.active).toBe(true);
  });

  it("still lets an org-less non-admin open a 'system' guideline", async () => {
    ctx = await setup({ role: 'user' });
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/branding-guidelines/${ctx.sys}` });
    expect(res.statusCode).toBe(200);
  });
});
