import { describe, it, expect, vi } from 'vitest';
import { authGuard, adminGuard, requireRole } from '../../src/auth/middleware.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Helper to create a JWT-like token with given payload
// We use base64url encoding to create a fake JWT (not cryptographically valid,
// but suitable for decodeJwt which only decodes without verification)
function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function pastExp(): number {
  return Math.floor(Date.now() / 1000) - 3600;
}

function makeMockRequest(overrides: Partial<FastifyRequest> & { sessionData?: Record<string, unknown> } = {}): FastifyRequest {
  const { sessionData = {}, ...rest } = overrides;
  return {
    session: {
      ...sessionData,
      delete: vi.fn(),
    },
    headers: {},
    ...rest,
  } as unknown as FastifyRequest;
}

function makeMockReply(): { reply: FastifyReply; redirected: string | null; status: number | null } {
  const state: { redirected: string | null; status: number | null; body: unknown } = {
    redirected: null,
    status: null,
    body: null,
  };

  const reply = {
    redirect: vi.fn(async (url: string) => {
      state.redirected = url;
    }),
    code: vi.fn((code: number) => {
      state.status = code;
      return {
        send: vi.fn((body: unknown) => {
          state.body = body;
        }),
      };
    }),
  } as unknown as FastifyReply;

  return { reply, redirected: state.redirected, status: state.status };
}

describe('authGuard', () => {
  it('redirects to /login when no token in session', async () => {
    const request = makeMockRequest({ sessionData: {} });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when token is expired', async () => {
    const token = makeToken({ sub: 'user1', exp: pastExp(), role: 'user' });
    const request = makeMockRequest({ sessionData: { token } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });

  it('attaches user to request when token is valid', async () => {
    const token = makeToken({ sub: 'user1', exp: futureExp(), role: 'user', username: 'alice' });
    const request = makeMockRequest({ sessionData: { token } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).not.toHaveBeenCalled();
    expect(request.user).toEqual({ id: 'user1', username: 'alice', role: 'user' });
  });

  it('uses sub as username when username claim is absent', async () => {
    const token = makeToken({ sub: 'user42', exp: futureExp(), role: 'admin' });
    const request = makeMockRequest({ sessionData: { token } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(request.user?.username).toBe('user42');
    expect(request.user?.role).toBe('admin');
  });

  it('defaults role to viewer when role claim missing', async () => {
    const token = makeToken({ sub: 'user1', exp: futureExp() });
    const request = makeMockRequest({ sessionData: { token } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(request.user?.role).toBe('viewer');
  });

  it('redirects to /login when token is malformed', async () => {
    const request = makeMockRequest({ sessionData: { token: 'not.a.jwt' } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });
});

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
