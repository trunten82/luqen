/**
 * Phase 32 Plan 08 — /admin/organizations/:id/settings GET + POST
 *
 * Tests the single-field per-org editor for `agent_display_name` (D-14, D-19,
 * APER-02). Route handlers live in `routes/admin/organizations.ts` and render
 * `views/admin/organization-settings.hbs`.
 *
 * Test groups:
 *   Group A — GET visibility + pre-fill + tenant isolation (Tests 1-4)
 *   Group B — POST happy paths + validation + tenant + CSRF (Tests 5-13)
 *
 * The HBS view file is asserted directly via `readFileSync` — matches the
 * convention in `tests/routes/admin/clients.test.ts` (reads `clients.hbs`
 * to assert template content without a full HBS engine bootstrap).
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { organizationRoutes } from '../../../src/routes/admin/organizations.js';
import { registerSession } from '../../../src/auth/session.js';
import { loadTranslations } from '../../../src/i18n/index.js';

// i18n must be loaded before routes emit translated error/success copy.
loadTranslations();

const ENC_KEY = 'test-session-secret-at-least-32b';

type Viewer =
  | 'admin'          // admin.system (role='admin', currentOrgId='system')
  | 'admin-org-A'    // admin.org in org-A
  | 'admin-org-B';   // admin.org in org-B (to test cross-org defence)

interface Ctx {
  readonly server: FastifyInstance;
  readonly storage: SqliteStorageAdapter;
  readonly orgAId: string;
  readonly orgBId: string;
  readonly userAId: string;
  readonly userBId: string;
  readonly adminUserId: string;
  readonly csrfToken: string;
  readonly cseededDisplayName: string | null;
  readonly cleanup: () => Promise<void>;
}

async function buildCtx(opts: {
  viewer: Viewer;
  withCsrf?: boolean;
  seedOrgAName?: string | null;
}): Promise<Ctx> {
  setEncryptionSalt('phase-32-plan-08-org-settings-salt');
  const dbPath = join(tmpdir(), `test-org-settings-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Seed two orgs; orgA may have a seeded agent_display_name.
  const orgA = await storage.organizations.createOrg({
    name: 'Acme Inc.', slug: `org-a-${randomUUID()}`,
  });
  const orgB = await storage.organizations.createOrg({
    name: 'Beta Corp', slug: `org-b-${randomUUID()}`,
  });

  if (opts.seedOrgAName !== undefined) {
    await storage.organizations.updateOrgAgentDisplayName(orgA.id, opts.seedOrgAName);
  }

  // Seed users — one per org.
  const userA = await storage.users.createUser(`userA-${randomUUID()}`, 'pw', 'user');
  const userB = await storage.users.createUser(`userB-${randomUUID()}`, 'pw', 'user');
  const teamA = await storage.teams.createTeam({
    name: 'Team A', description: '', orgId: orgA.id,
  });
  const teamB = await storage.teams.createTeam({
    name: 'Team B', description: '', orgId: orgB.id,
  });
  await storage.teams.addTeamMember(teamA.id, userA.id);
  await storage.teams.addTeamMember(teamB.id, userB.id);

  // An admin.system user.
  const db = storage.getRawDatabase();
  const adminUserId = randomUUID();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'admin', 1, ?)`,
  ).run(adminUserId, `admin-${adminUserId}`, new Date().toISOString());

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, ENC_KEY);

  // Optional CSRF registration — Test 11 requires real CSRF enforcement.
  let csrfToken = 'unused';
  if (opts.withCsrf) {
    await server.register(import('@fastify/csrf-protection'), {
      sessionPlugin: '@fastify/secure-session',
    });
    // Route to mint a token for tests that need one.
    server.get('/csrf', async (_req, reply) => {
      const token = (reply as unknown as { generateCsrf: () => string }).generateCsrf();
      return reply.send({ token });
    });
  }

  // Stub view — returns template + data as JSON so tests can assert on payload.
  // Preserves the status code set by the handler (e.g. reply.code(400).view(...)).
  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this
        .header('content-type', 'application/json')
        .send(JSON.stringify({ template, data }));
    },
  );

  // Pick current user + perms based on viewer role.
  server.addHook('preHandler', async (request) => {
    if (opts.viewer === 'admin') {
      request.user = {
        id: adminUserId, username: 'admin', role: 'admin', currentOrgId: 'system',
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.system', 'admin.org',
      ]);
    } else if (opts.viewer === 'admin-org-A') {
      request.user = {
        id: userA.id, username: 'userA', role: 'user', currentOrgId: orgA.id,
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.org',
      ]);
    } else {
      request.user = {
        id: userB.id, username: 'userB', role: 'user', currentOrgId: orgB.id,
      };
      (request as unknown as Record<string, unknown>)['permissions'] = new Set([
        'admin.org',
      ]);
    }
  });

  // Attach CSRF preHandler on POST routes if CSRF is registered. We do it
  // via a global preHandler that mirrors the server.ts production wiring:
  // only enforce on mutating methods.
  if (opts.withCsrf) {
    server.addHook('preHandler', async (request, reply) => {
      if (request.method !== 'POST') return;
      await new Promise<void>((resolve, reject) => {
        (server as unknown as { csrfProtection: (req: unknown, rep: unknown, cb: (e?: Error) => void) => void })
          .csrfProtection(request, reply, (err) => (err ? reject(err) : resolve()));
      });
    });
  }

  await organizationRoutes(server, storage);
  await server.ready();

  // Mint a CSRF token for the session if requested.
  if (opts.withCsrf) {
    const res = await server.inject({ method: 'GET', url: '/csrf' });
    csrfToken = (res.json() as { token: string }).token;
  }

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server,
    storage,
    orgAId: orgA.id,
    orgBId: orgB.id,
    userAId: userA.id,
    userBId: userB.id,
    adminUserId,
    csrfToken,
    cseededDisplayName: opts.seedOrgAName ?? null,
    cleanup,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — GET /admin/organizations/:id/settings
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /admin/organizations/:id/settings — Group A (Plan 08)', () => {
  it('Test 1: admin.system on a fresh org receives 200 with agentDisplayName empty (null/empty)', async () => {
    const fx = await buildCtx({ viewer: 'admin' });
    try {
      const res = await fx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${fx.orgAId}/settings`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { template: string; data: { org: { agentDisplayName: string | null } } };
      expect(body.template).toContain('organization-settings');
      // Fresh org: agent_display_name is null (no value seeded).
      const val = body.data.org.agentDisplayName;
      expect(val === null || val === '').toBe(true);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 2: admin.system on seeded org returns agentDisplayName pre-filled', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${fx.orgAId}/settings`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { org: { agentDisplayName: string | null } } };
      expect(body.data.org.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 3: GET as admin.org of THIS org succeeds (200)', async () => {
    const fx = await buildCtx({ viewer: 'admin-org-A' });
    try {
      const res = await fx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${fx.orgAId}/settings`,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 4: GET as admin.org of DIFFERENT org is 403 (tenant isolation)', async () => {
    const fx = await buildCtx({ viewer: 'admin-org-B' });
    try {
      const res = await fx.server.inject({
        method: 'GET',
        url: `/admin/organizations/${fx.orgAId}/settings`,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await fx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — POST /admin/organizations/:id/settings
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /admin/organizations/:id/settings — Group B (Plan 08)', () => {
  it('Test 5: admin.system POST {agent_display_name: "Luna"} → 200 + DB updated', async () => {
    const fx = await buildCtx({ viewer: 'admin' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: 'Luna' },
      });
      expect(res.statusCode).toBe(200);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 6: POST with empty string → 200 + DB stores empty string (reset intent)', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: '' },
      });
      expect(res.statusCode).toBe(200);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      // Plan 03 repo preserves empty string (distinct from null).
      expect(org?.agentDisplayName === '' || org?.agentDisplayName === null).toBe(true);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 7: POST with 41-character name → 400 with agentDisplayNameTooLong hint; DB unchanged', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const tooLong = 'x'.repeat(41);
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: tooLong },
      });
      expect(res.statusCode).toBe(400);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 8: POST with "<script>alert(1)</script>" → 400 (HTML blocked); DB unchanged', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: '<script>alert(1)</script>' },
      });
      expect(res.statusCode).toBe(400);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 9: POST with "https://evil.com" → 400 (URL blocked); DB unchanged', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: 'https://evil.com' },
      });
      expect(res.statusCode).toBe(400);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 10: POST with "//foo" (protocol-relative) → 400; DB unchanged', async () => {
    const fx = await buildCtx({ viewer: 'admin', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: '//foo' },
      });
      expect(res.statusCode).toBe(400);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 11: POST without _csrf → 403 (CSRF middleware)', async () => {
    const fx = await buildCtx({ viewer: 'admin', withCsrf: true });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: 'Luna' },
        // No _csrf or x-csrf-token.
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 12: POST as admin.org of DIFFERENT org → 403 (cross-org defence)', async () => {
    const fx = await buildCtx({ viewer: 'admin-org-B', seedOrgAName: 'Luna' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: 'Pwned' },
      });
      expect(res.statusCode).toBe(403);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });

  it('Test 13: POST with "  Luna  " (whitespace) → trim + store "Luna"', async () => {
    const fx = await buildCtx({ viewer: 'admin' });
    try {
      const res = await fx.server.inject({
        method: 'POST',
        url: `/admin/organizations/${fx.orgAId}/settings`,
        payload: { agent_display_name: '  Luna  ' },
      });
      expect(res.statusCode).toBe(200);
      const org = await fx.storage.organizations.getOrg(fx.orgAId);
      expect(org?.agentDisplayName).toBe('Luna');
    } finally {
      await fx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// View file content assertions — rendered HBS exists with required fields
// ─────────────────────────────────────────────────────────────────────────────

describe('organization-settings.hbs — view contract', () => {
  it('view file exists with required fields (agent_display_name input + hint + error + maxlength=40)', () => {
    const hbs = readFileSync(
      join(process.cwd(), 'src', 'views', 'admin', 'organization-settings.hbs'),
      'utf-8',
    );
    expect(hbs).toContain('name="agent_display_name"');
    expect(hbs).toContain('id="agent-display-name"');
    expect(hbs).toContain('maxlength="40"');
    expect(hbs).toContain('form-error');
    expect(hbs).toContain('form-hint');
    // CSRF hidden input present.
    expect(hbs).toContain('name="_csrf"');
    // i18n keys used (not hard-coded English).
    expect(hbs).toContain('admin.organizations.settings.agentDisplayName');
    // No unescaped triple-brace on user content.
    expect(hbs).not.toMatch(/\{\{\{[^}]*agentDisplayName[^}]*\}\}\}/);
  });
});
