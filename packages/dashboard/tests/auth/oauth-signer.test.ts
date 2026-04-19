/**
 * Phase 31.1 Plan 02 Task 1 — ensureInitialSigningKey + createDashboardSigner.
 *
 * Tests 1, 2, 3 per plan (Task 1 behavior section).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { importSPKI, jwtVerify, decodeProtectedHeader } from 'jose';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { setEncryptionSalt } from '../../src/plugins/crypto.js';
import { ensureInitialSigningKey } from '../../src/auth/oauth-key-bootstrap.js';
import { createDashboardSigner } from '../../src/auth/oauth-signer.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  setEncryptionSalt('phase-31-1-plan-02-test-salt');
  dbPath = join(tmpdir(), `test-signer-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('ensureInitialSigningKey — Test 1 (idempotent bootstrap)', () => {
  it('inserts exactly one active key on first call; subsequent calls are no-ops', async () => {
    expect((await storage.oauthSigningKeys.listActiveKeys()).length).toBe(0);

    await ensureInitialSigningKey(storage, ENC_KEY);
    const afterFirst = await storage.oauthSigningKeys.listActiveKeys();
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0]!.publicKeyPem).toContain('BEGIN PUBLIC KEY');

    await ensureInitialSigningKey(storage, ENC_KEY);
    const afterSecond = await storage.oauthSigningKeys.listActiveKeys();
    expect(afterSecond.length).toBe(1);
    expect(afterSecond[0]!.kid).toBe(afterFirst[0]!.kid);
  });
});

describe('createDashboardSigner — Test 2 (mintAccessToken RS256 + kid + client_id claim)', () => {
  it('mints an RS256 JWT with kid header and payload claims including client_id', async () => {
    await ensureInitialSigningKey(storage, ENC_KEY);
    const signer = await createDashboardSigner(storage, ENC_KEY);
    const token = await signer.mintAccessToken({
      sub: 'user-123',
      orgId: 'org-xyz',
      scopes: ['read', 'write'],
      aud: ['https://mcp.example.com/mcp'],
      expiresInSeconds: 3600,
      clientId: 'dcr_abc123',
    });

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(signer.currentKid);

    const activeKey = (await storage.oauthSigningKeys.listActiveKeys())[0]!;
    const publicKey = await importSPKI(activeKey.publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'] });

    expect(payload.sub).toBe('user-123');
    expect(payload.orgId).toBe('org-xyz');
    expect(payload.aud).toEqual(['https://mcp.example.com/mcp']);
    expect((payload as { scopes?: unknown }).scopes).toEqual(['read', 'write']);
    // Phase 31.2 D-20 bullet 3: every dashboard-minted access token carries
    // a `client_id` claim so the RS verifier (Plan 04 mcp/middleware.ts) can
    // run a post-JWT revoked-client check.
    expect((payload as { client_id?: unknown }).client_id).toBe('dcr_abc123');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });
});

describe('createDashboardSigner — Test 3 (verifies against active key SPKI)', () => {
  it("the minted JWT verifies against the current active key's public PEM", async () => {
    await ensureInitialSigningKey(storage, ENC_KEY);
    const signer = await createDashboardSigner(storage, ENC_KEY);

    const token = await signer.mintAccessToken({
      sub: 'u-1',
      orgId: 'o-1',
      scopes: ['read'],
      aud: ['https://svc.local/mcp'],
      expiresInSeconds: 3600,
      clientId: 'dcr_test',
    });

    const active = (await storage.oauthSigningKeys.listActiveKeys())[0]!;
    const pubKey = await importSPKI(active.publicKeyPem, 'RS256');
    await expect(jwtVerify(token, pubKey, { algorithms: ['RS256'] })).resolves.toBeDefined();
  });
});

describe('createDashboardSigner — Test 4 (Phase 31.2 D-20: clientId is a required field)', () => {
  it('omitting clientId is a TypeScript compile error (typecheck-level guard)', async () => {
    await ensureInitialSigningKey(storage, ENC_KEY);
    const signer = await createDashboardSigner(storage, ENC_KEY);

    // The @ts-expect-error directive below asserts that the following call
    // is a TypeScript type error. If clientId is ever made optional, the
    // directive becomes a dangling expectation and `pnpm typecheck` fails,
    // forcing the author to re-justify the optional-ness.
    //
    // At RUNTIME the call still resolves (TS is type-level, not runtime
    // enforcement) — so we do NOT assert rejects here. The type-level
    // assertion IS the test; runtime resolution is documentation.
    const token = await signer.mintAccessToken({
      sub: 'u-1',
      orgId: 'o-1',
      scopes: ['read'],
      aud: ['https://svc.local/mcp'],
      expiresInSeconds: 3600,
      // @ts-expect-error — clientId is REQUIRED per 31.2 D-20 bullet 3.
    });
    expect(typeof token).toBe('string');
  });
});
