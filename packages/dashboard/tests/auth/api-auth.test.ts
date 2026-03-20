import { describe, it, expect, vi } from 'vitest';
import { authGuard } from '../../src/auth/middleware.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

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

function makeMockRequest(
  overrides: { sessionData?: Record<string, unknown>; url?: string } = {},
): FastifyRequest {
  const { sessionData = {}, url = '/reports', ...rest } = overrides;
  return {
    url,
    session: {
      ...sessionData,
      delete: vi.fn(),
    },
    headers: {},
    ...rest,
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

  // Use a proxy so state reads are always current
  const state: MockReplyState = {
    get redirectUrl() { return internal.redirectUrl; },
    get statusCode() { return internal.statusCode; },
    get body() { return internal.body; },
  };

  return { reply, state };
}

describe('authGuard – API requests return JSON 401', () => {
  it('returns 401 JSON when API request has no session token', async () => {
    const request = makeMockRequest({ url: '/api/v1/plugins', sessionData: {} });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Authentication required' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('returns 401 JSON when API request has expired token', async () => {
    const token = makeToken({ sub: 'user1', exp: pastExp(), role: 'user' });
    const request = makeMockRequest({ url: '/api/v1/plugins', sessionData: { token } });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Token expired' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('returns 401 JSON with "Invalid token" when token is decodable but has no sub', async () => {
    // Token decodes fine but has no sub claim, so extractUserFromToken returns null
    const token = makeToken({ exp: futureExp(), role: 'user' });
    const request = makeMockRequest({ url: '/api/v1/plugins', sessionData: { token } });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Invalid token' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });

  it('returns 401 JSON with "Token expired" when API request has malformed token', async () => {
    // Malformed tokens fail decodeJwt, which makes isTokenExpired return true
    const request = makeMockRequest({ url: '/api/v1/plugins', sessionData: { token: 'not.a.jwt' } });
    const { reply, state } = makeMockReply();

    await authGuard(request, reply);

    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: 'Token expired' });
    expect(reply.redirect).not.toHaveBeenCalled();
  });
});

describe('authGuard – non-API requests still redirect', () => {
  it('redirects to /login when non-API request has no session', async () => {
    const request = makeMockRequest({ url: '/reports', sessionData: {} });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when non-API request has expired token', async () => {
    const token = makeToken({ sub: 'user1', exp: pastExp(), role: 'user' });
    const request = makeMockRequest({ url: '/reports', sessionData: { token } });
    const { reply } = makeMockReply();

    await authGuard(request, reply);

    expect(reply.redirect).toHaveBeenCalledWith('/login');
  });
});
