/**
 * Phase 31.1 Plan 02 Task 2 — /oauth/token (Tests 12–20).
 *
 * Covers all three grants (authorization_code, refresh_token,
 * client_credentials), PKCE S256 verification, atomic single-use code
 * consumption, refresh rotate-on-use + reuse-detection, and client-auth
 * correctness for public vs confidential clients.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { decodeJwt } from 'jose';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../../src/auth/oauth-key-bootstrap.js';
import { createDashboardSigner } from '../../../src/auth/oauth-signer.js';
import { registerTokenRoutes } from '../../../src/routes/oauth/token.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

interface Ctx {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  userId: string;
  publicClientId: string;
  confidentialClientId: string;
  confidentialClientSecret: string;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-02-token-test-salt');
  const dbPath = join(tmpdir(), `test-token-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);
  const signer = await createDashboardSigner(storage, ENC_KEY);

  // Seed a dashboard user (FK target for auth-code row).
  const userId = randomUUID();
  const db = storage.getRawDatabase();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'admin', 1, ?)`,
  ).run(userId, `u-${userId}`, new Date().toISOString());

  // Seed two clients — one public, one confidential.
  const publicResult = await storage.oauthClients.register({
    clientName: 'Public Client',
    redirectUris: ['https://app.test/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
  });
  const confidentialResult = await storage.oauthClients.register({
    clientName: 'Confidential Client',
    redirectUris: ['https://app.test/cb'],
    grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    scope: 'read',
  });

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerTokenRoutes(server, storage, signer);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    await server.close();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
  };

  return {
    server,
    storage,
    userId,
    publicClientId: publicResult.clientId,
    confidentialClientId: confidentialResult.clientId,
    confidentialClientSecret: confidentialResult.clientSecret!,
    cleanup,
  };
}

async function createLiveCode(
  ctx: Ctx,
  overrides: Partial<{ clientId: string; scope: string; resource: string; codeChallenge: string }> = {},
): Promise<{ code: string; verifier: string }> {
  const verifier = overrides.codeChallenge === undefined ? 'a'.repeat(50) : '';
  const codeChallenge = overrides.codeChallenge ?? s256(verifier);
  const code = randomBytes(32).toString('base64url');
  const clientId = overrides.clientId ?? ctx.publicClientId;
  const scope = overrides.scope ?? 'read write';
  const resource = overrides.resource ?? 'https://svc/mcp';
  await ctx.storage.oauthCodes.createCode({
    code,
    clientId,
    userId: ctx.userId,
    redirectUri: 'https://app.test/cb',
    scope,
    resource,
    codeChallenge,
    codeChallengeMethod: 'S256',
    orgId: 'org-test',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return { code, verifier };
}

// ── Test 12 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 12 (authorization_code with valid PKCE)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('mints JWT + refresh token with correct claims', async () => {
    const { code, verifier } = await createLiveCode(ctx);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        code,
        code_verifier: verifier,
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      access_token: string; token_type: string; expires_in: number;
      refresh_token: string; scope: string;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe('read write');
    expect(typeof body.refresh_token).toBe('string');

    const payload = decodeJwt(body.access_token) as {
      sub: string; aud: string[] | string; orgId: string; scopes: string[]; client_id: string;
    };
    expect(payload.sub).toBe(ctx.userId);
    expect(payload.orgId).toBe('org-test');
    expect(payload.scopes).toEqual(['read', 'write']);
    // Phase 31.2 D-20 bullet 3: client_id claim threaded through from the
    // authorization_code row. Plan 04 mcp/middleware.ts consumes it for the
    // post-JWT revoked-client check.
    expect(payload.client_id).toBe(ctx.publicClientId);
    // aud could be serialised as a single string by jose when length=1; accept both.
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    expect(aud).toEqual(['https://svc/mcp']);
  });
});

// ── Test 13 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 13 (mismatched code_verifier)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_grant when code_verifier does not match challenge', async () => {
    const { code } = await createLiveCode(ctx);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        code,
        code_verifier: 'c'.repeat(50), // wrong verifier
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

// ── Test 14 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 14 (code replay blocked — single use)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('second exchange of the same code returns 400 invalid_grant', async () => {
    const { code, verifier } = await createLiveCode(ctx);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ctx.publicClientId,
      code,
      code_verifier: verifier,
      redirect_uri: 'https://app.test/cb',
    }).toString();
    const first = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const second = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: body,
    });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

// ── Test 15 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 15 (refresh rotates)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns new access + refresh token; parent flagged rotated', async () => {
    const { code, verifier } = await createLiveCode(ctx);
    const first = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        code, code_verifier: verifier, redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    const firstBody = first.json() as { refresh_token: string };
    const rawA = firstBody.refresh_token;

    const rotateRes = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ctx.publicClientId,
        refresh_token: rawA,
      }).toString(),
    });
    expect(rotateRes.statusCode).toBe(200);
    const rotated = rotateRes.json() as { access_token: string; refresh_token: string };
    expect(rotated.access_token).toBeTruthy();
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(rawA);

    // Phase 31.2 D-20 bullet 3: rotated access_token must also carry client_id.
    const rotatedPayload = decodeJwt(rotated.access_token) as { client_id?: string };
    expect(rotatedPayload.client_id).toBe(ctx.publicClientId);

    // Old refresh (rawA) should now be rotated=true.
    const hashA = createHash('sha256').update(rawA).digest('hex');
    const row = await ctx.storage.oauthRefresh.findByTokenHash(hashA);
    expect(row).not.toBeNull();
    expect(row!.rotated).toBe(true);
  });
});

// ── Test 16 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 16 (refresh reuse detection revokes chain)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('presenting a rotated refresh returns invalid_grant and revokes chain', async () => {
    // Mint chain A → B via the route.
    const { code, verifier } = await createLiveCode(ctx);
    const first = (await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        code, code_verifier: verifier, redirect_uri: 'https://app.test/cb',
      }).toString(),
    })).json() as { refresh_token: string };
    const rawA = first.refresh_token;

    const rotated = (await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ctx.publicClientId,
        refresh_token: rawA,
      }).toString(),
    })).json() as { refresh_token: string };
    const rawB = rotated.refresh_token;

    // Replay rawA → reuse detection.
    const replay = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ctx.publicClientId,
        refresh_token: rawA,
      }).toString(),
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({ error: 'invalid_grant' });

    // After chain revocation, rawB also fails.
    const sibling = await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ctx.publicClientId,
        refresh_token: rawB,
      }).toString(),
    });
    expect(sibling.statusCode).toBe(400);
    expect(sibling.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

// ── Test 17 ─────────────────────────────────────────────────────────────────

// Phase 31.2 D-15: dashboard /oauth/token retires client_credentials.
// Dashboard AS is now exclusively for user flows. Service-to-service bootstrap
// continues via per-service /api/v1/oauth/token on compliance/branding/llm
// (31.1 D-10 invariant preserved).
describe('POST /oauth/token — Test 17 (Phase 31.2 D-15: client_credentials retired → 400)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 {error:"unsupported_grant_type"} on grant_type=client_credentials', async () => {
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: ctx.confidentialClientId,
        client_secret: ctx.confidentialClientSecret,
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });
});

// ── Test 18 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 18 (unknown client_id)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_client when client_id is unknown (authorization_code grant)', async () => {
    // Phase 31.2: client_credentials retired; use authorization_code to exercise
    // the invalid-client path. The handler verifies the client BEFORE branching
    // on grant_type, so any non-existent id trips 400 invalid_client regardless
    // of grant.
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'nonexistent_xxxxx',
        code: 'ignored',
        code_verifier: 'ignored',
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client' });
  });
});

// ── Test 19 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 19 (public client presenting a secret)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('returns 400 invalid_client when token_endpoint_auth_method=none and secret is presented', async () => {
    const { code, verifier } = await createLiveCode(ctx);
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        client_secret: 'this-should-not-be-here',
        code, code_verifier: verifier,
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client' });
  });
});

// ── Test 20 ─────────────────────────────────────────────────────────────────

describe('POST /oauth/token — Test 20 (confidential client: wrong secret → invalid_client)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('rejects wrong secret with 400 invalid_client (via authorization_code grant)', async () => {
    // Phase 31.2: client_credentials retired; exercise the wrong-secret path
    // on the authorization_code grant, which still authenticates the client.
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.confidentialClientId,
        client_secret: 'wrong-secret-value',
        code: 'ignored',
        code_verifier: 'ignored',
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('Basic auth with matching secret on client_credentials STILL returns 400 unsupported_grant_type (D-15)', async () => {
    const creds = Buffer.from(`${ctx.confidentialClientId}:${ctx.confidentialClientSecret}`).toString('base64');
    const res = await ctx.server.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${creds}`,
      },
      payload: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    // Client auth succeeds (secret matches), but grant_type=client_credentials
    // is no longer supported on the dashboard AS — 400 unsupported_grant_type.
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });
});
