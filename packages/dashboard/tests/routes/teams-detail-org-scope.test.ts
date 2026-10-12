/**
 * GET /admin/teams/:id must apply the teams router's org rule (canMutateTeam):
 * a global admin may open any team; anyone else only a team of their current
 * org. An out-of-org team answers 404 exactly like a missing one, so a team id
 * from another org is not even confirmed to exist.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { teamRoutes } from '../../src/routes/admin/teams.js';

const FABRIKAM_ORG = 'org-fabrikam';
const NORTHWIND_ORG = 'org-northwind';

interface Actor {
  readonly role: string;
  readonly currentOrgId: string;
  readonly orgScopedApiKey?: boolean;
}

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(actor: Actor): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-teams-scope-${randomUUID()}.db`);
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
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.teams']);
  });
  await teamRoutes(server, storage);
  await server.ready();
  return {
    server,
    storage,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

async function northwindTeamId(storage: SqliteStorageAdapter): Promise<string> {
  const team = await storage.teams.createTeam({ name: 'Northwind QA', description: 'QA', orgId: NORTHWIND_ORG });
  return team.id;
}

describe('GET /admin/teams/:id org scoping', () => {
  it('answers 404 to an org member opening another org team (cross-org)', async () => {
    ctx = await setup({ role: 'user', currentOrgId: FABRIKAM_ORG });
    const id = await northwindTeamId(ctx.storage);
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/teams/${id}` });
    expect(res.statusCode).toBe(404);
  });

  it('answers 404 to an org-scoped admin key opening another org team (cross-org)', async () => {
    ctx = await setup({ role: 'admin', currentOrgId: FABRIKAM_ORG, orgScopedApiKey: true });
    const id = await northwindTeamId(ctx.storage);
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/teams/${id}` });
    expect(res.statusCode).toBe(404);
  });

  it('serves the team to a member of the owning org', async () => {
    ctx = await setup({ role: 'user', currentOrgId: NORTHWIND_ORG });
    const id = await northwindTeamId(ctx.storage);
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/teams/${id}` });
    expect(res.statusCode).toBe(200);
  });

  it('serves any team to a global admin', async () => {
    ctx = await setup({ role: 'admin', currentOrgId: FABRIKAM_ORG });
    const id = await northwindTeamId(ctx.storage);
    const res = await ctx.server.inject({ method: 'GET', url: `/admin/teams/${id}` });
    expect(res.statusCode).toBe(200);
  });
});
