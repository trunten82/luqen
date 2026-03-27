import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSessionExpired, getSessionExpiryMs, createSessionExpiryHook } from '../../src/auth/session.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('Session Expiry', () => {
  const originalEnv = process.env['SESSION_EXPIRY_MINUTES'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['SESSION_EXPIRY_MINUTES'] = originalEnv;
    } else {
      delete process.env['SESSION_EXPIRY_MINUTES'];
    }
  });

  describe('getSessionExpiryMs', () => {
    it('defaults to 60 minutes (3600000ms)', () => {
      delete process.env['SESSION_EXPIRY_MINUTES'];
      expect(getSessionExpiryMs()).toBe(60 * 60 * 1000);
    });

    it('reads SESSION_EXPIRY_MINUTES from env', () => {
      process.env['SESSION_EXPIRY_MINUTES'] = '30';
      expect(getSessionExpiryMs()).toBe(30 * 60 * 1000);
    });

    it('ignores invalid env values and falls back to default', () => {
      process.env['SESSION_EXPIRY_MINUTES'] = 'invalid';
      expect(getSessionExpiryMs()).toBe(60 * 60 * 1000);
    });

    it('ignores zero value and falls back to default', () => {
      process.env['SESSION_EXPIRY_MINUTES'] = '0';
      expect(getSessionExpiryMs()).toBe(60 * 60 * 1000);
    });

    it('ignores negative value and falls back to default', () => {
      process.env['SESSION_EXPIRY_MINUTES'] = '-10';
      expect(getSessionExpiryMs()).toBe(60 * 60 * 1000);
    });
  });

  describe('isSessionExpired', () => {
    it('returns false when session is undefined', () => {
      expect(isSessionExpired(undefined, 3600000)).toBe(false);
    });

    it('returns false when no lastActivity is set (legacy session)', () => {
      const session = { get: vi.fn().mockReturnValue(undefined) };
      expect(isSessionExpired(session, 3600000)).toBe(false);
    });

    it('returns false when session is within expiry window', () => {
      const recentTime = Date.now() - 1000; // 1 second ago
      const session = { get: vi.fn().mockReturnValue(recentTime) };
      expect(isSessionExpired(session, 3600000)).toBe(false);
    });

    it('returns true when session exceeds expiry window', () => {
      const oldTime = Date.now() - 7200000; // 2 hours ago
      const session = { get: vi.fn().mockReturnValue(oldTime) };
      expect(isSessionExpired(session, 3600000)).toBe(true);
    });

    it('returns true at exact boundary', () => {
      const exactBoundary = Date.now() - 3600001; // 1ms past expiry
      const session = { get: vi.fn().mockReturnValue(exactBoundary) };
      expect(isSessionExpired(session, 3600000)).toBe(true);
    });
  });

  describe('createSessionExpiryHook', () => {
    function mockSession(data: Record<string, unknown> = {}) {
      const store = { ...data };
      return {
        get: vi.fn((key: string) => store[key]),
        set: vi.fn((key: string, value: unknown) => { store[key] = value; }),
        regenerate: vi.fn(() => {
          for (const key of Object.keys(store)) delete store[key];
        }),
      };
    }

    function mockRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
      return {
        session: mockSession(),
        url: '/dashboard',
        ...overrides,
      } as unknown as FastifyRequest;
    }

    function mockReply(): FastifyReply & { redirectUrl?: string; sentCode?: number; sentBody?: unknown } {
      const reply = {
        redirectUrl: undefined as string | undefined,
        sentCode: undefined as number | undefined,
        sentBody: undefined as unknown,
        redirect(url: string) {
          reply.redirectUrl = url;
          return reply;
        },
        code(c: number) {
          reply.sentCode = c;
          return reply;
        },
        send(body: unknown) {
          reply.sentBody = body;
          return reply;
        },
      };
      return reply as unknown as FastifyReply & { redirectUrl?: string; sentCode?: number; sentBody?: unknown };
    }

    it('updates lastActivity on non-expired session', async () => {
      const session = mockSession({ userId: 'user-1', lastActivity: Date.now() });
      const req = { session, url: '/dashboard' } as unknown as FastifyRequest;
      const reply = mockReply();

      const hook = createSessionExpiryHook(3600000);
      await hook(req, reply);

      expect(session.set).toHaveBeenCalledWith('lastActivity', expect.any(Number));
      expect(reply.redirectUrl).toBeUndefined();
    });

    it('redirects to login with expired=1 for expired browser session', async () => {
      const session = mockSession({ userId: 'user-1', lastActivity: Date.now() - 7200000 });
      const req = { session, url: '/dashboard' } as unknown as FastifyRequest;
      const reply = mockReply();

      const hook = createSessionExpiryHook(3600000);
      await hook(req, reply);

      expect(reply.redirectUrl).toBe('/login?expired=1');
      expect(session.regenerate).toHaveBeenCalled();
    });

    it('returns 401 for expired API session', async () => {
      const session = mockSession({ userId: 'user-1', lastActivity: Date.now() - 7200000 });
      const req = { session, url: '/api/v1/scans' } as unknown as FastifyRequest;
      const reply = mockReply();

      const hook = createSessionExpiryHook(3600000);
      await hook(req, reply);

      expect(reply.sentCode).toBe(401);
    });

    it('skips check for unauthenticated sessions', async () => {
      const session = mockSession({});
      const req = { session, url: '/login' } as unknown as FastifyRequest;
      const reply = mockReply();

      const hook = createSessionExpiryHook(3600000);
      await hook(req, reply);

      expect(reply.redirectUrl).toBeUndefined();
      expect(reply.sentCode).toBeUndefined();
    });

    it('does not expire sessions without lastActivity (legacy)', async () => {
      const session = mockSession({ userId: 'user-1' });
      const req = { session, url: '/dashboard' } as unknown as FastifyRequest;
      const reply = mockReply();

      const hook = createSessionExpiryHook(3600000);
      await hook(req, reply);

      expect(reply.redirectUrl).toBeUndefined();
      // Should set lastActivity for future checks
      expect(session.set).toHaveBeenCalledWith('lastActivity', expect.any(Number));
    });
  });
});
