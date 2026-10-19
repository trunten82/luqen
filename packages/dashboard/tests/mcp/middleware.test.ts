import { describe, it, expect, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createMcpAuthPreHandler,
  type McpTokenPayload,
  type McpTokenVerifier,
} from '../../src/mcp/middleware.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import { storedCallerOrgs, storedCallerUsers } from '../helpers/stored-caller-stub.js';

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
  const headers: Record<string, string> = {};
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
  };
}

function makeMockRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeStubStorage(
  perms: readonly string[] = [],
  oauthClientRow: { readonly revokedAt: Date | string | null } | null = null,
  users: { getUserById(id: string): Promise<unknown> } = storedCallerUsers('user'),
) {
  return {
    users: users as ReturnType<typeof storedCallerUsers>,
    roles: {
      getEffectivePermissions: vi.fn(async (_userId: string, _orgId?: string): Promise<Set<string>> => {
        return new Set(perms);
      }),
    },
    oauthClients: {
      findByClientId: vi.fn(async (_clientId: string) => oauthClientRow),
    },
    // The token's subject belongs to the token organizations used in this file.
    organizations: storedCallerOrgs('org-1', 'org-2', 'org-x', 'org-8'),
  };
}

// ---------------------------------------------------------------------------
// createMcpAuthPreHandler
// ---------------------------------------------------------------------------

describe('createMcpAuthPreHandler', () => {
  it('Test 1: returns 401 when Authorization header is missing', async () => {
    const verify: McpTokenVerifier = vi.fn();
    const storage = makeStubStorage();
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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
    const storage = makeStubStorage(['reports.view']);
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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

  it('Test 6: a stored global admin resolves the full ALL_PERMISSION_IDS set whatever the token claims', async () => {
    const payload: McpTokenPayload = {
      sub: 'admin-user',
      scopes: ['read', 'write'],
      orgId: 'org-x',
      role: 'viewer', // the claim names another role; the STORED role decides
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    // The roles repository answers nothing: only the stored global role 'admin' yields every permission.
    const storage = makeStubStorage([], null, storedCallerUsers('admin'));
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
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
    // The stored admin role resolves every permission without the roles repository.
    expect(storage.roles.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('Test 7: a token whose subject is not a stored user is refused with 401', async () => {
    const payload: McpTokenPayload = {
      sub: 'oauth-client-abc',
      scopes: ['read'],
      orgId: 'org-1',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const storage = makeStubStorage(['reports.view'], null, { getUserById: vi.fn(async () => null) });
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
    const request = makeMockRequest({
      headers: { authorization: 'Bearer oauth-read-token' },
    });
    const { reply, getStatus, getBody } = makeMockReply();

    await handler(request, reply);

    expect(getStatus()).toBe(401);
    expect(getBody()).toEqual({ error: 'Invalid or expired token', statusCode: 401 });
    expect(reply.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://test/.well-known/oauth-protected-resource", error="invalid_token", error_description="unknown_user"',
    );
    const r = request as unknown as { permissions?: Set<string>; tokenPayload?: McpTokenPayload };
    expect(r.permissions).toBeUndefined();
    expect(r.tokenPayload).toBeUndefined();
  });

  it('Test 8: a stored user with an empty permission set is refused with 403', async () => {
    const payload: McpTokenPayload = {
      sub: 'user-8',
      scopes: ['read', 'write'],
      orgId: 'org-8',
    };
    const verify: McpTokenVerifier = vi.fn(async () => payload);
    const storage = makeStubStorage([], null, storedCallerUsers('user'));
    const handler = createMcpAuthPreHandler({ verifyToken: verify, storage, resourceMetadataUrl: 'https://test/.well-known/oauth-protected-resource' });
    const request = makeMockRequest({
      headers: { authorization: 'Bearer no-permission-token' },
    });
    const { reply, getStatus, getBody } = makeMockReply();

    await handler(request, reply);

    expect(getStatus()).toBe(403);
    expect(getBody()).toEqual({ error: 'No permission in this organization', statusCode: 403 });
    expect(reply.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://test/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="no_permission"',
    );
    const r = request as unknown as { permissions?: Set<string>; tokenPayload?: McpTokenPayload };
    expect(r.permissions).toBeUndefined();
    expect(r.tokenPayload).toBeUndefined();
  });
});
