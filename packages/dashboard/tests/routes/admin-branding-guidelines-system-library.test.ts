/**
 * Integration tests for the org System Library tab on /admin/branding-guidelines
 * (Phase 08 plan 03).
 *
 * Covers:
 *   1. Default tab renders My guidelines active
 *   2. ?tab=system renders System library active
 *   3. Empty system library state
 *   4. System rows are read-only (no Edit/Delete, just Link + Clone)
 *   5. System badge visible on each system row
 *   6. POST /system/:id/clone happy path → 204 + HX-Redirect + org-owned clone
 *      with clonedFromSystemGuidelineId
 *   7. Clone refuses non-system source (org-owned guideline → 404)
 *   8. Clone does not mutate the source system row
 *   9. Default tab HTML contains no System library row scaffolding (only tab strip)
 *  10. Clone requires branding.manage permission
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import handlebars from 'handlebars';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { brandingGuidelineRoutes } from '../../src/routes/admin/branding-guidelines.js';
import { loadTranslations, t } from '../../src/i18n/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  systemGuidelineIds: string[];
  orgGuidelineId: string;
  cleanup: () => Promise<void>;
}

async function createTestServer(
  options: { permissions?: string[] } = {},
): Promise<TestContext> {
  loadTranslations();

  const dbPath = join(tmpdir(), `test-branding-system-lib-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  // Register @fastify/view with handlebars + t helper so we can assert on
  // rendered HTML.
  const hb = handlebars.create();
  hb.registerHelper('t', function (this: unknown, key: string, opts: {
    hash?: Record<string, unknown>;
  }) {
    const params = opts?.hash != null
      ? Object.fromEntries(
          Object.entries(opts.hash).map(([k, v]) => [k, String(v ?? '')]),
        )
      : undefined;
    return t(key, 'en', params);
  });
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));

  const viewsDir = join(__dirname, '../../src/views');
  await server.register(import('@fastify/view'), {
    engine: { handlebars: hb },
    root: viewsDir,
    options: {
      partials: {
        'system-library-row': 'admin/partials/system-library-row.hbs',
      },
    },
  });

  // Stub auth / permissions preHandler
  const permissions = new Set<string>(
    options.permissions ?? ['branding.view', 'branding.manage'],
  );
  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'test-user-id',
      username: 'testadmin',
      role: 'user',
      currentOrgId: 'org-a',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = permissions;
  });

  await brandingGuidelineRoutes(server, storage, () => null);
  await server.ready();

  // Seed two system guidelines
  const sysA = randomUUID();
  const sysB = randomUUID();
  await storage.branding.createGuideline({
    id: sysA,
    orgId: 'system',
    name: 'Aperol System',
    description: 'Official Aperol brand template',
  });
  await storage.branding.createGuideline({
    id: sysB,
    orgId: 'system',
    name: 'Campari System',
    description: 'Official Campari brand template',
  });

  // Seed one org-owned guideline under org-a
  const orgG = randomUUID();
  await storage.branding.createGuideline({
    id: orgG,
    orgId: 'org-a',
    name: 'My Org Brand',
    description: 'Org-owned existing guideline',
  });

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server,
    storage,
    systemGuidelineIds: [sysA, sysB],
    orgGuidelineId: orgG,
    cleanup,
  };
}

// ---------------------------------------------------------------------------

describe('GET /admin/branding-guidelines (tab-aware)', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('default tab renders My guidelines active with tab strip', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines',
    });
    expect(res.statusCode).toBe(200);
    const html = res.payload;
    // Tab strip present with My guidelines active
    expect(html).toContain('role="tablist"');
    expect(html).toContain('My guidelines');
    expect(html).toContain('System library');
    // My guidelines tab is active (not system)
    expect(html).toMatch(/tab--active[^>]*>\s*\n?\s*My guidelines/);
    // Existing org row is still rendered
    expect(html).toContain('My Org Brand');
  });

  it('?tab=system renders System library tab active and lists system guidelines', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines?tab=system',
    });
    expect(res.statusCode).toBe(200);
    const html = res.payload;
    expect(html).toContain('role="tablist"');
    // System library tab is active
    expect(html).toMatch(/tab--active[^>]*>\s*\n?\s*System library/);
    // Both seeded system guidelines appear
    expect(html).toContain('Aperol System');
    expect(html).toContain('Campari System');
  });

  it('?tab=system shows empty state when no system guidelines exist', async () => {
    ctx = await createTestServer();
    // Delete both seeded system guidelines
    for (const id of ctx.systemGuidelineIds) {
      await ctx.storage.branding.deleteGuideline(id);
    }
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines?tab=system',
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('No system templates available');
  });

  it('system library rows are read-only: Link + Clone buttons, no Edit/Delete', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines?tab=system',
    });
    const html = res.payload;
    expect(html).toContain('Link to site');
    expect(html).toContain('Clone into org');
    // No destructive buttons in system rows
    expect(html).not.toContain('btn--danger');
    // No Edit/Delete affordances — the core destructive class is gone
    // from the system panel section; assert the clone row partial doesn't
    // surface admin-only verbs.
    const systemSection = html.split('System library')[1] ?? '';
    expect(systemSection).not.toContain('hx-post="/admin/branding-guidelines/' + ctx.systemGuidelineIds[0] + '/delete"');
  });

  it('system library rows show the System badge', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines?tab=system',
    });
    const html = res.payload;
    // Badge--info labelled "System"
    expect(html).toMatch(/badge badge--info[^>]*>\s*System\s*</);
  });

  it('default tab does not render the system library table body', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/branding-guidelines',
    });
    const html = res.payload;
    // The tab strip is always there, but the system row content (Aperol
    // System) must NOT appear on the default tab.
    expect(html).not.toContain('Aperol System');
    expect(html).not.toContain('Campari System');
    // Clone endpoint link should also not be on the default tab
    expect(html).not.toContain('/admin/branding-guidelines/system/');
  });
});

// ---------------------------------------------------------------------------

describe('POST /admin/branding-guidelines/system/:id/clone', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('clones a system guideline into the current org and HX-Redirects to edit page', async () => {
    ctx = await createTestServer();
    const sourceId = ctx.systemGuidelineIds[0];

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/system/${sourceId}/clone`,
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(204);
    const redirect = res.headers['hx-redirect'];
    expect(redirect).toBeTruthy();
    expect(String(redirect)).toMatch(
      /^\/admin\/branding-guidelines\/[0-9a-f-]+$/,
    );

    // After clone, org-a has a new guideline with clonedFromSystemGuidelineId
    const orgGuidelines = await ctx.storage.branding.listGuidelines('org-a');
    const clone = orgGuidelines.find((g) => (g as unknown as {
      clonedFromSystemGuidelineId?: string | null;
    }).clonedFromSystemGuidelineId === sourceId);
    expect(clone).toBeDefined();
    expect(clone!.orgId).toBe('org-a');
    // The clone's id must be the one in the HX-Redirect URL
    expect(String(redirect)).toContain(clone!.id);
  });

  it('returns 404 when the source guideline is not system-scoped', async () => {
    ctx = await createTestServer();
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/system/${ctx.orgGuidelineId}/clone`,
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not mutate the source system guideline', async () => {
    ctx = await createTestServer();
    const sourceId = ctx.systemGuidelineIds[0];
    const before = await ctx.storage.branding.getGuideline(sourceId);
    expect(before).not.toBeNull();

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/system/${sourceId}/clone`,
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(204);

    const after = await ctx.storage.branding.getGuideline(sourceId);
    expect(after).not.toBeNull();
    expect(after!.name).toBe(before!.name);
    expect(after!.version).toBe(before!.version);
    expect(after!.orgId).toBe('system');
  });

  it('returns 403 when caller lacks branding.manage permission', async () => {
    ctx = await createTestServer({ permissions: ['branding.view'] });
    const sourceId = ctx.systemGuidelineIds[0];
    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/system/${sourceId}/clone`,
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(403);
  });
});
