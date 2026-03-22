import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { UserDb } from '../../src/db/users.js';
import { setupRoutes } from '../../src/routes/api/setup.js';
import type { AuthService } from '../../src/auth/auth-service.js';

const VALID_API_KEY = 'test-valid-api-key-1234567890';

interface TestContext {
  server: FastifyInstance;
  db: ScanDb;
  userDb: UserDb;
  cleanup: () => void;
}

function mockAuthService(validKey: string): AuthService {
  return {
    validateApiKey: vi.fn((key: string) => key === validKey),
  } as unknown as AuthService;
}

async function createTestServer(): Promise<TestContext> {
  const dbPath = join(tmpdir(), `test-setup-${randomUUID()}.db`);

  const db = new ScanDb(dbPath);
  db.initialize();
  const userDb = new UserDb(db.getDatabase());

  const server = Fastify({ logger: false });

  await server.register(import('@fastify/formbody'));

  const authService = mockAuthService(VALID_API_KEY);
  await setupRoutes(server, userDb, authService);
  await server.ready();

  const cleanup = (): void => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
    void server.close();
  };

  return { server, db, userDb, cleanup };
}

// ── POST /api/v1/setup ──────────────────────────────────────────────────────

describe('POST /api/v1/setup', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('creates user with valid API key', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'alice', password: 'secret1234', role: 'admin' }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { message: string; user: { id: string; username: string; role: string } };
    expect(body.user.username).toBe('alice');
    expect(body.user.role).toBe('admin');

    const created = ctx.userDb.getUserByUsername('alice');
    expect(created).not.toBeNull();
    expect(created!.role).toBe('admin');
  });

  it('returns 401 without API key', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'alice', password: 'secret1234' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: string };
    expect(body.error).toContain('API key required');
  });

  it('returns 401 with invalid API key', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: 'Bearer wrong-api-key',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'alice', password: 'secret1234' }),
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: string };
    expect(body.error).toContain('Invalid API key');
  });

  it('returns 400 for missing username', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ password: 'secret1234' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('username');
  });

  it('returns 400 for missing password', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'alice' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('password');
  });

  it('returns 400 for short password', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'alice', password: 'short' }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toContain('at least 8 characters');
  });

  it('returns 409 for duplicate username', async () => {
    await ctx.userDb.createUser('alice', 'password123', 'admin');

    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'alice', password: 'newpassword1' }),
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: string };
    expect(body.error).toContain('already exists');
  });

  it('defaults role to admin when not specified', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        authorization: `Bearer ${VALID_API_KEY}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'bob', password: 'secret1234' }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { user: { role: string } };
    expect(body.user.role).toBe('admin');

    const created = ctx.userDb.getUserByUsername('bob');
    expect(created!.role).toBe('admin');
  });

  it('accepts X-API-Key header', async () => {
    const response = await ctx.server.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: {
        'x-api-key': VALID_API_KEY,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ username: 'carol', password: 'secret1234' }),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { user: { username: string } };
    expect(body.user.username).toBe('carol');
  });
});
