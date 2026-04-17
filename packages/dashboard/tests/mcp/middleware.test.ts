import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createMcpAuthPreHandler,
  type McpTokenPayload,
  type McpTokenVerifier,
} from '../../src/mcp/middleware.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockReply(): {
  reply: FastifyReply;
  getStatus: () => number | null;
  getBody: () => unknown;
} {
  let status: number | null = null;
  let body: unknown = null;
  const send = vi.fn(async (b: unknown) => {
    body = b;
  });
  const reply = {
    status: vi.fn((s: number) => {
      status = s;
      return { send } as unknown as FastifyReply;
    }),
  } as unknown as FastifyReply;
  return {
    reply,
    getStatus: () => status,
    getBody: () => body,
  };
}

function makeMockRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeStubStorage(perms: readonly string[] = []) {
  return {
    roles: {
      getEffectivePermissions: vi.fn(async (_userId: string, _orgId?: string): Promise<Set<string>> => {
        return new Set(perms);
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// createMcpAuthPreHandler
// ---------------------------------------------------------------------------

describe('createMcpAuthPreHandler', () => {
  it('Test 1: returns 401 when Authorization header is missing', async () => {
    const verify: McpTokenVerifier = vi.fn();
    const storage = makeStubStorage();
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    const request = makeMockRequest({ headers: {} });
    const { reply, getStatus, getBody } = makeMockReply();

    await handler(request, reply);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'Bearer token required', statusCode: 401 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('Test 2: returns 401 when Authorization header is Basic (not Bearer)', async () => {
    const verify: McpTokenVerifier = vi.fn();
    const storage = makeStubStorage();
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    const request = makeMockRequest({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    const { reply, getStatus, getBody } = makeMockReply();

    await handler(request, reply);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'Bearer token required', statusCode: 401 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('Test 3: returns 401 when verifyToken rejects', async () => {
    const verify: McpTokenVerifier = vi.fn(async () => {
      throw new Error('bad signature');
    });
    const storage = makeStubStorage();
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    const request = makeMockRequest({
      headers: { authorization: 'Bearer bad' },
    });
    const { reply, getStatus, getBody } = makeMockReply();

    await handler(request, reply);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'Invalid or expired token', statusCode: 401 });
    expect(verify).toHaveBeenCalledWith('bad');
  });

  it('Test 4: valid Bearer populates tokenPayload / authType / orgId / permissions', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-1',
      scopes: ['read'],
      orgId: 'org-1',
      role: 'member',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const storage = makeStubStorage(['reports.view']);
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    const request = makeMockRequest({
      headers: { authorization: 'Bearer good-token' },
    });
    const { reply } = makeMockReply();

    await handler(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    const r = request as unknown as {
      tokenPayload?: McpTokenPayload;
      authType?: string;
      orgId?: string;
      permissions?: Set<string>;
    };
    expect(r.tokenPayload).toEqual(payload);
    expect(r.authType).toBe('jwt');
    expect(r.orgId).toBe('org-1');
    expect(r.permissions).toBeInstanceOf(Set);
    expect(r.permissions!.has('reports.view')).toBe(true);
    expect(storage.roles.getEffectivePermissions).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('Test 5: session cookies are ignored — tokenPayload wins, authType=jwt', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-2',
      scopes: ['read'],
      orgId: 'org-2',
      role: 'member',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const storage = makeStubStorage([]);
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    // Simulate a request that ALSO has a cookie session in place (user already logged in).
    // The middleware MUST ignore session and use Bearer only (PITFALLS.md #9).
    const request = makeMockRequest({
      headers: {
        authorization: 'Bearer valid',
        cookie: 'session=valid-session-cookie',
      },
      session: { get: vi.fn(() => 'org-session') },
      user: { id: 'cookie-user', role: 'admin' },
    });
    const { reply } = makeMockReply();

    await handler(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    const r = request as unknown as { authType?: string; tokenPayload?: McpTokenPayload };
    expect(r.authType).toBe('jwt');
    expect(r.tokenPayload).toEqual(payload);
  });

  it('Test 6: payload.role === "admin" returns full ALL_PERMISSION_IDS set', async () => {
    const payload: McpTokenPayload = {
      sub: 'admin-user',
      scopes: ['admin'],
      orgId: 'org-x',
      role: 'admin',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    // Stub roles repo returns an empty set — the admin shortcut in
    // resolveEffectivePermissions should bypass this and return ALL permissions.
    const storage = makeStubStorage([]);
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage });
    const request = makeMockRequest({
      headers: { authorization: 'Bearer admin-token' },
    });
    const { reply } = makeMockReply();

    await handler(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    const r = request as unknown as { permissions?: Set<string> };
    expect(r.permissions).toBeInstanceOf(Set);
    expect(r.permissions!.size).toBe(ALL_PERMISSION_IDS.length);
    for (const id of ALL_PERMISSION_IDS) {
      expect(r.permissions!.has(id)).toBe(true);
    }
    // Admin shortcut bypasses the roles repository entirely.
    expect(storage.roles.getEffectivePermissions).not.toHaveBeenCalled();
  });
});
