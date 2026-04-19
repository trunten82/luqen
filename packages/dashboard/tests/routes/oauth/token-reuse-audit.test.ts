/**
 * Phase 31.1 Plan 04 Task 1 — refresh-reuse detection audit write (Test 9).
 *
 * When /oauth/token grant_type=refresh_token handler detects reuse (via
 * oauthRefresh.rotate → kind='reuse_detected'), it writes an agent_audit_log
 * row with tool_name='oauth.refresh_reuse_detected' and outcome='error'.
 * This is D-29 + "Specific Ideas" from 31.1-CONTEXT.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
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
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-31-1-plan-04-reuse-audit-salt');
  const dbPath = join(tmpdir(), `test-reuse-audit-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);
  const signer = await createDashboardSigner(storage, ENC_KEY);

  const userId = randomUUID();
  const db = storage.getRawDatabase();
  db.prepare(
    `INSERT INTO dashboard_users (id, username, password_hash, role, active, created_at)
     VALUES (?, ?, 'pw', 'admin', 1, ?)`,
  ).run(userId, `u-${userId}`, new Date().toISOString());

  const publicResult = await storage.oauthClients.register({
    clientName: 'Reuse-Audit Test Client',
    redirectUris: ['https://app.test/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read write',
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
    cleanup,
  };
}

async function createLiveCode(ctx: Ctx): Promise<{ code: string; verifier: string }> {
  const verifier = 'a'.repeat(50);
  const codeChallenge = s256(verifier);
  const code = randomBytes(32).toString('base64url');
  await ctx.storage.oauthCodes.createCode({
    code,
    clientId: ctx.publicClientId,
    userId: ctx.userId,
    redirectUri: 'https://app.test/cb',
    scope: 'read write',
    resource: 'https://svc/mcp',
    codeChallenge,
    codeChallengeMethod: 'S256',
    orgId: 'org-test',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return { code, verifier };
}

describe('POST /oauth/token — Test 9 (reuse_detected writes agent_audit_log)', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await buildCtx(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('writes oauth.refresh_reuse_detected audit row when a rotated refresh is replayed', async () => {
    // Mint initial chain: code exchange → rawA.
    const { code, verifier } = await createLiveCode(ctx);
    const first = (await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: ctx.publicClientId,
        code, code_verifier: verifier,
        redirect_uri: 'https://app.test/cb',
      }).toString(),
    })).json() as { refresh_token: string };
    const rawA = first.refresh_token;

    // Rotate rawA → rawB (legit).
    await ctx.server.inject({
      method: 'POST', url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ctx.publicClientId,
        refresh_token: rawA,
      }).toString(),
    });

    // Replay rawA → reuse detection; should write audit row.
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

    // Assert the audit row.
    const db = ctx.storage.getRawDatabase();
    const rows = db
      .prepare(`SELECT * FROM agent_audit_log WHERE tool_name = 'oauth.refresh_reuse_detected'`)
      .all() as Array<{
        tool_name: string; outcome: string; outcome_detail: string | null;
        user_id: string; org_id: string; args_json: string;
      }>;
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.outcome).toBe('error');
    expect(row.outcome_detail).toContain(ctx.publicClientId);
    expect(row.outcome_detail).toContain('chain_revoked');
    // args_json should contain the clientId.
    const parsed = JSON.parse(row.args_json) as Record<string, unknown>;
    expect(parsed['clientId']).toBe(ctx.publicClientId);
  });
});
