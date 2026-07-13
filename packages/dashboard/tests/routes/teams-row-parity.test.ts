/**
 * Regression: the HTMX row returned by POST /admin/teams had 5 cells while
 * the full-page teams table has 6 (Name, Description, Organization, Members,
 * Created, Actions). The freshly created row rendered shifted — the
 * Organization column showed the member count (0) and Members showed a date —
 * until a full-page refresh re-rendered it correctly.
 *
 * Pins column parity between teamRowHtml and views/admin/teams.hbs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { teamRoutes } from '../../src/routes/admin/teams.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-teams-parity-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.teams']);
  });
  await teamRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };
  return { server, storage, cleanup };
}

describe('POST /admin/teams HTMX row — column parity with teams.hbs', () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    if (ctx) {
      ctx.cleanup();
      ctx = undefined;
    }
  });

  it('returned row has the same cells, in the same order, as the full-page table', async () => {
    ctx = await createTestServer();
    const org = await ctx.storage.organizations.createOrg({ name: 'Acme', slug: `acme-${randomUUID().slice(0, 8)}` });

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/teams',
      headers: { 'hx-request': 'true' },
      payload: { name: 'QA Team', description: 'Quality', organizationId: org.id },
    });
    expect(res.statusCode).toBe(200);
    const row = res.body;

    // Cell labels in DOM order, from the injected row…
    const rowLabels = [...row.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);
    // …must equal the cell labels of the full-page template row.
    const template = readFileSync(join(__dirname, '../../src/views/admin/teams.hbs'), 'utf-8');
    const eachStart = template.indexOf('{{#each teams}}');
    const eachBlock = template.slice(eachStart, template.indexOf('{{/each}}', eachStart));
    const templateLabels = [...eachBlock.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);

    expect(rowLabels).toEqual(templateLabels);
    // And the Organization cell carries the org name, not a count.
    expect(row).toContain('Acme');
  });
});
