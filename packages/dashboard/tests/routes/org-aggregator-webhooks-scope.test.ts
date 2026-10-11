/**
 * POST /admin/org-webhooks/aggregator/:id/delete is open to `admin.org`, which
 * org Owners hold. It deleted by id with no org check, so an org owner could
 * delete another org's aggregator webhook. It must only delete a webhook in
 * the caller org's own list (the list the page shows); otherwise 404.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { orgAggregatorWebhookRoutes } from '../../src/routes/admin/org-aggregator-webhooks.js';

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly fabrikam: string;
  readonly northwind: string;
  readonly cleanup: () => void;
}

let ctx: Ctx | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function setup(): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-agg-webhooks-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const fabrikam = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam' })).id;
  const northwind = (await storage.organizations.createOrg({ name: 'Northwind', slug: 'northwind' })).id;
  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, 'test-session-secret-at-least-32b');
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'user', currentOrgId: fabrikam };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.org']);
  });
  await orgAggregatorWebhookRoutes(server, storage);
  await server.ready();
  return {
    server,
    storage,
    fabrikam,
    northwind,
    cleanup: () => {
      void storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
      void server.close();
    },
  };
}

describe('aggregator webhook delete org scoping', () => {
  it('answers 404 and keeps another org webhook (cross-org)', async () => {
    ctx = await setup();
    const hook = await ctx.storage.orgAggregatorWebhooks.create({ orgId: ctx.northwind, url: 'https://northwind.example/hook' });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/org-webhooks/aggregator/${hook.id}/delete` });
    expect(res.statusCode).toBe(404);
    expect((await ctx.storage.orgAggregatorWebhooks.listActive(ctx.northwind)).map((w) => w.id)).toContain(hook.id);
  });

  it('deletes a webhook of the caller org', async () => {
    ctx = await setup();
    const hook = await ctx.storage.orgAggregatorWebhooks.create({ orgId: ctx.fabrikam, url: 'https://fabrikam.example/hook' });
    const res = await ctx.server.inject({ method: 'POST', url: `/admin/org-webhooks/aggregator/${hook.id}/delete` });
    expect(res.statusCode).toBe(200);
  });
});
