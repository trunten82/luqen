import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import handlebars from 'handlebars';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { accessibilityStatementRoutes } from '../../src/routes/accessibility-statement.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  orgId: string;
  orgSlug: string;
  cleanup: () => void;
}

// The public route compiles its template with the global handlebars singleton,
// which expects the `t` and `eq` helpers that server.ts registers in prod.
function registerHelpers(): void {
  if (!handlebars.helpers.t) {
    handlebars.registerHelper('t', (key: string, opts?: { hash?: Record<string, unknown> }) => {
      let out = String(key);
      const hash = opts?.hash ?? {};
      for (const [k, v] of Object.entries(hash)) out += ` ${k}=${String(v)}`;
      return out;
    });
  }
  if (!handlebars.helpers.eq) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
}

async function createServer(permissions: string[] = ['admin.org']): Promise<Ctx> {
  const dbPath = join(tmpdir(), `test-a11y-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const org = await storage.organizations.createOrg({ name: 'Acme Corp', slug: `acme-${randomUUID().slice(0, 8)}` });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);
  server.decorateReply('view', function (this: FastifyReply, template: string, data: unknown) {
    return this.code(200).header('content-type', 'application/json').send(JSON.stringify({ template, data }));
  });
  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'admin', role: 'admin', currentOrgId: org.id };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });
  registerHelpers();
  await accessibilityStatementRoutes(server, storage);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };
  return { server, storage, orgId: org.id, orgSlug: org.slug, cleanup };
}

describe('accessibility statement routes', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await createServer(); });
  afterEach(() => ctx.cleanup());

  it('renders the admin config page with defaults + public URL', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/accessibility-statement' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { template: string; data: Record<string, unknown> };
    expect(body.template).toBe('admin/accessibility-statement.hbs');
    expect(body.data.publicUrl).toBe(`/accessibility-statement/${ctx.orgSlug}`);
    expect((body.data.config as { enabled: boolean }).enabled).toBe(false);
    // Entity name defaults to the org name in the preview.
    expect((body.data.preview as { entityName: string }).entityName).toBe('Acme Corp');
  });

  it('blocks the admin page without an admin permission', async () => {
    const noPerm = await createServer(['scans.create']);
    const res = await noPerm.server.inject({ method: 'GET', url: '/admin/accessibility-statement' });
    expect(res.statusCode).toBe(403);
    noPerm.cleanup();
  });

  it('public statement 404s until enabled, then renders conservatively', async () => {
    // Disabled by default → 404.
    const before = await ctx.server.inject({ method: 'GET', url: `/accessibility-statement/${ctx.orgSlug}` });
    expect(before.statusCode).toBe(404);

    // Save with enabled + contact, no scan yet.
    const save = await ctx.server.inject({
      method: 'POST',
      url: '/admin/accessibility-statement',
      payload: new URLSearchParams({
        enabled: 'on',
        entityName: 'Acme Corp',
        siteUrl: 'https://acme.example',
        wcagVersion: '2.2',
        wcagLevel: 'AA',
        contactEmail: 'a11y@acme.example',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(save.statusCode).toBe(302);
    expect(save.headers.location).toBe('/admin/accessibility-statement?saved=1');

    // Persisted.
    const stored = await ctx.storage.accessibilityStatements.get(ctx.orgId);
    expect(stored?.enabled).toBe(true);
    expect(stored?.wcagVersion).toBe('2.2');
    expect(stored?.contactEmail).toBe('a11y@acme.example');

    // Now public.
    const after = await ctx.server.inject({ method: 'GET', url: `/accessibility-statement/${ctx.orgSlug}` });
    expect(after.statusCode).toBe(200);
    expect(after.headers['content-type']).toContain('text/html');
    // Conservative framing + barrier-report channel routed to the org.
    expect(after.body).toContain('Acme Corp');
    expect(after.body).toContain('a11yStatement.public.heading');
    expect(after.body).toContain('a11y@acme.example');
    // No scan yet → no-assessment path.
    expect(after.body).toContain('a11yStatement.public.noAssessment');
  });

  it('persists the ACR link and renders "View our ACR" on the public statement', async () => {
    const save = await ctx.server.inject({
      method: 'POST',
      url: '/admin/accessibility-statement',
      payload: new URLSearchParams({
        enabled: 'on',
        entityName: 'Acme Corp',
        siteUrl: 'https://acme.example',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        acrUrl: 'https://acme.example/reports/live/badge-123',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(save.statusCode).toBe(302);

    const stored = await ctx.storage.accessibilityStatements.get(ctx.orgId);
    expect(stored?.acrUrl).toBe('https://acme.example/reports/live/badge-123');

    const pub = await ctx.server.inject({ method: 'GET', url: `/accessibility-statement/${ctx.orgSlug}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.body).toContain('href="https://acme.example/reports/live/badge-123"');
    expect(pub.body).toContain('a11yStatement.public.viewAcr');
  });

  it('404s for an unknown slug', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/accessibility-statement/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
