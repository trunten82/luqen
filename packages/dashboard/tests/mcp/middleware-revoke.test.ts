import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createMcpAuthPreHandler,
  type McpTokenPayload,
  type McpTokenVerifier,
} from '../../src/mcp/middleware.js';

// Phase 31.2 Plan 04 Task 2 step 3 — D-20 bullet 3 middleware revoked-client check.
// Covers Tests H (reject revoked), I (allow active), J (back-compat for pre-31.2
// tokens that lack the client_id claim).

function makeMockReply(): {
  reply: FastifyReply;
  getStatus: () => number | null;
  getBody: () => unknown;
  getHeaders: () => Record<string, string>;
} {
  let status: number | null = null;
  let body: unknown = null;
  const headers: Record<string, string> = {};
  const send = vi.fn(async (b: unknown) => {
    body = b;
  });
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers[name] = value;
      return reply;
    }),
    status: vi.fn((s: number) => {
      status = s;
      return { send } as unknown as FastifyReply;
    }),
  } as unknown as FastifyReply & { header: (n: string, v: string) => FastifyReply };
  return {
    reply,
    getStatus: () => status,
    getBody: () => body,
    getHeaders: () => headers,
  };
}

function makeMockRequest(): FastifyRequest {
  return {
    headers: { authorization: 'Bearer fake.jwt.token' },
  } as unknown as FastifyRequest;
}

function makeStorage(
  oauthClientRow: { readonly revokedAt: Date | string | null } | null,
) {
  const findByClientId = vi.fn(async (_id: string) => oauthClientRow);
  return {
    storage: {
      roles: {
        getEffectivePermissions: vi.fn(async (): Promise<Set<string>> => new Set()),
      },
      oauthClients: { findByClientId },
    },
    findByClientId,
  };
}

describe('createMcpAuthPreHandler — D-20 bullet 3 revoked-client check', () => {
  const RESOURCE_URL = 'https://dash/.well-known/oauth-protected-resource';

  it('Test H: rejects with 401 + WWW-Authenticate error_description=client_revoked when owning client is revoked', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-1',
      scopes: ['read'],
      client_id: 'c1',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const { storage } = makeStorage({ revokedAt: new Date() });

    const handler = createMcpAuthPreHandler({
      verifyToken: verify,
      storage,
      resourceMetadataUrl: RESOURCE_URL,
    });
    const { reply, getStatus, getBody, getHeaders } = makeMockReply();

    await handler(makeMockRequest(), reply);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'Client revoked', statusCode: 401 });
    const www = getHeaders()['WWW-Authenticate'];
    expect(www).toContain('error="invalid_token"');
    expect(www).toContain('error_description="client_revoked"');
  });

  it('Test I: passes through when owning client is NOT revoked', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-1',
      scopes: ['read'],
      client_id: 'c1',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const { storage, findByClientId } = makeStorage({ revokedAt: null });

    const handler = createMcpAuthPreHandler({
      verifyToken: verify,
      storage,
      resourceMetadataUrl: RESOURCE_URL,
    });
    const { reply, getStatus } = makeMockReply();

    await handler(makeMockRequest(), reply);

    expect(getStatus()).toBeNull();
    expect(findByClientId).toHaveBeenCalledWith('c1');
  });

  it('Test J: back-compat — pre-31.2 token (no client_id claim) passes without calling findByClientId', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-1',
      scopes: ['read'],
      // No client_id — silent-skip the revoke check per D-13 posture.
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const { storage, findByClientId } = makeStorage({ revokedAt: new Date() });

    const handler = createMcpAuthPreHandler({
      verifyToken: verify,
      storage,
      resourceMetadataUrl: RESOURCE_URL,
    });
    const { reply, getStatus } = makeMockReply();

    await handler(makeMockRequest(), reply);

    expect(getStatus()).toBeNull();
    expect(findByClientId).not.toHaveBeenCalled();
  });

  it('Test K: does NOT reject when findByClientId returns null (client row not found — treat as back-compat/stale)', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-1',
      scopes: ['read'],
      client_id: 'c-missing',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const { storage } = makeStorage(null);

    const handler = createMcpAuthPreHandler({
      verifyToken: verify,
      storage,
      resourceMetadataUrl: RESOURCE_URL,
    });
    const { reply, getStatus } = makeMockReply();

    await handler(makeMockRequest(), reply);

    expect(getStatus()).toBeNull();
  });
});
