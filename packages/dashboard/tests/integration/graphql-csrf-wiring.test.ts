/**
 * Proves the /graphql CSRF guard is wired into the REAL createServer (the unit
 * test in tests/graphql/csrf-guard.test.ts proves the guard's logic on a
 * minimal server). The guard runs at onRequest, ahead of auth, so its refusal
 * message identifies it unambiguously.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createServer } from '../../src/server.js';
import { generateApiKey, storeApiKey } from '../../src/auth/api-key.js';

const GUARD_MESSAGE = 'cookie-authenticated GraphQL requests must use Content-Type application/json';

let app: FastifyInstance | undefined;
let dbPath = '';
afterAll(async () => { await app?.close(); });

async function boot(): Promise<FastifyInstance> {
  const root = mkdtempSync(join(tmpdir(), 'luqen-graphql-csrf-'));
  const config = {
    dbPath: (dbPath = join(root, 'dashboard.db')),
    reportsDir: join(root, 'reports'),
    sessionSecret: 'c'.repeat(32),
    catalogueUrl: '',
    catalogueCacheTtl: 0,
    redisUrl: '',
    maxConcurrentScans: 1,
  };
  const server = (await createServer(config as never)) as FastifyInstance;
  await server.ready();
  return server;
}

describe('createServer wires the /graphql CSRF guard', () => {
  it('refuses a form-encoded POST /graphql with the guard (csrf wiring)', async () => {
    app = await boot();
    const res = await app.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'query=mutation%7BdeleteScan(id%3A%22x%22)%7D',
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain(GUARD_MESSAGE);
  }, 120_000);

  it('refuses a form-encoded POST /graphql carrying a bogus Bearer token (csrf wiring)', async () => {
    app ??= await boot();
    const res = await app.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer bogus-token' },
      payload: 'query=mutation%7BdeleteScan(id%3A%22x%22)%7D',
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain(GUARD_MESSAGE);
  }, 120_000);

  it('lets a form-encoded POST through when its Bearer key really validates', async () => {
    app ??= await boot();
    const key = generateApiKey();
    const db = new Database(dbPath);
    try { storeApiKey(db, key, 'csrf-wiring-probe', 'admin'); } finally { db.close(); }
    const res = await app.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${key}` },
      payload: 'query=%7B__typename%7D',
    });
    expect(res.body).not.toContain(GUARD_MESSAGE);
  }, 120_000);

  it('does not apply the guard to an application/json POST /graphql', async () => {
    app ??= await boot();
    const res = await app.inject({
      method: 'POST', url: '/graphql',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ query: '{ __typename }' }),
    });
    expect(res.body).not.toContain(GUARD_MESSAGE);
  }, 120_000);
});
