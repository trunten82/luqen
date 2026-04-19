/**
 * Phase 31.1 Plan 01 Task 1 — OauthClientRepository contract tests.
 *
 * Covers MCPAUTH-02 data-layer foundation:
 *   - register() returns dcr_-prefixed client_id and (for confidential
 *     clients) a raw client_secret returned ONCE.
 *   - client_secret_hash is the ONLY persisted form; verifyClientSecret
 *     uses bcrypt.compare.
 *   - redirect_uris + grant_types round-trip as JSON arrays.
 *   - listByUserId returns rows ordered created_at DESC.
 *   - revoke() deletes the row.
 *
 * Harness pattern: temp-file sqlite + storage.migrate() (matches
 * agent-audit-repository.test.ts from Phase 31).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOauthClientRepository — register (public)', () => {
  it('returns a dcr_-prefixed client_id and null client_secret for public clients', async () => {
    const result = await storage.oauthClients.register({
      clientName: 'Claude Desktop',
      redirectUris: ['http://127.0.0.1:33418/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
    });

    expect(result.clientId).toMatch(/^dcr_[a-f0-9]{32}$/);
    expect(result.clientSecret).toBeNull();
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SqliteOauthClientRepository — register (confidential)', () => {
  it('returns a non-null client_secret for client_secret_basic and stores only the bcrypt hash', async () => {
    const result = await storage.oauthClients.register({
      clientName: 'Server-Side MCP Client',
      redirectUris: ['https://app.example.com/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scope: 'read',
    });

    expect(result.clientSecret).not.toBeNull();
    expect(typeof result.clientSecret).toBe('string');
    // 32 random bytes → 64 hex chars
    expect(result.clientSecret!).toMatch(/^[a-f0-9]{64}$/);

    const persisted = await storage.oauthClients.findByClientId(result.clientId);
    expect(persisted).not.toBeNull();
    // Raw secret is NEVER readable from DB — only the bcrypt hash.
    expect(persisted!.clientSecretHash).not.toBeNull();
    expect(persisted!.clientSecretHash).not.toBe(result.clientSecret);
    expect(persisted!.clientSecretHash!.startsWith('$2')).toBe(true);
  });
});

describe('SqliteOauthClientRepository — findByClientId', () => {
  it('returns the persisted client with hash (not raw secret) or null for unknown id', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Test Client',
      redirectUris: ['https://x.example/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    const found = await storage.oauthClients.findByClientId(reg.clientId);
    expect(found).not.toBeNull();
    expect(found!.clientId).toBe(reg.clientId);
    expect(found!.clientName).toBe('Test Client');
    // Public client: secret hash is null (no confidential secret stored).
    expect(found!.clientSecretHash).toBeNull();

    const missing = await storage.oauthClients.findByClientId('dcr_nonexistent');
    expect(missing).toBeNull();
  });
});

describe('SqliteOauthClientRepository — verifyClientSecret', () => {
  it('returns true for the secret returned at registration, false otherwise', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Confidential',
      redirectUris: ['https://x.example/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      scope: 'read',
    });

    const ok = await storage.oauthClients.verifyClientSecret(
      reg.clientId,
      reg.clientSecret!,
    );
    expect(ok).toBe(true);

    const bad = await storage.oauthClients.verifyClientSecret(
      reg.clientId,
      'not-the-real-secret',
    );
    expect(bad).toBe(false);

    // Public client (no hash) always verifies false.
    const pub = await storage.oauthClients.register({
      clientName: 'Public',
      redirectUris: ['http://localhost/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });
    const pubCheck = await storage.oauthClients.verifyClientSecret(
      pub.clientId,
      'any-secret',
    );
    expect(pubCheck).toBe(false);

    // Unknown client id always false.
    const unknown = await storage.oauthClients.verifyClientSecret(
      'dcr_nonexistent',
      'x',
    );
    expect(unknown).toBe(false);
  });
});

describe('SqliteOauthClientRepository — listByUserId', () => {
  it('returns all clients registered by the user ordered created_at DESC, empty array for unknown user', async () => {
    const user = await storage.users.createUser(
      `u-${randomUUID()}`,
      'pass123',
      'user',
    );

    const first = await storage.oauthClients.register({
      clientName: 'First',
      redirectUris: ['https://x/1'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: user.id,
    });

    // Tiny wait so created_at differs (ISO-ms precision).
    await new Promise((r) => setTimeout(r, 10));

    const second = await storage.oauthClients.register({
      clientName: 'Second',
      redirectUris: ['https://x/2'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
      registeredByUserId: user.id,
    });

    const list = await storage.oauthClients.listByUserId(user.id);
    expect(list).toHaveLength(2);
    // DESC — newest first.
    expect(list[0]!.clientId).toBe(second.clientId);
    expect(list[1]!.clientId).toBe(first.clientId);

    const empty = await storage.oauthClients.listByUserId('no-such-user');
    expect(empty).toEqual([]);
  });
});

describe('SqliteOauthClientRepository — revoke', () => {
  it('deletes the client row', async () => {
    const reg = await storage.oauthClients.register({
      clientName: 'Doomed',
      redirectUris: ['https://x/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    expect(await storage.oauthClients.findByClientId(reg.clientId)).not.toBeNull();

    await storage.oauthClients.revoke(reg.clientId);

    expect(await storage.oauthClients.findByClientId(reg.clientId)).toBeNull();
  });
});

describe('SqliteOauthClientRepository — redirect_uris + grant_types JSON round-trip', () => {
  it('persists redirect_uris as a JSON array and grant_types as a JSON array; round-trip preserved', async () => {
    const redirects = [
      'http://127.0.0.1:33418/callback',
      'https://app.example.com/oauth/callback',
    ];
    const grants = ['authorization_code', 'refresh_token'];

    const reg = await storage.oauthClients.register({
      clientName: 'Multi-redirect',
      redirectUris: redirects,
      grantTypes: grants,
      tokenEndpointAuthMethod: 'none',
      scope: 'read write',
      softwareId: 'claude-desktop',
      softwareVersion: '1.0.0',
    });

    const found = await storage.oauthClients.findByClientId(reg.clientId);
    expect(found).not.toBeNull();
    expect(Array.isArray(found!.redirectUris)).toBe(true);
    expect([...found!.redirectUris]).toEqual(redirects);
    expect(Array.isArray(found!.grantTypes)).toBe(true);
    expect([...found!.grantTypes]).toEqual(grants);
    expect(found!.softwareId).toBe('claude-desktop');
    expect(found!.softwareVersion).toBe('1.0.0');
    expect(found!.scope).toBe('read write');
  });
});
