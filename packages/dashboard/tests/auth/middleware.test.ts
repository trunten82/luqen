import { describe, it, expect, vi } from 'vitest';
import { createAuthGuard, adminGuard, requireRole, requirePermission } from '../../src/auth/middleware.js';
import type { AuthService } from '../../src/auth/auth-service.js';
import type { AuthResult } from '../../src/plugins/types.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAuthService(result: AuthResult): AuthService {
  return {
    authenticateRequest: vi.fn().mockResolvedValue(result),
  } as unknown as AuthService;
}

function makeMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    url: '/dashboard',
    headers: {},
    session: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeMockReply(): { reply: FastifyReply; getRedirected: () => string | null; getStatus: () => number | null; getBody: () => unknown } {
  let redirected: string | null = null;
  let status: number | null = null;
  let body: unknown = null;

  const reply = {
    redirect: vi.fn(async (url: string) => {
      redirected = url;
    }),
    code: vi.fn((code: number) => {
      status = code;
      return {
        send: vi.fn((b: unknown) => {
          body = b;
        }),
      };
    }),
  } as unknown as FastifyReply;

  return {
    reply,
    getRedirected: () => redirected,
    getStatus: () => status,
    getBody: () => body,
  };
}

// ---------------------------------------------------------------------------
// createAuthGuard
// ---------------------------------------------------------------------------

describe('createAuthGuard', () => {
  it('redirects to /login when not authenticated (page request)', async () => {
    const service = mockAuthService({ authenticated: false });
    const guard = createAuthGuard(service);
    const request = makeMockRequest();
    const { reply } = makeMockReply();

    await guard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });

  it('returns 401 JSON when not authenticated (API request)', async () => {
    const service = mockAuthService({ authenticated: false, error: 'Token expired' });
    const guard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/scans' });
    const { reply } = makeMockReply();

    await guard(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('returns 401 with default message when no error provided', async () => {
    const service = mockAuthService({ authenticated: false });
    const guard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/scans' });
    const { reply, getBody } = makeMockReply();

    await guard(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(getBody()).toEqual({ error: 'Authentication required' });
  });

  it('attaches user to request when authenticated', async () => {
    const service = mockAuthService({
      authenticated: true,
      user: { id: 'user1', username: 'alice', role: 'admin' },
    });
    const guard = createAuthGuard(service);
    const request = makeMockRequest();
    const { reply } = makeMockReply();

    await guard(request, reply);

    expect(reply.redirect).not.toHaveBeenCalled();
    expect(request.user).toEqual({ id: 'user1', username: 'alice', role: 'admin' });
  });

  it('defaults role to viewer when AuthResult user has no role', async () => {
    const service = mockAuthService({
      authenticated: true,
      user: { id: 'user1', username: 'alice' },
    });
    const guard = createAuthGuard(service);
    const request = makeMockRequest();
    const { reply } = makeMockReply();

    await guard(request, reply);

    expect(request.user?.role).toBe('viewer');
  });

  it('delegates to authService.authenticateRequest', async () => {
    const service = mockAuthService({ authenticated: false });
    const guard = createAuthGuard(service);
    const request = makeMockRequest();
    const { reply } = makeMockReply();

    await guard(request, reply);

    expect(service.authenticateRequest).toHaveBeenCalledWith(request);
  });
});

// ---------------------------------------------------------------------------
// adminGuard
// ---------------------------------------------------------------------------

describe('adminGuard', () => {
  it('returns 403 when user is not admin', () => {
    const request = { user: { id: '1', username: 'alice', role: 'user' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    adminGuard(request, reply);

    expect(codeFn).toHaveBeenCalledWith(403);
  });

  it('does not call reply.code when user is admin', () => {
    const request = { user: { id: '1', username: 'admin', role: 'admin' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    adminGuard(request, reply);

    expect(codeFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  it('allows access when user meets role requirement', () => {
    const guard = requireRole('user');
    const request = { user: { id: '1', username: 'alice', role: 'user' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    guard(request, reply);

    expect(codeFn).not.toHaveBeenCalled();
  });

  it('allows admin to access user-required routes', () => {
    const guard = requireRole('user');
    const request = { user: { id: '1', username: 'admin', role: 'admin' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    guard(request, reply);

    expect(codeFn).not.toHaveBeenCalled();
  });

  it('returns 403 when viewer tries to access user-required route', () => {
    const guard = requireRole('user');
    const request = { user: { id: '1', username: 'viewer', role: 'viewer' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    guard(request, reply);

    expect(codeFn).toHaveBeenCalledWith(403);
  });

  it('returns 403 when user tries to access admin-required route', () => {
    const guard = requireRole('admin');
    const request = { user: { id: '1', username: 'alice', role: 'user' } } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    guard(request, reply);

    expect(codeFn).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// requirePermission
// ---------------------------------------------------------------------------

describe('requirePermission', () => {
  it('returns 403 when user has no matching permissions', async () => {
    const guard = requirePermission('users.create');
    const request = { permissions: new Set(['reports.view', 'scans.create']) } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    await guard(request, reply);

    expect(codeFn).toHaveBeenCalledWith(403);
  });

  it('passes when user has at least one matching permission (OR logic)', async () => {
    const guard = requirePermission('users.create', 'users.delete');
    const request = { permissions: new Set(['users.delete', 'reports.view']) } as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    await guard(request, reply);

    expect(codeFn).not.toHaveBeenCalled();
  });

  it('handles undefined permissions set gracefully', async () => {
    const guard = requirePermission('users.create');
    const request = {} as unknown as FastifyRequest;
    const codeFn = vi.fn(() => ({ send: vi.fn() }));
    const reply = { code: codeFn } as unknown as FastifyReply;

    await guard(request, reply);

    expect(codeFn).toHaveBeenCalledWith(403);
  });
});
