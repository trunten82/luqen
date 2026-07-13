/**
 * Regression: /admin/llm-usage 403 for org-level Admin users.
 *
 * The sidebar shows the "LLM usage" link under `perm.llmView`, and the org
 * Admin role grants `llm.view`/`llm.manage` — but NOT `admin.org` (only the
 * org Owner role has that). The GET guard required `admin.system` OR
 * `admin.org`, so every org-Admin user saw the link and got a 403.
 *
 * Contract pinned here (aligned with GET /admin/llm, which accepts
 * `admin.system` OR `llm.view`):
 *  - org Admin (llm.view, no admin.org)      → usage page 200
 *  - org Owner (admin.org)                   → usage page 200 (unchanged)
 *  - user without any llm/admin permission   → 403
 *  - export.xlsx follows the same guard (503 when LLM unconnected, not 403)
 *  - credits/plan POSTs stay admin.system-only → 403 for org Admin
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { llmUsageRoutes } from '../../src/routes/admin/llm-usage.js';
import { loadTranslations } from '../../src/i18n/index.js';

interface TestContext {
  server: FastifyInstance;
  cleanup: () => Promise<void>;
}

async function createTestServer(permissions: string[]): Promise<TestContext> {
  loadTranslations();
  const dbPath = join(tmpdir(), `test-llm-usage-perms-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-1',
      username: 'orgadmin',
      role: 'user',
      currentOrgId: 'org-a',
      orgId: 'org-a',
      permissions,
    } as unknown as typeof request.user;
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  // LLM client deliberately null — the permission guard runs before the
  // handler, and the null-client branch renders the page without services.
  await llmUsageRoutes(server, () => null, storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    await server.close();
  };
  return { server, cleanup };
}

// Mirrors ORG_ADMIN_PERMISSIONS from src/permissions.ts: has llm.view +
// llm.manage, does NOT have admin.org / admin.system.
const ORG_ADMIN_LIKE = ['llm.view', 'llm.manage', 'reports.view'];
const ORG_OWNER_LIKE = ['llm.view', 'llm.manage', 'admin.org'];
const NO_LLM_PERMS = ['reports.view', 'trends.view'];

describe('/admin/llm-usage permission guard (org-Admin 403 regression)', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = undefined;
    }
  });

  it('org Admin (llm.view, no admin.org) can open the usage page', async () => {
    ctx = await createTestServer(ORG_ADMIN_LIKE);
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm-usage' });
    expect(res.statusCode).toBe(200);
  });

  it('org Owner (admin.org) can still open the usage page', async () => {
    ctx = await createTestServer(ORG_OWNER_LIKE);
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm-usage' });
    expect(res.statusCode).toBe(200);
  });

  it('user without llm.view or admin permissions is rejected', async () => {
    ctx = await createTestServer(NO_LLM_PERMS);
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm-usage' });
    expect(res.statusCode).toBe(403);
  });

  it('export.xlsx allows org Admin through the guard (503 = unconnected, not 403)', async () => {
    ctx = await createTestServer(ORG_ADMIN_LIKE);
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/llm-usage/export.xlsx' });
    expect(res.statusCode).toBe(503);
  });

  it('credits POST stays system-admin-only (403 for org Admin)', async () => {
    ctx = await createTestServer(ORG_ADMIN_LIKE);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/llm-usage/credits',
      payload: { op: 'set', allocated: '10', orgId: 'org-a' },
    });
    expect(res.statusCode).toBe(403);
  });
});
