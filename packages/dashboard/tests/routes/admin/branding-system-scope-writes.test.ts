/**
 * The admin branding router resolves a caller with no current org to org
 * 'system' (`currentOrgId ?? 'system'`), and the system 'developer' role holds
 * branding.manage. So an org-less non-admin could write INTO the shared
 * 'system' scope: create or upload new 'system' guidelines, clone the library
 * into 'system', upload CSS into a 'system' guideline, and write system-level
 * site assignments — which every org falls back to.
 *
 * Writing into the 'system' scope now requires a global admin (the shared
 * guidelineInScope predicate, 'edit'). Refusal is 403 "Access denied." — the
 * guideline (if any) is readable, so this is a refusal, not "not found".
 * Org users with a real current org keep their behaviour, including linking a
 * system-library guideline to THEIR org's sites.
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
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const SITE = 'https://fabrikam.example';
const CSS = encodeURIComponent(':root { --primary: #1E40AF; } body { font-family: Inter, sans-serif; }');

interface Actor { readonly role: string; readonly currentOrgId?: string }
interface Ctx { readonly server: FastifyInstance; readonly storage: SqliteStorageAdapter; readonly sys: string; readonly cleanup: () => void }

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(actor: Actor): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-branding-system-writes-${randomUUID()}.db`);
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
  const sys = randomUUID();
  await storage.branding.createGuideline({ id: sys, orgId: 'system', name: 'Shared library brand' });
  return {
    server, storage, sys,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

const orgless: Actor = { role: 'user' };
const fabrikamMember: Actor = { role: 'user', currentOrgId: FABRIKAM_ORG };
const orglessAdmin: Actor = { role: 'admin' };

async function systemNames(storage: SqliteStorageAdapter): Promise<readonly string[]> {
  return (await storage.branding.listGuidelines('system')).map((g) => g.name);
}

const create = (c: Ctx) => c.server.inject({ method: 'POST', url: '/admin/branding-guidelines', headers: FORM, payload: 'name=Rogue%20create' });
const upload = (c: Ctx) => c.server.inject({
  method: 'POST', url: '/admin/branding-guidelines/upload', headers: FORM,
  payload: `format=csv&name=Rogue%20upload&content=${encodeURIComponent('type,name,value\ncolor,Primary,#112233')}`,
});
const clone = (c: Ctx) => c.server.inject({
  method: 'POST', url: `/admin/branding-guidelines/system/${c.sys}/clone`, headers: FORM, payload: 'name=Rogue%20clone',
});
const uploadCss = (c: Ctx) => c.server.inject({
  method: 'POST', url: `/admin/branding-guidelines/${c.sys}/upload-css`, headers: FORM, payload: `cssContent=${CSS}`,
});
const link = (c: Ctx) => c.server.inject({
  method: 'POST', url: `/admin/branding-guidelines/${c.sys}/sites`, headers: FORM, payload: `siteUrl=${encodeURIComponent(SITE)}`,
});
const unlink = (c: Ctx) => c.server.inject({
  method: 'POST', url: `/admin/branding-guidelines/${c.sys}/sites/unassign`, headers: FORM, payload: `siteUrl=${encodeURIComponent(SITE)}`,
});

describe("admin branding: org-less non-admins cannot write into the 'system' scope", () => {
  it('refuses create with 403 (system write)', async () => {
    ctx = await setup(orgless);
    expect((await create(ctx)).statusCode).toBe(403);
    expect(await systemNames(ctx.storage)).not.toContain('Rogue create');
  });

  it('refuses upload with 403 (system write)', async () => {
    ctx = await setup(orgless);
    expect((await upload(ctx)).statusCode).toBe(403);
    expect(await systemNames(ctx.storage)).not.toContain('Rogue upload');
  });

  it("refuses cloning into 'system' with 403 (system write)", async () => {
    ctx = await setup(orgless);
    expect((await clone(ctx)).statusCode).toBe(403);
    expect(await systemNames(ctx.storage)).not.toContain('Rogue clone');
  });

  it("refuses upload-css into a 'system' guideline with 403 (system write)", async () => {
    ctx = await setup(orgless);
    expect((await uploadCss(ctx)).statusCode).toBe(403);
    expect(await ctx.storage.branding.listColors(ctx.sys)).toHaveLength(0);
  });

  it('refuses a system-level site link with 403 (system write)', async () => {
    ctx = await setup(orgless);
    expect((await link(ctx)).statusCode).toBe(403);
    expect(await ctx.storage.branding.getSiteAssignments(ctx.sys)).toHaveLength(0);
  });

  it('refuses a system-level site unlink with 403 (system write)', async () => {
    ctx = await setup(orgless);
    await ctx.storage.branding.assignToSite(ctx.sys, SITE, 'system');
    expect((await unlink(ctx)).statusCode).toBe(403);
    expect(await ctx.storage.branding.getSiteAssignments(ctx.sys)).toHaveLength(1);
  });

  it("still lets an org member link a system guideline to THEIR org's site", async () => {
    ctx = await setup(fabrikamMember);
    expect((await link(ctx)).statusCode).toBe(200);
    expect((await ctx.storage.branding.getGuidelineForSite(SITE, FABRIKAM_ORG))?.id).toBe(ctx.sys);
  });

  it("still lets an org member unlink their org's site", async () => {
    ctx = await setup(fabrikamMember);
    await ctx.storage.branding.assignToSite(ctx.sys, SITE, FABRIKAM_ORG);
    expect((await unlink(ctx)).statusCode).toBe(200);
  });

  it('still lets an org member create and clone into their own org', async () => {
    ctx = await setup(fabrikamMember);
    expect((await create(ctx)).statusCode).toBe(200);
    expect((await clone(ctx)).statusCode).toBe(204);
    expect((await ctx.storage.branding.listGuidelines(FABRIKAM_ORG)).map((g) => g.name))
      .toEqual(expect.arrayContaining(['Rogue create', 'Rogue clone']));
  });

  it("lets an org-less global admin write into 'system'", async () => {
    ctx = await setup(orglessAdmin);
    expect((await create(ctx)).statusCode).toBe(200);
    expect((await link(ctx)).statusCode).toBe(200);
    expect(await systemNames(ctx.storage)).toContain('Rogue create');
  });
});
