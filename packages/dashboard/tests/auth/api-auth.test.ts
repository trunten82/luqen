import { describe, it, expect, vi } from 'vitest';
import { createAuthGuard } from '../../src/auth/middleware.js';
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

function makeMockRequest(
  overrides: { url?: string } = {},
): FastifyRequest {
  const { url = '/reports' } = overrides;
  return {
    url,
    headers: {},
    session: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as FastifyRequest;
}

interface MockReplyState {
  readonly redirectUrl: string | null;
  readonly statusCode: number | null;
  readonly body: unknown;
}

function makeMockReply(): { reply: FastifyReply; state: MockReplyState } {
  const internal = { redirectUrl: null as string | null, statusCode: null as number | null, body: null as unknown };

  const reply = {
    redirect: vi.fn(async (url: string) => {
      internal.redirectUrl = url;
    }),
    code: vi.fn((code: number) => {
      internal.statusCode = code;
      return {
        send: vi.fn((b: unknown) => {
          internal.body = b;
        }),
      };
    }),
  } as unknown as FastifyReply;

  const state: MockReplyState = {
    get redirectUrl() { return internal.redirectUrl; },
    get statusCode() { return internal.statusCode; },
    get body() { return internal.body; },
  };

  return { reply, state };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authGuard – API requests return JSON 401', () => {
  it('returns 401 JSON when API request is not authenticated', async () => {
    const service = mockAuthService({ authenticated: false });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/v1/plugins' });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Authentication required' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('returns 401 JSON with custom error message from AuthService', async () => {
    const service = mockAuthService({ authenticated: false, error: 'Token expired' });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/v1/plugins' });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Token expired' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('returns 401 with default message when no error provided', async () => {
    const service = mockAuthService({ authenticated: false });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/scans' });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Authentication required' });
  });

  it('attaches user when API request is authenticated', async () => {
    const service = mockAuthService({
      authenticated: true,
      user: { id: 'user1', username: 'alice', role: 'admin' },
    });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/api/v1/plugins' });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
    expect(request.user).toEqual({ id: 'user1', username: 'alice', role: 'admin' });
  });
});

describe('authGuard – non-API requests still redirect', () => {
  it('redirects to /login when non-API request is not authenticated', async () => {
    const service = mockAuthService({ authenticated: false });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/reports' });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });

  it('does not redirect when non-API request is authenticated', async () => {
    const service = mockAuthService({
      authenticated: true,
      user: { id: 'user1', username: 'alice', role: 'user' },
    });
    const authGuard = createAuthGuard(service);
    const request = makeMockRequest({ url: '/reports' });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).not.toHaveBeenCalled();
    expect(request.user).toEqual({ id: 'user1', username: 'alice', role: 'user' });
  });
});
