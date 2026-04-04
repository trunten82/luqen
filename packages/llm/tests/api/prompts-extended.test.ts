import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-prompts-ext-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('Prompt Override API (extended)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let adminToken: string;

  beforeAll(async () => {
    cleanup();
    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });

    await app.ready();

    adminToken = await signToken({
      sub: 'admin-user',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  describe('GET /api/v1/prompts/:capability', () => {
    it('returns default template (isOverride: false) when no override exists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ capability: string; isOverride: boolean; template: string; orgId: string }>();
      expect(body.capability).toBe('generate-fix');
      expect(body.isOverride).toBe(false);
      expect(typeof body.template).toBe('string');
      expect(body.template.length).toBeGreaterThan(0);
      expect(body.orgId).toBe('system');
    });

    it('returns extract-requirements default template', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/extract-requirements',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isOverride: boolean; template: string }>();
      expect(body.isOverride).toBe(false);
      expect(body.template.length).toBeGreaterThan(0);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/invalid-capability',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Invalid capability/);
    });

    it('returns override when one exists with orgId query param', async () => {
      // Set an override first
      await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/analyse-report',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: 'Custom analyse template', orgId: 'ext-test-org' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/prompts/analyse-report?orgId=ext-test-org',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ isOverride: boolean; template: string }>();
      expect(body.isOverride).toBe(true);
      expect(body.template).toBe('Custom analyse template');
    });
  });

  describe('PUT /api/v1/prompts/:capability (validation)', () => {
    it('returns 400 when template field is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/generate-fix',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { orgId: 'test-org' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/template/);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/unknown-capability',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: 'some template' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates override without orgId (system scope)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/prompts/discover-branding',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { template: 'System-wide branding template' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ isOverride: boolean }>().isOverride).toBe(true);
    });
  });

  describe('DELETE /api/v1/prompts/:capability', () => {
    it('returns 404 when no override exists to delete', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/prompts/extract-requirements?orgId=no-such-org',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid capability name', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/prompts/invalid-cap',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
