import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';

/**
 * Branding cross-org RBAC regression — Plan 51-02.
 *
 * Org A's per-org write token must not be able to mutate (PUT/DELETE/sub-
 * resource POST/DELETE) a guideline owned by org B or by 'system'.
 */
describe('branding cross-org isolation', () => {
  let app: FastifyInstance;
  let db: SqliteAdapter;
  let orgAToken: string;
  let orgBToken: string;
  let systemToken: string;
  let orgAGuidelineId: string;
  let orgBGuidelineId: string;
  let systemGuidelineId: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    db = new SqliteAdapter(':memory:');
    await db.initialize();
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

    orgAToken = await signToken({
      sub: 'orga-client',
      scopes: ['read', 'write'],
      orgId: 'orgA',
      expiresIn: '1h',
    });
    orgBToken = await signToken({
      sub: 'orgb-client',
      scopes: ['read', 'write'],
      orgId: 'orgB',
      expiresIn: '1h',
    });
    systemToken = await signToken({
      sub: 'sys-client',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });

    const orgAGuide = db.createGuideline({ name: 'A-guide', orgId: 'orgA' });
    orgAGuidelineId = orgAGuide.id;
    const orgBGuide = db.createGuideline({ name: 'B-guide', orgId: 'orgB' });
    orgBGuidelineId = orgBGuide.id;
    const sysGuide = db.createGuideline({ name: 'sys-guide', orgId: 'system' });
    systemGuidelineId = sysGuide.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  }

  it('rejects org A token PUT on org B guideline', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/guidelines/${orgBGuidelineId}`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ name: 'pwned' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token PUT on system guideline', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/guidelines/${systemGuidelineId}`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ name: 'pwned' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token DELETE on org B guideline', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/guidelines/${orgBGuidelineId}`,
      headers: { authorization: `Bearer ${orgAToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token POST color on org B guideline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/guidelines/${orgBGuidelineId}/colors`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ name: 'red', hexValue: '#ff0000' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token POST font on org B guideline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/guidelines/${orgBGuidelineId}/fonts`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ family: 'Comic Sans' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token POST selector on org B guideline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/guidelines/${orgBGuidelineId}/selectors`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ pattern: '.brand' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects org A token POST site assignment on org B guideline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/guidelines/${orgBGuidelineId}/sites`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ siteUrl: 'https://example.com' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows org A token PUT on its own guideline', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/guidelines/${orgAGuidelineId}`,
      headers: bearer(orgAToken),
      body: JSON.stringify({ name: 'A-guide-updated' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows org B token PUT on its own guideline', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/guidelines/${orgBGuidelineId}`,
      headers: bearer(orgBToken),
      body: JSON.stringify({ name: 'B-guide-updated' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows system token PUT on system guideline', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/guidelines/${systemGuidelineId}`,
      headers: bearer(systemToken),
      body: JSON.stringify({ name: 'sys-guide-updated' }),
    });
    expect(res.statusCode).toBe(200);
  });
});
