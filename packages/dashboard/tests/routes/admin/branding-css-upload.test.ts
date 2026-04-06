import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { registerSession } from '../../../src/auth/session.js';
import { brandingGuidelineRoutes } from '../../../src/routes/admin/branding-guidelines.js';

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => void;
}

async function createTestServer(
  permissions: string[] = ['branding.manage', 'branding.view'],
  opts: { orgId?: string; role?: string } = {},
): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-branding-css-${randomUUID()}.db`);
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

  const orgId = opts.orgId ?? 'test-org';
  const role = opts.role ?? 'member';

  server.addHook('preHandler', async (request) => {
    request.user = { id: 'user-1', username: 'alice', role, currentOrgId: orgId };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await brandingGuidelineRoutes(server, storage, () => null);
  await server.ready();

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, storage, cleanup };
}

describe('POST /admin/branding-guidelines/:id/upload-css', () => {
  it('extracts colors and fonts from valid CSS and returns success toast', async () => {
    const ctx = await createTestServer();

    // Seed a guideline belonging to test-org
    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({
      id: guidelineId,
      orgId: 'test-org',
      name: 'Test Guideline',
    });

    const css = `:root { --primary: #1E40AF; --secondary: #F59E0B; } body { font-family: 'Inter', sans-serif; }`;

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/upload-css`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `cssContent=${encodeURIComponent(css)}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('color');
    expect(response.body).toContain('font');
  });

  it('returns error toast for empty CSS (no colors or fonts)', async () => {
    const ctx = await createTestServer();

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({
      id: guidelineId,
      orgId: 'test-org',
      name: 'Test Guideline',
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/upload-css`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `cssContent=${encodeURIComponent('/* empty */')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('No colors or fonts found');
  });

  it('returns 403 when user lacks branding.manage permission', async () => {
    const ctx = await createTestServer(['branding.view']);

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({
      id: guidelineId,
      orgId: 'test-org',
      name: 'Test Guideline',
    });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/upload-css`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `cssContent=${encodeURIComponent(':root { --color: #FF0000; }')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for non-existent guideline id', async () => {
    const ctx = await createTestServer(['branding.manage', 'branding.view'], { role: 'admin' });

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${randomUUID()}/upload-css`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `cssContent=${encodeURIComponent(':root { --color: #FF0000; }')}`,
    });

    ctx.cleanup();

    expect(response.statusCode).toBe(404);
  });

  it('merges colors additively — existing colors preserved, new ones appended', async () => {
    const ctx = await createTestServer(['branding.manage', 'branding.view']);

    const guidelineId = randomUUID();
    await ctx.storage.branding.createGuideline({
      id: guidelineId,
      orgId: 'test-org',
      name: 'Test Guideline',
    });

    // Pre-seed an existing color
    await ctx.storage.branding.addColor(guidelineId, {
      id: randomUUID(),
      name: 'existing',
      hexValue: '#FF0000',
    });

    const css = `:root { --new: #00FF00; }`;

    const response = await ctx.server.inject({
      method: 'POST',
      url: `/admin/branding-guidelines/${guidelineId}/upload-css`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `cssContent=${encodeURIComponent(css)}`,
    });

    expect(response.statusCode).toBe(200);

    // Both colors should now exist
    const colors = await ctx.storage.branding.listColors(guidelineId);
    ctx.cleanup();

    const hexValues = colors.map((c: { hexValue: string }) => c.hexValue.toUpperCase());
    expect(hexValues).toContain('#FF0000');
    expect(hexValues).toContain('#00FF00');
    expect(colors).toHaveLength(2);
  });
});
