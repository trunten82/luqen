import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

const TEST_DB = '/tmp/llm-health-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('GET /api/v1/health', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    cleanup();
    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });

    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it('returns 200 with status ok, version, and timestamp', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ status: string; version: string; timestamp: string }>();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.timestamp).toBeDefined();
    // Verify timestamp is a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
  });
});
