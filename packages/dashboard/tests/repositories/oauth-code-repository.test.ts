/**
 * Phase 31.1 Plan 01 Task 2 — OauthCodeRepository contract tests.
 *
 * Covers D-30 (single-use, 60s TTL) + D-31 (PKCE S256-only):
 *   - createCode + findAndConsume round-trip.
 *   - findAndConsume is atomic — second call returns null (T-31.1-01-03).
 *   - Expired codes → null (but row still deleted).
 *   - Non-S256 code_challenge_method throws before INSERT.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let clientId: string;
let userId: string;
const orgA = 'org-a';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  // Seed a client and a user so FK constraints pass.
  const reg = await storage.oauthClients.register({
    clientName: 'Test',
    redirectUris: ['https://x/cb'],
    grantTypes: ['authorization_code'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
  });
  clientId = reg.clientId;
  const user = await storage.users.createUser(
    `u-${randomUUID()}`,
    'pass123',
    'user',
  );
  userId = user.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOauthCodeRepository — createCode + findAndConsume', () => {
  it('findAndConsume returns the row on first call and null on second call (atomic single-use)', async () => {
    const code = `c_${randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await storage.oauthCodes.createCode({
      code,
      clientId,
      userId,
      redirectUri: 'https://x/cb',
      scope: 'read write',
      resource: 'https://x/mcp https://y/mcp',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256',
      orgId: orgA,
      expiresAt,
    });

    const first = await storage.oauthCodes.findAndConsume(code);
    expect(first).not.toBeNull();
    expect(first!.code).toBe(code);
    expect(first!.clientId).toBe(clientId);
    expect(first!.userId).toBe(userId);
    expect(first!.scope).toBe('read write');
    expect(first!.resource).toBe('https://x/mcp https://y/mcp');
    expect(first!.codeChallenge).toBe('abc123');
    expect(first!.codeChallengeMethod).toBe('S256');
    expect(first!.orgId).toBe(orgA);

    const second = await storage.oauthCodes.findAndConsume(code);
    expect(second).toBeNull();
  });
});

describe('SqliteOauthCodeRepository — expired codes', () => {
  it('findAndConsume returns null for expired rows (and still deletes them)', async () => {
    const code = `c_${randomUUID().replace(/-/g, '')}`;
    // expires_at in the past
    const expiresAt = new Date(Date.now() - 10_000).toISOString();

    await storage.oauthCodes.createCode({
      code,
      clientId,
      userId,
      redirectUri: 'https://x/cb',
      scope: 'read',
      resource: 'https://x/mcp',
      codeChallenge: 'abc',
      codeChallengeMethod: 'S256',
      orgId: orgA,
      expiresAt,
    });

    const consumed = await storage.oauthCodes.findAndConsume(code);
    expect(consumed).toBeNull();

    // Row is still gone even though we returned null — idempotent sweep.
    const again = await storage.oauthCodes.findAndConsume(code);
    expect(again).toBeNull();
  });
});

describe('SqliteOauthCodeRepository — PKCE S256-only', () => {
  it('createCode with code_challenge_method !== S256 throws the literal error "code_challenge_method must be S256"', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      storage.oauthCodes.createCode({
        code: 'bogus',
        clientId,
        userId,
        redirectUri: 'https://x/cb',
        scope: 'read',
        resource: 'https://x/mcp',
        codeChallenge: 'abc',
        // @ts-expect-error — deliberately test the runtime guard
        codeChallengeMethod: 'plain',
        orgId: orgA,
        expiresAt,
      }),
    ).rejects.toThrow('code_challenge_method must be S256');
  });
});
