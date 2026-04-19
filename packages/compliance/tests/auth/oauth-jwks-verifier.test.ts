/**
 * Phase 31.1 Plan 03 Task 2: Compliance service JWKS-backed RS256 verifier.
 *
 * Mirrors the dashboard's Plan 03 Task 1 test harness but wires the shape
 * the compliance service needs — returns TokenPayload (no `role` field by
 * default; the service-side TokenPayload schema drops that field per
 * existing oauth.ts convention). Audience enforcement is identical.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';
import { createJwksTokenVerifier } from '../../src/auth/oauth.js';

interface TestKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

async function makeTestKey(kid: string): Promise<TestKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { kid, privateKey, jwk };
}

function startJwksServer(keys: readonly JWK[]): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ keys }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/jwks.json`,
        close: (): Promise<void> =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function sign(
  key: TestKey,
  audience: string | readonly string[],
  claims: Record<string, unknown> = {},
  alg = 'RS256',
): Promise<string> {
  return new SignJWT({ scopes: ['read'], orgId: 'org-1', ...claims })
    .setProtectedHeader({ alg, kid: key.kid })
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience as string | string[])
    .sign(key.privateKey);
}

describe('createJwksTokenVerifier — compliance (Phase 31.1 Plan 03)', () => {
  const EXPECTED_AUD = 'https://compliance.test/api/v1/mcp';
  const WRONG_AUD = 'https://branding.test/api/v1/mcp';
  let currentKey: TestKey;
  let throwAwayKey: TestKey;
  let jwks: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    currentKey = await makeTestKey('kid-compliance-1');
    throwAwayKey = await makeTestKey('kid-throwaway-compliance');
    jwks = await startJwksServer([currentKey.jwk]);
  });

  afterAll(async () => {
    await jwks.close();
  });

  it('Test 1: accepts a token with aud matching the expected compliance MCP URL', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, EXPECTED_AUD);
    const token = await sign(
      currentKey,
      [EXPECTED_AUD],
      { scopes: ['read', 'write'], orgId: 'org-42' },
    );
    const payload = await verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.scopes).toEqual(['read', 'write']);
    expect(payload.orgId).toBe('org-42');
  });

  it('Test 2: rejects a token whose aud is a different service URL (cross-service replay defense)', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, EXPECTED_AUD);
    const token = await sign(currentKey, [WRONG_AUD]);
    await expect(verify(token)).rejects.toThrow();
  });

  it('Test 3: rejects an HS256-signed token (algorithm-confusion defense)', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, EXPECTED_AUD);
    const hsToken = await new SignJWT({ scopes: ['admin'], aud: [EXPECTED_AUD] })
      .setProtectedHeader({ alg: 'HS256', kid: currentKey.kid })
      .setSubject('user-attacker')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-shared-secret-at-least-32bytes-long'));
    await expect(verify(hsToken)).rejects.toThrow();
  });

  it('Test 4: rejects a token whose kid is not in the published JWKS set', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, EXPECTED_AUD);
    const token = await sign(throwAwayKey, [EXPECTED_AUD]);
    await expect(verify(token)).rejects.toThrow();
  });

  it('Test 5: accepts a token with aud as a single string (not array) that matches', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, EXPECTED_AUD);
    // jose's setAudience with a single string keeps the claim as a string
    // (not an array) — covers RFC 8707's relaxed shape.
    const token = await sign(currentKey, EXPECTED_AUD);
    const payload = await verify(token);
    expect(payload.sub).toBe('user-1');
  });

  it('Test 6: throws a clear Error when jwksUri is empty', async () => {
    await expect(createJwksTokenVerifier('', EXPECTED_AUD)).rejects.toThrow(/jwksUri/);
  });

  it('Test 7: throws a clear Error when expectedAudience is empty', async () => {
    await expect(createJwksTokenVerifier(jwks.url, '')).rejects.toThrow(/expectedAudience/);
  });
});
