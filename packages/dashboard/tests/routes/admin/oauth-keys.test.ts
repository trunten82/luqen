/**
 * Phase 31.1 Plan 04 Task 2 — /admin/oauth-keys route tests (Tests 1-5).
 *
 * Covers:
 * - Test 1: GET without admin.system → 403
 * - Test 2: GET with admin.system → 200 HTML containing the headers/rows
 * - Test 3: POST /rotate with admin.system + valid CSRF → 302 + key rotated
 * - Test 4: POST /rotate without admin.system → 403
 * - Test 5: POST /rotate without CSRF → 403
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../../src/auth/oauth-key-bootstrap.js';
import { registerOauthKeysRoutes } from '../../../src/routes/admin/oauth-keys.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  cleanup: () => Promise<void>;
}

async function buildCtx(
  permissions: string[] = ['admin.system'],
  opts: { csrfValid?: boolean } = {},
): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-04-oauth-keys-salt');
  const dbPath = join(tmpdir(), `test-oauth-keys-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  // Fake render — admin views are tested at a content level, not template fidelity.
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this
        .code(200)
        .header('content-type', 'text/html')
        .send(renderFakeHtml(template, data));
    },
  );

  // Fake CSRF gate: rely on a `_csrf` body / header token sentinel.
  // Route's own CSRF hook checks body._csrf === 'valid' for the test.
  server.addHook('preHandler', async (request, reply) => {
    request.user = { id: 'user-1', username: 'admin', role: 'admin', currentOrgId: 'system' };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);

    if (request.method === 'POST') {
      const body = request.body as { _csrf?: string } | undefined;
      const csrfOk = (body?._csrf === 'valid') || (opts.csrfValid === true);
      if (!csrfOk) {
        await reply.code(403).send({ error: 'Forbidden: CSRF' });
        return;
      }
    }
  });

  await registerOauthKeysRoutes(server, storage, ENC_KEY);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return { server, storage, cleanup };
}

// Simple stand-in renderer — turns the data payload into predictable HTML-ish
// output that the test assertions can grep for headers and row kids.
function renderFakeHtml(template: string, data: unknown): string {
  const d = data as {
    keys?: Array<{ kid: string; createdAtDisplay: string; retiredAtDisplay: string; removedAtDisplay: string; isCurrent: boolean }>;
    csrfToken?: string;
  };
  const header = `<h1>OAuth Signing Keys</h1><table><thead><tr><th>Key ID</th><th>Created</th><th>Retired</th><th>Removed</th><th>Status</th></tr></thead><tbody>`;
  const rows = (d.keys ?? []).map((k) =>
    `<tr><td><code>${k.kid}</code></td><td>${k.createdAtDisplay}</td><td>${k.retiredAtDisplay}</td><td>${k.removedAtDisplay}</td><td>${k.isCurrent ? 'Current' : 'Retiring'}</td></tr>`,
  ).join('');
  const footer = `</tbody></table><form method="POST" action="/admin/oauth-keys/rotate"><input type="hidden" name="_csrf" value="${d.csrfToken ?? ''}"/><button type="submit">Rotate now</button></form>`;
  return `<!-- ${template} -->${header}${rows}${footer}`;
}

// ── Test 1 ────────────────────────────────────────────────────────────────────

describe('GET /admin/oauth-keys — Test 1 (no admin.system → 403)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(['compliance.view']); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 403 when the user lacks admin.system permission', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/oauth-keys' });
    expect(res.statusCode).toBe(403);
  });
});

// ── Test 2 ────────────────────────────────────────────────────────────────────

describe('GET /admin/oauth-keys — Test 2 (admin.system → 200 + table)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 200 with table headers and one row per key', async () => {
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/oauth-keys' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Key ID');
    expect(res.body).toContain('Created');
    expect(res.body).toContain('Retired');
    expect(res.body).toContain('Removed');
    const keys = await ctx.storage.oauthSigningKeys.listPublishableKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(res.body).toContain(k.kid);
    }
  });
});

// ── Test 3 ────────────────────────────────────────────────────────────────────

describe('POST /admin/oauth-keys/rotate — Test 3 (admin.system + CSRF → 302 + rotated)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('rotates the key and redirects back to /admin/oauth-keys', async () => {
    const beforeActive = await ctx.storage.oauthSigningKeys.listActiveKeys();
    const beforeKid = beforeActive[0]!.kid;

    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/oauth-keys/rotate',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: 'valid' }).toString(),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/admin/oauth-keys');

    const afterActive = await ctx.storage.oauthSigningKeys.listActiveKeys();
    expect(afterActive.length).toBe(1);
    expect(afterActive[0]!.kid).not.toBe(beforeKid);

    // An audit row should be written for manual rotation as well (T-31.1-04-04).
    const db = ctx.storage.getRawDatabase();
    const auditRows = db
      .prepare(`SELECT * FROM agent_audit_log WHERE tool_name = 'oauth.key_rotated'`)
      .all() as Array<{ outcome: string }>;
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.outcome).toBe('success');
  });
});

// ── Test 4 ────────────────────────────────────────────────────────────────────

describe('POST /admin/oauth-keys/rotate — Test 4 (no admin.system → 403)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(['compliance.view'], { csrfValid: true }); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 403 without admin.system permission', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/oauth-keys/rotate',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: 'valid' }).toString(),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── Test 5 ────────────────────────────────────────────────────────────────────

describe('POST /admin/oauth-keys/rotate — Test 5 (missing CSRF → 403)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 403 when the _csrf token is missing', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/admin/oauth-keys/rotate',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({}).toString(),
    });
    expect(res.statusCode).toBe(403);
  });
});
