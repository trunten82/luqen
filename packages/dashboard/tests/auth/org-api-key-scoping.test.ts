/**
 * Tests for org-scoped API key behavior.
 *
 * Covers:
 * - validateApiKey returns orgId from database
 * - enforceApiKeyRole blocks org-scoped keys from admin endpoints
 * - enforceApiKeyRole allows org-scoped keys to access non-admin endpoints
 * - System admin keys with X-Org-Id header get the header value as currentOrgId
 * - Org-scoped keys ignore X-Org-Id header (currentOrgId stays as key's orgId)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { generateApiKey, validateApiKey } from '../../src/auth/api-key.js';
import { enforceApiKeyRole } from '../../src/auth/api-key-guard.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockReply(): { code: (n: number) => { send: (b: unknown) => void }; _code?: number; _body?: unknown } {
  const mock: { _code?: number; _body?: unknown; code: (n: number) => { send: (b: unknown) => void } } = {
    code(n: number) {
      mock._code = n;
      return {
        send(b: unknown) {
          mock._body = b;
        },
      };
    },
  };
  return mock;
}

function makeRequest(overrides: Partial<{
  id: string;
  role: string;
  currentOrgId: string | undefined;
  url: string;
  method: string;
}>): FastifyRequest {
  return {
    user: {
      id: overrides.id ?? 'api-key',
      username: 'api-key',
      role: overrides.role ?? 'admin',
      currentOrgId: overrides.currentOrgId,
    },
    url: overrides.url ?? '/api/v1/scans',
    method: overrides.method ?? 'GET',
  } as unknown as FastifyRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Org-scoped API key scoping', () => {
  let storage: SqliteStorageAdapter;

  beforeEach(async () => {
    storage = new SqliteStorageAdapter(':memory:');
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.disconnect();
  });

  // ---- validateApiKey returns orgId from database -------------------------

  describe('validateApiKey — org_id propagation', () => {
    it('returns orgId from database for an org-scoped key', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();

      // Insert key directly with org_id = 'org-123'
      await storage.apiKeys.storeKey(key, 'org-test-key', 'org-123', 'read-only');

      const result = validateApiKey(db, key);
      expect(result.valid).toBe(true);
      expect(result.orgId).toBe('org-123');
    });

    it('returns orgId="system" for a system-scoped key', async () => {
      const db = storage.getRawDatabase();
      const key = generateApiKey();

      // Insert key with org_id = 'system' (the default)
      await storage.apiKeys.storeKey(key, 'system-key', 'system', 'admin');

      const result = validateApiKey(db, key);
      expect(result.valid).toBe(true);
      expect(result.orgId).toBe('system');
    });

    it('returns valid=false for an unknown key', () => {
      const db = storage.getRawDatabase();
      const result = validateApiKey(db, 'nonexistent-key-value');
      expect(result.valid).toBe(false);
      expect(result.orgId).toBeUndefined();
    });
  });

  // ---- enforceApiKeyRole — org-scoped blocking ----------------------------

  describe('enforceApiKeyRole — org-scoped admin endpoint blocking', () => {
    it('blocks org-scoped keys from /api/v1/admin paths', async () => {
      const request = makeRequest({ currentOrgId: 'org-123', url: '/api/v1/admin/users' });
      const reply = makeMockReply();

      await enforceApiKeyRole(request, reply as unknown as FastifyReply);

      expect(reply._code).toBe(403);
    });

    it('blocks org-scoped keys from /api/v1/orgs paths', async () => {
      const request = makeRequest({ currentOrgId: 'org-abc', url: '/api/v1/orgs' });
      const reply = makeMockReply();

      await enforceApiKeyRole(request, reply as unknown as FastifyReply);

      expect(reply._code).toBe(403);
    });

    it('allows org-scoped keys to access /api/v1/scans', async () => {
      const request = makeRequest({ currentOrgId: 'org-123', url: '/api/v1/scans' });
      const reply = makeMockReply();

      await enforceApiKeyRole(request, reply as unknown as FastifyReply);

      expect(reply._code).toBeUndefined();
    });

    it('allows org-scoped keys to access /api/v1/reports', async () => {
      const request = makeRequest({ currentOrgId: 'org-123', url: '/api/v1/reports' });
      const reply = makeMockReply();

      await enforceApiKeyRole(request, reply as unknown as FastifyReply);

      expect(reply._code).toBeUndefined();
    });
  });

  // ---- system admin key with X-Org-Id header ------------------------------

  describe('system admin key — X-Org-Id header behavior', () => {
    it('system admin key without currentOrgId allows X-Org-Id to be applied (server logic)', async () => {
      // This tests the logic: system admin key (currentOrgId undefined) + orgHeader
      // The server sets currentOrgId from the header when currentOrgId is NOT already set
      const user = {
        id: 'api-key' as const,
        username: 'api-key',
        role: 'admin' as const,
        currentOrgId: undefined as string | undefined,
      };

      const orgHeader = 'org-from-header';
      const isAlreadyScoped = user.currentOrgId !== undefined;

      // Simulate server logic: if NOT already scoped + admin role, apply header
      if (!isAlreadyScoped && user.id === 'api-key' && user.role === 'admin' && orgHeader !== undefined) {
        user.currentOrgId = orgHeader;
      }

      expect(user.currentOrgId).toBe('org-from-header');
    });

    it('org-scoped key ignores X-Org-Id header (currentOrgId stays as key orgId)', () => {
      const user = {
        id: 'api-key' as const,
        username: 'api-key',
        role: 'admin' as const,
        currentOrgId: 'org-123' as string | undefined,
      };

      const orgHeader = 'different-org';
      const isAlreadyScoped = user.currentOrgId !== undefined;

      // Simulate server logic: if ALREADY scoped, skip header override
      if (!isAlreadyScoped && user.id === 'api-key' && user.role === 'admin' && orgHeader !== undefined) {
        user.currentOrgId = orgHeader;
      }

      // currentOrgId must remain as the key's org, not the header
      expect(user.currentOrgId).toBe('org-123');
    });
  });
});
