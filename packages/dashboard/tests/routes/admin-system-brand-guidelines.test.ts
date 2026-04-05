/**
 * Integration tests for the /admin/system-brand-guidelines route plugin
 * (Phase 08 plan 02 — SYS-01, SYS-04).
 *
 * Mirrors tests/routes/admin-service-connections.test.ts for bootstrap shape:
 * a real Fastify instance, a real SqliteStorageAdapter (migrated), a permission
 * stub that injects admin.system for "admin" role and an empty set for "viewer".
 *
 * Coverage:
 *  1. list (admin): 200 + HTML with i18n-rendered title
 *  2. list (non-admin): 403
 *  3. list (empty state): empty-state heading present
 *  4. list (populated): seeded guideline names present
 *  5. create (admin): POST creates row with org_id='system'
 *  6. create (non-admin): 403, no row created
 *  7. update (admin): POST /:id updates name/description
 *  8. update (non-admin): 403
 *  9. delete (admin): POST /:id/delete removes the row
 * 10. delete (non-admin): 403
 * 11. audit: create/update/delete each write an audit_log entry
 * 12. scope isolation: mutating a 'system' row leaves org-owned rows untouched
 * 13. HTMX fragment: `hx-request: true` GET returns a fragment (no `<html`)
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { systemBrandGuidelineRoutes } from '../../src/routes/admin/system-brand-guidelines.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => Promise<void>;
}

async function createTestServer(role: 'admin' | 'viewer' = 'admin'): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-admin-sys-brand-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'test-user-id',
      username: 'testadmin',
      role,
      currentOrgId: 'org-under-test',
    };
    const perms =
      role === 'admin'
        ? new Set<string>(ALL_PERMISSION_IDS)
        : new Set<string>();
    (request as unknown as Record<string, unknown>)['permissions'] = perms;
  });

  await systemBrandGuidelineRoutes(server, storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, cleanup };
}

async function seedSystemGuideline(
  storage: SqliteStorageAdapter,
  name: string,
  description?: string,
): Promise<string> {
  const id = randomUUID();
  await storage.branding.createGuideline({
    id,
    orgId: 'system',
    name,
    ...(description !== undefined ? { description } : {}),
  });
  return id;
}

async function seedOrgGuideline(
  storage: SqliteStorageAdapter,
  orgId: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await storage.branding.createGuideline({ id, orgId, name });
  return id;
}

// ---------------------------------------------------------------------------
// GET /admin/system-brand-guidelines
// ---------------------------------------------------------------------------

describe('GET /admin/system-brand-guidelines', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(1) returns 200 with the i18n-rendered title for admin.system users', async () => {
    ctx = await createTestServer('admin');
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/system-brand-guidelines',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('System brand guidelines');
  });

  it('(2) returns 403 for non-admin users', async () => {
    ctx = await createTestServer('viewer');
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/system-brand-guidelines',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('(3) shows the empty-state heading when no system guidelines exist', async () => {
    ctx = await createTestServer('admin');
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/system-brand-guidelines',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('No system brand guidelines yet');
  });

  it('(4) renders all seeded system guidelines in the list', async () => {
    ctx = await createTestServer('admin');
    await seedSystemGuideline(ctx.storage, 'Aperol Summer', 'Golden warmth');
    await seedSystemGuideline(ctx.storage, 'Campari Classic');

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/system-brand-guidelines',
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Aperol Summer');
    expect(res.payload).toContain('Campari Classic');
  });

  it('(13) returns an HTMX fragment (no <html>) when hx-request header is set', async () => {
    ctx = await createTestServer('admin');
    await seedSystemGuideline(ctx.storage, 'HtmxProbe');

    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/system-brand-guidelines',
      headers: { 'hx-request': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('<html');
    expect(res.payload).toContain('HtmxProbe');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/system-brand-guidelines  (create)
// ---------------------------------------------------------------------------

describe('POST /admin/system-brand-guidelines', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(5) creates a row with org_id="system" for admin.system users', async () => {
    ctx = await createTestServer('admin');
    const before = await ctx.storage.branding.listSystemGuidelines();

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/system-brand-guidelines',
      payload: { name: 'Newly Created', description: 'desc' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(400);

    const after = await ctx.storage.branding.listSystemGuidelines();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((g) => g.name === 'Newly Created');
    expect(created).toBeDefined();
    expect(created!.orgId).toBe('system');
  });

  it('(6) returns 403 for non-admin users and creates nothing', async () => {
    ctx = await createTestServer('viewer');
    const before = await ctx.storage.branding.listSystemGuidelines();

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/system-brand-guidelines',
      payload: { name: 'Should Fail' },
    });
    expect(res.statusCode).toBe(403);

    const after = await ctx.storage.branding.listSystemGuidelines();
    expect(after.length).toBe(before.length);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/system-brand-guidelines/:id  (update)
// ---------------------------------------------------------------------------

describe('POST /admin/system-brand-guidelines/:id', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(7) updates name/description of an existing system guideline', async () => {
    ctx = await createTestServer('admin');
    const id = await seedSystemGuideline(ctx.storage, 'Original Name', 'Original desc');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${id}`,
      payload: { name: 'Renamed', description: 'Updated desc' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(400);

    const refreshed = await ctx.storage.branding.getGuideline(id);
    expect(refreshed).not.toBeNull();
    expect(refreshed!.name).toBe('Renamed');
    expect(refreshed!.description).toBe('Updated desc');
    expect(refreshed!.orgId).toBe('system');
  });

  it('(8) returns 403 for non-admin users', async () => {
    ctx = await createTestServer('viewer');
    const id = await seedSystemGuideline(ctx.storage, 'Guard Me');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${id}`,
      payload: { name: 'Evil' },
    });
    expect(res.statusCode).toBe(403);

    const row = await ctx.storage.branding.getGuideline(id);
    expect(row!.name).toBe('Guard Me');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/system-brand-guidelines/:id/delete
// ---------------------------------------------------------------------------

describe('POST /admin/system-brand-guidelines/:id/delete', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(9) deletes the row for admin.system users', async () => {
    ctx = await createTestServer('admin');
    const id = await seedSystemGuideline(ctx.storage, 'DeleteMe');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${id}/delete`,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.statusCode).toBeLessThan(400);

    const row = await ctx.storage.branding.getGuideline(id);
    expect(row).toBeNull();
  });

  it('(10) returns 403 for non-admin users and leaves the row intact', async () => {
    ctx = await createTestServer('viewer');
    const id = await seedSystemGuideline(ctx.storage, 'Untouchable');

    const res = await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${id}/delete`,
    });
    expect(res.statusCode).toBe(403);

    const row = await ctx.storage.branding.getGuideline(id);
    expect(row).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

describe('audit log', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(11) writes an audit entry on create, update, and delete', async () => {
    ctx = await createTestServer('admin');

    // create
    await ctx.server.inject({
      method: 'POST',
      url: '/admin/system-brand-guidelines',
      payload: { name: 'Audited' },
    });
    const listSystem = await ctx.storage.branding.listSystemGuidelines();
    const created = listSystem.find((g) => g.name === 'Audited');
    expect(created).toBeDefined();

    // update
    await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${created!.id}`,
      payload: { name: 'Audited-Renamed' },
    });

    // delete
    await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${created!.id}/delete`,
    });

    const audit = await ctx.storage.audit.query({
      resourceType: 'system_brand_guideline',
    });
    expect(audit.entries.length).toBeGreaterThanOrEqual(3);
    const actions = audit.entries.map((e) => e.action).sort();
    expect(actions).toEqual(
      expect.arrayContaining([
        'system_brand_guideline.create',
        'system_brand_guideline.update',
        'system_brand_guideline.delete',
      ]),
    );
    for (const entry of audit.entries) {
      expect(entry.actor).toBe('testadmin');
    }
  });
});

// ---------------------------------------------------------------------------
// Scope isolation
// ---------------------------------------------------------------------------

describe('scope isolation', () => {
  let ctx: TestContext;
  afterEach(async () => { await ctx.cleanup(); });

  it('(12) mutating a system guideline does not touch any org-owned guideline', async () => {
    ctx = await createTestServer('admin');

    // Seed org-owned rows for two different orgs before + after
    const alphaId = await seedOrgGuideline(ctx.storage, 'org-alpha', 'Alpha Guide');
    const betaId = await seedOrgGuideline(ctx.storage, 'org-beta', 'Beta Guide');

    const systemId = await seedSystemGuideline(ctx.storage, 'System Template');

    // Update the system row
    await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${systemId}`,
      payload: { name: 'System Template Renamed' },
    });

    // Delete the system row
    await ctx.server.inject({
      method: 'POST',
      url: `/admin/system-brand-guidelines/${systemId}/delete`,
    });

    // Org rows must be byte-identical
    const alpha = await ctx.storage.branding.getGuideline(alphaId);
    const beta = await ctx.storage.branding.getGuideline(betaId);
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    expect(alpha!.name).toBe('Alpha Guide');
    expect(beta!.name).toBe('Beta Guide');
    expect(alpha!.orgId).toBe('org-alpha');
    expect(beta!.orgId).toBe('org-beta');
  });
});
