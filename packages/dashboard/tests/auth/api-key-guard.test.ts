import { describe, it, expect, vi } from 'vitest';
import { enforceApiKeyRole } from '../../src/auth/api-key-guard.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

function mockRequest(overrides: {
  user?: { id: string; username: string; role: string };
  method?: string;
  url?: string;
}): FastifyRequest {
  return {
    user: overrides.user,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/api/v1/scans',
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply & { sentCode?: number; sentBody?: unknown } {
  const reply = {
    sentCode: undefined as number | undefined,
    sentBody: undefined as unknown,
    code(c: number) {
      reply.sentCode = c;
      return reply;
    },
    send(body: unknown) {
      reply.sentBody = body;
      return reply;
    },
  };
  return reply as unknown as FastifyReply & { sentCode?: number; sentBody?: unknown };
}

describe('enforceApiKeyRole', () => {
  it('allows admin keys full access', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'admin' }, method: 'POST', url: '/api/v1/setup' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });

  it('allows non-api-key users through', async () => {
    const req = mockRequest({ user: { id: 'user-123', username: 'testuser', role: 'read-only' }, method: 'POST', url: '/api/v1/scans' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });

  it('blocks read-only key from POST requests', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'read-only' }, method: 'POST', url: '/api/v1/scans' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBe(403);
  });

  it('allows read-only key GET requests', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'read-only' }, method: 'GET', url: '/api/v1/scans' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });

  it('allows scan-only key GET requests', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'scan-only' }, method: 'GET', url: '/api/v1/data/scans' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });

  it('allows scan-only key POST to scan endpoints', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'scan-only' }, method: 'POST', url: '/api/v1/scan' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });

  it('blocks scan-only key POST to non-scan endpoints', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'scan-only' }, method: 'POST', url: '/api/v1/users' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBe(403);
  });

  it('blocks scan-only key DELETE requests', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'scan-only' }, method: 'DELETE', url: '/api/v1/scans/123' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBe(403);
  });

  it('does not enforce on non-API routes', async () => {
    const req = mockRequest({ user: { id: 'api-key', username: 'api-key', role: 'read-only' }, method: 'POST', url: '/admin/settings' });
    const reply = mockReply();
    await enforceApiKeyRole(req, reply);
    expect(reply.sentCode).toBeUndefined();
  });
});
