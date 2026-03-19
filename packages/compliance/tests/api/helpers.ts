import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';

export interface TestContext {
  app: FastifyInstance;
  adminToken: string;
  readToken: string;
  writeToken: string;
  clientId: string;
}

export async function createTestApp(): Promise<TestContext> {
  // Generate RSA key pair for tests
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const privateKeyPem = await exportPKCS8(privateKey);
  const publicKeyPem = await exportSPKI(publicKey);

  // Create in-memory SQLite adapter
  const db = new SqliteAdapter(':memory:');

  const signToken = await createTokenSigner(privateKeyPem);
  const verifyToken = await createTokenVerifier(publicKeyPem);

  // Create server (DB is initialized inside createServer)
  const app = await createServer({
    db,
    signToken,
    verifyToken,
    tokenExpiry: '1h',
    corsOrigins: ['*'],
    logger: false,
  });

  // Create an admin OAuth client
  const adminClient = await db.createClient({
    name: 'test-admin',
    scopes: ['read', 'write', 'admin'],
    grantTypes: ['client_credentials'],
  });

  const readClient = await db.createClient({
    name: 'test-read',
    scopes: ['read'],
    grantTypes: ['client_credentials'],
  });

  const writeClient = await db.createClient({
    name: 'test-write',
    scopes: ['read', 'write'],
    grantTypes: ['client_credentials'],
  });

  // Sign tokens directly for testing
  const adminToken = await signToken({
    sub: adminClient.id,
    scopes: ['read', 'write', 'admin'],
    expiresIn: '1h',
  });

  const readToken = await signToken({
    sub: readClient.id,
    scopes: ['read'],
    expiresIn: '1h',
  });

  const writeToken = await signToken({
    sub: writeClient.id,
    scopes: ['read', 'write'],
    expiresIn: '1h',
  });

  await app.ready();

  return {
    app,
    adminToken,
    readToken,
    writeToken,
    clientId: adminClient.id,
  };
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
