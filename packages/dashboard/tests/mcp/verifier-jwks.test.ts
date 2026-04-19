/**
 * Phase 31.1 Plan 03 Task 1: Dashboard RS256 verifier swap from static-PEM
 * to JWKS-backed key lookup + audience enforcement + legacy PEM deprecation path.
 *
 * Test harness: a tiny in-process HTTP server serves a JWKS document built
 * from two test RSA keypairs (current + rotation-alternate). Tokens are
 * minted via `jose.SignJWT` with the matching private key and a matching
 * `kid` header so the verifier can route to the right public key.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  SignJWT,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type JWK,
} from 'jose';
import { createDashboardJwtVerifier } from '../../src/mcp/verifier.js';

interface TestKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
  readonly publicPem: string;
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
  const publicPem = await exportSPKI(publicKey);
  return { kid, privateKey, jwk, publicPem };
}

interface JwksServer {
  readonly url: string;
  readonly setKeys: (keys: readonly JWK[]) => void;
  readonly close: () => Promise<void>;
}

function startJwksServer(initialKeys: readonly JWK[]): Promise<JwksServer> {
  let keys: readonly JWK[] = initialKeys;
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      // Return a fresh response (Cache-Control intentionally disabled so the
      // test suite observes key-rotation semantics without jose's built-in
      // 5-minute TTL masking the change). jose.createRemoteJWKSet still
      // keyspots by kid miss, so this is safe.
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ keys }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/jwks.json`,
        setKeys: (newKeys): void => {
          keys = newKeys;
        },
        close: (): Promise<void> =>
          new Promise((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function signToken(
  key: TestKey,
  claims: Record<string, unknown>,
  audience: string | readonly string[],
  algOverride: string = 'RS256',
): Promise<string> {
  const jwt = new SignJWT({ scopes: ['read'], orgId: 'org-1', ...claims })
    .setProtectedHeader({ alg: algOverride, kid: key.kid })
    .setSubject('user-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience as string | string[]);
  return jwt.sign(key.privateKey);
}

describe('createDashboardJwtVerifier — JWKS + audience (Phase 31.1 Plan 03)', () => {
  const EXPECTED_AUD = 'https://dashboard.test/mcp';
  let currentKey: TestKey;
  let rotationKey: TestKey;
  let throwAwayKey: TestKey;
  let jwksServer: JwksServer;

  beforeAll(async () => {
    currentKey = await makeTestKey('kid-current');
    rotationKey = await makeTestKey('kid-rotation');
    throwAwayKey = await makeTestKey('kid-throwaway');
    jwksServer = await startJwksServer([currentKey.jwk]);
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  it('Test 1: accepts a valid RS256 token with matching aud and kid from JWKS', async () => {
    const verify = await createDashboardJwtVerifier({
      jwksUri: jwksServer.url,
      expectedAudience: EXPECTED_AUD,
    });
    const token = await signToken(
      currentKey,
      { scopes: ['read', 'write'], orgId: 'org-42', role: 'member' },
      EXPECTED_AUD,
    );
    const payload = await verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.scopes).toEqual(['read', 'write']);
    expect(payload.orgId).toBe('org-42');
    expect(payload.role).toBe('member');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('Test 2: rejects a token whose aud does not include expectedAudience', async () => {
    const verify = await createDashboardJwtVerifier({
      jwksUri: jwksServer.url,
      expectedAudience: EXPECTED_AUD,
    });
    const token = await signToken(currentKey, {}, 'https://compliance.test/api/v1/mcp');
    await expect(verify(token)).rejects.toThrow();
  });

  it('Test 3: rejects a token whose alg is not RS256 (algorithm confusion)', async () => {
    const verify = await createDashboardJwtVerifier({
      jwksUri: jwksServer.url,
      expectedAudience: EXPECTED_AUD,
    });
    // HS256 token cannot be minted with jose.SignJWT + CryptoKey,
    // so build manually: header + payload + HMAC signature with shared secret.
    const hsToken = await new SignJWT({
      scopes: ['admin'],
      aud: [EXPECTED_AUD],
    })
      .setProtectedHeader({ alg: 'HS256', kid: currentKey.kid })
      .setSubject('user-attacker')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-shared-secret-at-least-32bytes-long'));
    await expect(verify(hsToken)).rejects.toThrow();
  });

  it('Test 4: rejects a token whose kid is not in the JWKS set', async () => {
    const verify = await createDashboardJwtVerifier({
      jwksUri: jwksServer.url,
      expectedAudience: EXPECTED_AUD,
    });
    const token = await signToken(throwAwayKey, {}, EXPECTED_AUD);
    await expect(verify(token)).rejects.toThrow();
  });

  it('Test 5: after key rotation (retiring + new), tokens on both kids still verify (overlap window)', async () => {
    // Snapshot: both keys publishable (current + rotation). A fresh verifier
    // is constructed AFTER the JWKS is updated so we don't hit a stale
    // jose cache; in production, jose's RemoteJWKSet auto-refreshes on kid
    // miss, which this scenario simulates.
    jwksServer.setKeys([currentKey.jwk, rotationKey.jwk]);
    const verify = await createDashboardJwtVerifier({
      jwksUri: jwksServer.url,
      expectedAudience: EXPECTED_AUD,
    });
    const tokenOnCurrent = await signToken(currentKey, {}, EXPECTED_AUD);
    const tokenOnRotation = await signToken(rotationKey, {}, EXPECTED_AUD);
    await expect(verify(tokenOnCurrent)).resolves.toBeDefined();
    await expect(verify(tokenOnRotation)).resolves.toBeDefined();
  });

  it('Test 6: throws a clear Error when constructed with neither jwksUri nor legacyPem', async () => {
    await expect(
      createDashboardJwtVerifier({ expectedAudience: EXPECTED_AUD }),
    ).rejects.toThrow(/DASHBOARD_JWKS_URI.*DASHBOARD_JWT_PUBLIC_KEY/);
  });

  it('Test 7: legacyPem path emits console.warn containing "DASHBOARD_JWT_PUBLIC_KEY is deprecated" and verifies PEM-signed tokens (also enforces aud)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    });
    try {
      const verify = await createDashboardJwtVerifier({
        expectedAudience: EXPECTED_AUD,
        legacyPem: currentKey.publicPem,
      });
      // The deprecation warning uses a module-scoped "warned once" flag —
      // the spy should at least see it among console.warn calls from any
      // prior construction. Assert the message was emitted at least once.
      const warnedMessages = warnSpy.mock.calls.flat().map((c) => String(c));
      expect(warnedMessages.some((m) => m.includes('DASHBOARD_JWT_PUBLIC_KEY is deprecated'))).toBe(true);

      // PEM path still accepts matching aud
      const validToken = await signToken(currentKey, {}, EXPECTED_AUD);
      const payload = await verify(validToken);
      expect(payload.sub).toBe('user-1');

      // PEM path ALSO rejects mismatched aud (legacy path must enforce aud
      // per the plan's critical invariant — both branches check audience).
      const wrongAudToken = await signToken(
        currentKey,
        {},
        'https://some-other-service/mcp',
      );
      await expect(verify(wrongAudToken)).rejects.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
