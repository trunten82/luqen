/**
 * Phase 32 Plan 04 Task 1 (RED) — jwt-minter tests.
 *
 * Tests 6-10 of plan 32-04. Exercises mintAgentToken:
 *   - reuses an existing DashboardSigner (no new secret material)
 *   - emits RS256 JWT with sub=userId, orgId, scopes, aud, client_id='__agent-internal__'
 *   - TTL = 300s (exp - iat)
 *   - different iat per mint → distinct JWT strings
 *   - sub is NEVER the synthetic internal client id
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../src/auth/oauth-key-bootstrap.js';
import {
  createDashboardSigner,
  type DashboardSigner,
} from '../../src/auth/oauth-signer.js';
import {
  mintAgentToken,
  AGENT_INTERNAL_CLIENT_ID,
} from '../../src/agent/jwt-minter.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

interface Ctx {
  storage: SqliteStorageAdapter;
  signer: DashboardSigner;
  cleanup: () => Promise<void>;
}

async function buildCtx(): Promise<Ctx> {
  setEncryptionSalt('phase-32-04-jwt-minter-salt');
  const dbPath = join(tmpdir(), `test-agent-jwt-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await ensureInitialSigningKey(storage, ENC_KEY);
  const signer = await createDashboardSigner(storage, ENC_KEY);
  return {
    storage,
    signer,
    cleanup: async () => {
      await storage.disconnect();
      if (existsSync(dbPath)) rmSync(dbPath);
    },
  };
}

describe('mintAgentToken', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await buildCtx();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it('Test 6: resolves to a string', async () => {
    const jwt = await mintAgentToken(
      ctx.signer,
      'user-1',
      'org-1',
      ['scans.view', 'reports.view'],
      'https://dashboard/mcp',
    );
    expect(typeof jwt).toBe('string');
    expect(jwt.split('.').length).toBe(3);
  });

  it('Test 7: decodes to correct claims with 300s TTL', async () => {
    const jwt = await mintAgentToken(
      ctx.signer,
      'user-1',
      'org-1',
      ['scans.view', 'reports.view'],
      'https://dashboard/mcp',
    );
    const payload = decodeJwt(jwt) as {
      sub: string;
      orgId: string;
      scopes: string[];
      aud: string | string[];
      client_id: string;
      iat: number;
      exp: number;
    };
    expect(payload.sub).toBe('user-1');
    expect(payload.orgId).toBe('org-1');
    expect(payload.scopes).toEqual(['scans.view', 'reports.view']);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    expect(aud).toEqual(['https://dashboard/mcp']);
    expect(payload.client_id).toBe(AGENT_INTERNAL_CLIENT_ID);
    expect(payload.exp - payload.iat).toBe(300);
  });

  it('Test 8: protected header has alg=RS256 + kid matching the signer', async () => {
    const jwt = await mintAgentToken(
      ctx.signer,
      'user-1',
      'org-1',
      ['scans.view'],
      'https://dashboard/mcp',
    );
    const header = decodeProtectedHeader(jwt);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(ctx.signer.currentKid);
  });

  it('Test 9: two successive mints produce DIFFERENT JWT strings (fresh per dispatch)', async () => {
    const a = await mintAgentToken(ctx.signer, 'user-1', 'org-1', [], 'https://dashboard/mcp');
    // Wait enough to guarantee iat ticks over at least one second
    await new Promise((r) => setTimeout(r, 1100));
    const b = await mintAgentToken(ctx.signer, 'user-1', 'org-1', [], 'https://dashboard/mcp');
    expect(a).not.toBe(b);
    const pa = decodeJwt(a) as { iat: number };
    const pb = decodeJwt(b) as { iat: number };
    expect(pb.iat).toBeGreaterThan(pa.iat);
  });

  it("Test 10: sub is the real user id; NEVER equals '__agent-internal__'", async () => {
    const jwt = await mintAgentToken(
      ctx.signer,
      'user-42',
      'org-1',
      [],
      'https://dashboard/mcp',
    );
    const payload = decodeJwt(jwt) as { sub: string; client_id: string };
    expect(payload.sub).toBe('user-42');
    expect(payload.sub).not.toBe(AGENT_INTERNAL_CLIENT_ID);
    expect(payload.client_id).toBe(AGENT_INTERNAL_CLIENT_ID);
  });
});
