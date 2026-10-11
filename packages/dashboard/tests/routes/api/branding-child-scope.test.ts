/**
 * DELETE /api/v1/branding/guidelines/:id/{colors|fonts|selectors}/:childId
 * checked only that the :id guideline is in the caller's org, then removed
 * the child by its own id — so a caller could pass THEIR guideline id with
 * ANOTHER org's child id. The child must belong to that guideline; otherwise 404.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { brandingApiRoutes } from '../../../src/routes/api/branding.js';

const FABRIKAM_ORG = 'org-fabrikam';
const NORTHWIND_ORG = 'org-northwind';

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly fb: string;
  readonly nw: string;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-branding-api-child-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const server = Fastify({ logger: false });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'user', currentOrgId: FABRIKAM_ORG };
  });
  await brandingApiRoutes(server, storage);
  await server.ready();
  const fb = randomUUID();
  const nw = randomUUID();
  await storage.branding.createGuideline({ id: fb, orgId: FABRIKAM_ORG, name: 'Fabrikam brand' });
  await storage.branding.createGuideline({ id: nw, orgId: NORTHWIND_ORG, name: 'Northwind brand' });
  return {
    server, storage, fb, nw,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

const KINDS = [
  { kind: 'colors', add: (s: SqliteStorageAdapter, gid: string) => s.branding.addColor(gid, { id: randomUUID(), name: 'P', hexValue: '#112233' }),
    list: (s: SqliteStorageAdapter, gid: string) => s.branding.listColors(gid) },
  { kind: 'fonts', add: (s: SqliteStorageAdapter, gid: string) => s.branding.addFont(gid, { id: randomUUID(), family: 'Inter' }),
    list: (s: SqliteStorageAdapter, gid: string) => s.branding.listFonts(gid) },
  { kind: 'selectors', add: (s: SqliteStorageAdapter, gid: string) => s.branding.addSelector(gid, { id: randomUUID(), pattern: '.nw' }),
    list: (s: SqliteStorageAdapter, gid: string) => s.branding.listSelectors(gid) },
] as const;

describe('/api/v1/branding child deletes are tied to their guideline', () => {
  for (const k of KINDS) {
    it(`DELETE .../${k.kind}/:childId refuses another org child via the caller own guideline (cross-org child)`, async () => {
      ctx = await setup();
      const child = await k.add(ctx.storage, ctx.nw);
      const res = await ctx.server.inject({ method: 'DELETE', url: `/api/v1/branding/guidelines/${ctx.fb}/${k.kind}/${child.id}` });
      expect(res.statusCode).toBe(404);
      expect((await k.list(ctx.storage, ctx.nw)).map((c) => c.id)).toContain(child.id);
    });

    it(`DELETE .../${k.kind}/:childId removes a child of the caller own guideline`, async () => {
      ctx = await setup();
      const child = await k.add(ctx.storage, ctx.fb);
      const res = await ctx.server.inject({ method: 'DELETE', url: `/api/v1/branding/guidelines/${ctx.fb}/${k.kind}/${child.id}` });
      expect(res.statusCode).toBe(200);
      expect(await k.list(ctx.storage, ctx.fb)).toHaveLength(0);
    });
  }
});
