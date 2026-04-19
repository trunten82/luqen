/**
 * Phase 31.1 Plan 02 Task 1 — JWKS endpoint (Tests 6, 7, 8).
 *
 * D-24: JWKS endpoint at /oauth/jwks.json + /.well-known/jwks.json publishes
 * {kid, kty:'RSA', alg:'RS256', use:'sig', n, e} for each removed_at IS NULL key.
 * Cache-Control: public, max-age=3600.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { generateKeyPairSync, randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { setEncryptionSalt, encryptSecret } from '../../../src/plugins/crypto.js';
import { registerJwksRoutes } from '../../../src/routes/oauth/jwks.js';

const ENC_KEY = 'test-session-secret-at-least-32b';

let server: FastifyInstance;
let storage: SqliteStorageAdapter;
let dbPath: string;

async function buildServer(): Promise<FastifyInstance> {
  const s = Fastify({ logger: false });
  await registerJwksRoutes(s, storage);
  await s.ready();
  return s;
}

async function insertKey(storage: SqliteStorageAdapter, kid: string): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const encrypted = encryptSecret(privateKey, ENC_KEY);
  await storage.oauthSigningKeys.insertKey({
    kid,
    publicKeyPem: publicKey,
    encryptedPrivateKeyPem: encrypted,
  });
}

beforeEach(async () => {
  setEncryptionSalt('phase-31-1-plan-02-jwks-test-salt');
  dbPath = join(tmpdir(), `test-jwks-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  if (server) await server.close();
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('GET /oauth/jwks.json — Test 6 (empty key set)', () => {
  it('returns {keys: []} when no keys present', async () => {
    server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/oauth/jwks.json' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { keys: unknown[] };
    expect(body).toEqual({ keys: [] });
  });
});

describe('GET /oauth/jwks.json — Test 7 (active + retiring keys)', () => {
  it('returns JWK for each removed_at IS NULL key with RS256/RSA/sig shape + Cache-Control', async () => {
    const kid1 = `k_${randomBytes(8).toString('hex')}`;
    const kid2 = `k_${randomBytes(8).toString('hex')}`;
    await insertKey(storage, kid1);
    await insertKey(storage, kid2);
    // Retire one — still publishable (removed_at IS NULL).
    await storage.oauthSigningKeys.retireKey(kid2);

    server = await buildServer();
    const res = await server.inject({ method: 'GET', url: '/oauth/jwks.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');

    const body = res.json() as { keys: Array<Record<string, string>> };
    expect(body.keys.length).toBe(2);

    for (const jwk of body.keys) {
      expect(jwk.kty).toBe('RSA');
      expect(jwk.alg).toBe('RS256');
      expect(jwk.use).toBe('sig');
      expect(typeof jwk.kid).toBe('string');
      expect(typeof jwk.n).toBe('string');
      expect(typeof jwk.e).toBe('string');
    }

    const kids = body.keys.map((k) => k.kid).sort();
    expect(kids).toEqual([kid1, kid2].sort());
  });
});

describe('GET /.well-known/jwks.json — Test 8 (mirror route)', () => {
  it('returns the same body as /oauth/jwks.json', async () => {
    const kid = `k_${randomBytes(8).toString('hex')}`;
    await insertKey(storage, kid);

    server = await buildServer();
    const a = await server.inject({ method: 'GET', url: '/oauth/jwks.json' });
    const b = await server.inject({ method: 'GET', url: '/.well-known/jwks.json' });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers['cache-control']).toBe('public, max-age=3600');
  });
});
