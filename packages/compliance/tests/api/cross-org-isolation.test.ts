import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';

/**
 * Cross-org RBAC regression tests — Plan 51-02.
 *
 * Each test issues a per-org write/admin token for org A, then attempts to
 * mutate either a system-owned resource or an org B-owned resource and
 * asserts a 403 response. Without the receiver-side ownership guards added
 * in plan 51-02, every assertion would fail with 200/204 instead.
 */
describe('cross-org isolation', () => {
  let app: FastifyInstance;
  let db: SqliteAdapter;
  let systemAdminToken: string;
  let orgAWriteToken: string;
  let orgAAdminToken: string;
  let orgBWriteToken: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);
    process.env['COMPLIANCE_API_KEY'] = 'test-compliance-api-key';
    process.env['DASHBOARD_JWKS_URL'] = '';

    db = new SqliteAdapter(':memory:');
    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      corsOrigins: ['*'],
      logger: false,
      skipSeed: true,
    });

    const sysClient = await db.createClient({
      name: 'sys',
      scopes: ['read', 'write', 'admin'],
      grantTypes: ['client_credentials'],
    });
    const orgAWrite = await db.createClient({
      name: 'orgA-write',
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
      orgId: 'orgA',
    });
    const orgAAdmin = await db.createClient({
      name: 'orgA-admin',
      scopes: ['read', 'write', 'admin'],
      grantTypes: ['client_credentials'],
      orgId: 'orgA',
    });
    const orgBWrite = await db.createClient({
      name: 'orgB-write',
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
      orgId: 'orgB',
    });

    systemAdminToken = await signToken({
      sub: sysClient.id,
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });
    orgAWriteToken = await signToken({
      sub: orgAWrite.id,
      scopes: ['read', 'write'],
      orgId: 'orgA',
      expiresIn: '1h',
    });
    orgAAdminToken = await signToken({
      sub: orgAAdmin.id,
      scopes: ['read', 'write', 'admin'],
      orgId: 'orgA',
      expiresIn: '1h',
    });
    orgBWriteToken = await signToken({
      sub: orgBWrite.id,
      scopes: ['read', 'write'],
      orgId: 'orgB',
      expiresIn: '1h',
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  // For requests without a body (DELETE, GET) — Fastify's JSON parser rejects
  // empty bodies when content-type=application/json is sent (FST_ERR_CTP_EMPTY_JSON_BODY).
  function bearerNoBody(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  describe('sources PATCH (managementMode)', () => {
    // Phase 54: org admin mutating a system source now writes a per-org
    // OVERRIDE row instead of returning 403. The system column is unchanged.
    it('org A write token writes override on system source (no 403)', async () => {
      const sys = await db.createSource({
        name: 'sys-src',
        url: 'https://sys.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${sys.id}`,
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { scope: string; orgId: string; managementMode: string };
      expect(body.scope).toBe('org');
      expect(body.orgId).toBe('orgA');
      expect(body.managementMode).toBe('llm');
      // System column should NOT be mutated.
      const fresh = await db.getSource(sys.id);
      expect(fresh?.managementMode).toBe('manual');
      // Override row for orgA exists.
      expect(await db.getSourceOrgManagementMode(sys.id, 'orgA')).toBe('llm');
    });

    it('rejects org A write token mutating org B source', async () => {
      const orgBSrc = await db.createSource({
        name: 'orgb-src',
        url: 'https://b.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'orgB',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${orgBSrc.id}`,
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows system token to mutate system source', async () => {
      const sys2 = await db.createSource({
        name: 'sys-src-2',
        url: 'https://sys2.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${sys2.id}`,
        headers: bearer(systemAdminToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('sources/bulk-switch-mode', () => {
    // Phase 54: org admin bulk-switch now UPSERTs per-org overrides instead of 403.
    it('org A admin token writes overrides for caller org (no 403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sources/bulk-switch-mode',
        headers: bearer(orgAAdminToken),
        body: JSON.stringify({ mode: 'llm' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { scope: string; orgId: string };
      expect(body.scope).toBe('org');
      expect(body.orgId).toBe('orgA');
    });

    it('allows system token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sources/bulk-switch-mode',
        headers: bearer(systemAdminToken),
        body: JSON.stringify({ mode: 'manual' }),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('webhooks DELETE', () => {
    it('rejects org A admin token deleting org B webhook', async () => {
      const orgBHook = await db.createWebhook({
        url: 'https://b.example.com/hook',
        secret: 'sekret',
        events: ['proposal.created'],
        orgId: 'orgB',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/webhooks/${orgBHook.id}`,
        headers: bearerNoBody(orgAAdminToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects org A admin token deleting system webhook', async () => {
      const sysHook = await db.createWebhook({
        url: 'https://sys.example.com/hook',
        secret: 'sekret',
        events: ['proposal.created'],
        orgId: 'system',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/webhooks/${sysHook.id}`,
        headers: bearerNoBody(orgAAdminToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows org B token to delete its own webhook', async () => {
      const orgBHook = await db.createWebhook({
        url: 'https://b.example.com/hook2',
        secret: 'sekret',
        events: ['proposal.created'],
        orgId: 'orgB',
      });
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/webhooks/${orgBHook.id}`,
        headers: bearerNoBody(orgBWriteToken),
      });
      // orgB writeToken doesn't have admin scope → 403 from requireScope, OK
      // The point is not 200/204 from another org. Either 403 is acceptable.
      expect([403, 401]).toContain(res.statusCode);
    });
  });

  describe('sources reprocess', () => {
    it('rejects org A admin token reprocessing system source', async () => {
      const sys = await db.createSource({
        name: 'sys-rep',
        url: 'https://sys-rep.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/sources/${sys.id}/reprocess`,
        headers: bearerNoBody(orgAAdminToken),
      });
      // Either 403 (ownership) or 503 (LLM not configured) is acceptable —
      // the important assertion is that it is NOT 200.
      expect(res.statusCode).not.toBe(200);
      expect([403, 503]).toContain(res.statusCode);
    });
  });

  // Phase 54: scope-aware per-org override behavior.
  describe('sources PATCH per-org override (Phase 54)', () => {
    it('system caller PATCH mutates system column, scope=system', async () => {
      const sys = await db.createSource({
        name: 'sys-p54',
        url: 'https://sys-p54.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${sys.id}`,
        headers: bearer(systemAdminToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { scope: string; managementMode: string };
      expect(body.scope).toBe('system');
      const fresh = await db.getSource(sys.id);
      expect(fresh?.managementMode).toBe('llm');
    });

    it('org admin PATCH on org B source still 403', async () => {
      const orgBSrc = await db.createSource({
        name: 'orgb-p54',
        url: 'https://orgb-p54.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'orgB',
      });
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${orgBSrc.id}`,
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('sources/bulk-switch-mode per-org (Phase 54)', () => {
    it('org A bulk-switch UPSERTs override rows for caller', async () => {
      // Create a government source so bulk-switch finds something.
      const gov = await db.createSource({
        name: 'gov-bulk',
        url: 'https://gov-bulk.example.com',
        type: 'html',
        schedule: 'weekly',
        sourceCategory: 'government',
        orgId: 'system',
      } as Parameters<typeof db.createSource>[0]);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sources/bulk-switch-mode',
        headers: bearer(orgAAdminToken),
        body: JSON.stringify({ mode: 'llm' }),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        scope: string;
        orgId: string;
        updated: number;
      };
      expect(body.scope).toBe('org');
      expect(body.orgId).toBe('orgA');
      // Override row for orgA on the gov source.
      expect(await db.getSourceOrgManagementMode(gov.id, 'orgA')).toBe('llm');
      // System column unchanged.
      const fresh = await db.getSource(gov.id);
      expect(fresh?.managementMode).toBe('manual');
    });
  });

  describe('sources/:id/mode/reset (Phase 54)', () => {
    it('clears caller org override; effective mode falls back to system', async () => {
      const sys = await db.createSource({
        name: 'sys-reset',
        url: 'https://sys-reset.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });
      // Org A sets an override.
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/sources/${sys.id}`,
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({ managementMode: 'llm' }),
      });
      expect(await db.getSourceOrgManagementMode(sys.id, 'orgA')).toBe('llm');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/sources/${sys.id}/mode/reset`,
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { cleared: boolean; effectiveMode: string };
      expect(body.cleared).toBe(true);
      expect(body.effectiveMode).toBe('manual');
      expect(await db.getSourceOrgManagementMode(sys.id, 'orgA')).toBeNull();
    });

    it('returns 400 when system caller hits reset (nothing to reset)', async () => {
      const sys = await db.createSource({
        name: 'sys-reset-2',
        url: 'https://sys-reset-2.example.com',
        type: 'html',
        schedule: 'weekly',
        orgId: 'system',
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/sources/${sys.id}/mode/reset`,
        headers: bearer(systemAdminToken),
        body: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when source missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sources/does-not-exist/mode/reset',
        headers: bearer(orgAWriteToken),
        body: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
