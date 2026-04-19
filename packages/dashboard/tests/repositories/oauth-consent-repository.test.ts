/**
 * Phase 31.1 Plan 01 Task 3 — OauthConsentRepository contract tests.
 *
 * Covers D-20 remembered consent + T-31.1-01-05 cross-client isolation:
 *   - recordConsent upserts (same user+client replaces scopes/resources)
 *   - checkCoverage: covered true when scopes+resources are subsets
 *   - checkCoverage: missing scope returned in missingScopes
 *   - checkCoverage: missing resource returned in missingResources
 *   - listByUser ordered consented_at DESC
 *   - revoke deletes the row
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let userId: string;
let clientId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const user = await storage.users.createUser(
    `u-${randomUUID()}`,
    'pass123',
    'user',
  );
  userId = user.id;
  const reg = await storage.oauthClients.register({
    clientName: 'Consent Test',
    redirectUris: ['https://x/cb'],
    grantTypes: ['authorization_code'],
    tokenEndpointAuthMethod: 'none',
    scope: 'read',
  });
  clientId = reg.clientId;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('SqliteOauthConsentRepository — recordConsent (upsert)', () => {
  it('inserts a row for a new (user,client) pair', async () => {
    const c = await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read', 'write'],
      resources: ['https://x/mcp'],
    });

    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.userId).toBe(userId);
    expect(c.clientId).toBe(clientId);
    expect([...c.scopes]).toEqual(['read', 'write']);
    expect([...c.resources]).toEqual(['https://x/mcp']);
    expect(c.consentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(c.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upserts existing (user,client) rows — replaces scopes + resources', async () => {
    await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read'],
      resources: ['https://x/mcp'],
    });

    const second = await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read', 'write'],
      resources: ['https://x/mcp', 'https://y/mcp'],
    });

    expect([...second.scopes]).toEqual(['read', 'write']);
    expect([...second.resources]).toEqual(['https://x/mcp', 'https://y/mcp']);

    // listByUser should return exactly one row (upsert, not insert).
    const all = await storage.oauthConsents.listByUser(userId);
    expect(all).toHaveLength(1);
  });
});

describe('SqliteOauthConsentRepository — checkCoverage', () => {
  it('returns covered:true when requested scopes and resources are subsets', async () => {
    await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read', 'write'],
      resources: ['https://x/mcp'],
    });

    const result = await storage.oauthConsents.checkCoverage({
      userId,
      clientId,
      requestedScopes: ['read'],
      requestedResources: ['https://x/mcp'],
    });

    expect(result.covered).toBe(true);
    expect(result.missingScopes).toEqual([]);
    expect(result.missingResources).toEqual([]);
    expect(result.existingConsent).not.toBeNull();
  });

  it('returns covered:false with missingScopes when a new scope is requested', async () => {
    await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read', 'write'],
      resources: ['https://x/mcp'],
    });

    const result = await storage.oauthConsents.checkCoverage({
      userId,
      clientId,
      requestedScopes: ['read', 'write', 'admin.system'],
      requestedResources: ['https://x/mcp'],
    });

    expect(result.covered).toBe(false);
    expect(result.missingScopes).toEqual(['admin.system']);
    expect(result.missingResources).toEqual([]);
  });

  it('returns covered:false with missingResources when a new resource is requested', async () => {
    await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read'],
      resources: ['https://x/mcp'],
    });

    const result = await storage.oauthConsents.checkCoverage({
      userId,
      clientId,
      requestedScopes: ['read'],
      requestedResources: ['https://y/mcp'],
    });

    expect(result.covered).toBe(false);
    expect(result.missingScopes).toEqual([]);
    expect(result.missingResources).toEqual(['https://y/mcp']);
  });

  it('returns covered:false with full missing lists when no consent exists', async () => {
    const result = await storage.oauthConsents.checkCoverage({
      userId,
      clientId,
      requestedScopes: ['read'],
      requestedResources: ['https://x/mcp'],
    });

    expect(result.covered).toBe(false);
    expect(result.existingConsent).toBeNull();
    expect(result.missingScopes).toEqual(['read']);
    expect(result.missingResources).toEqual(['https://x/mcp']);
  });
});

describe('SqliteOauthConsentRepository — listByUser', () => {
  it('returns consents ordered by consented_at DESC', async () => {
    // Register a second client so the user can have two consent rows.
    const reg2 = await storage.oauthClients.register({
      clientName: 'Other',
      redirectUris: ['https://x/cb'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      scope: 'read',
    });

    const first = await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read'],
      resources: ['https://x/mcp'],
    });

    await new Promise((r) => setTimeout(r, 10));

    const second = await storage.oauthConsents.recordConsent({
      userId,
      clientId: reg2.clientId,
      scopes: ['read'],
      resources: ['https://y/mcp'],
    });

    const list = await storage.oauthConsents.listByUser(userId);
    expect(list).toHaveLength(2);
    // DESC — newest first
    expect(list[0]!.id).toBe(second.id);
    expect(list[1]!.id).toBe(first.id);
  });
});

describe('SqliteOauthConsentRepository — revoke', () => {
  it('deletes the consent row', async () => {
    await storage.oauthConsents.recordConsent({
      userId,
      clientId,
      scopes: ['read'],
      resources: ['https://x/mcp'],
    });

    await storage.oauthConsents.revoke(userId, clientId);

    const after = await storage.oauthConsents.listByUser(userId);
    expect(after).toEqual([]);
  });
});
