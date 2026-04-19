/**
 * Phase 31.1 Plan 03 Task 3 — Cross-audience integration test (D-04 proof).
 *
 * Defense-in-depth demonstration: a token minted with aud=compliance's
 * MCP URL is accepted by compliance's JWKS verifier and REJECTED when the
 * SAME verifier factory is instantiated with a different expectedAudience
 * (the branding or llm URL). This exercises the exact production path —
 * services call createJwksTokenVerifier at bootstrap (server.ts) with
 * their own *_PUBLIC_URL+/api/v1/mcp as expectedAudience.
 *
 * The branding and llm packages publish the SAME factory (byte-identical
 * implementation by design, confirmed by the per-service tests in Task 2).
 * Verifying via the compliance factory with three different
 * expectedAudience values is equivalent to running against all three
 * service factories — the audience matching logic lives inside jose's
 * jwtVerify, which is identical across the three package factories.
 *
 * Test matrix:
 *   - Single-audience token (aud=[compliance]) → compliance verifier OK,
 *     branding-sim verifier REJECTS, llm-sim verifier REJECTS
 *   - Multi-audience token (aud=[compliance, branding, llm]) → all three
 *     accept (D-05 multi-service token bundle)
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
    const srv: Server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ keys }));
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/jwks.json`,
        close: (): Promise<void> =>
          new Promise((r) => {
            srv.close(() => r());
          }),
      });
    });
  });
}

async function signDashboardToken(
  key: TestKey,
  audience: readonly string[],
  claims: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({ scopes: ['read'], orgId: 'org-int', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid })
    .setSubject('user-integration')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience(audience as string[])
    .sign(key.privateKey);
}

describe('Cross-service audience enforcement (D-04 defense-in-depth)', () => {
  const COMPLIANCE_AUD = 'https://compliance.test/api/v1/mcp';
  const BRANDING_AUD = 'https://branding.test/api/v1/mcp';
  const LLM_AUD = 'https://llm.test/api/v1/mcp';

  let dashboardKey: TestKey;
  let jwks: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    dashboardKey = await makeTestKey('kid-dashboard-cross');
    jwks = await startJwksServer([dashboardKey.jwk]);
  });

  afterAll(async () => {
    await jwks.close();
  });

  it('compliance verifier accepts a token minted for compliance', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, COMPLIANCE_AUD);
    const token = await signDashboardToken(dashboardKey, [COMPLIANCE_AUD]);
    const payload = await verify(token);
    expect(payload.sub).toBe('user-integration');
    expect(payload.scopes).toContain('read');
  });

  it('branding-shaped verifier rejects the same token (aud=compliance, not branding)', async () => {
    // Same factory, different expectedAudience — simulates branding's
    // server.ts bootstrap path because branding/compliance/llm all export
    // byte-identical createJwksTokenVerifier implementations.
    const verify = await createJwksTokenVerifier(jwks.url, BRANDING_AUD);
    const token = await signDashboardToken(dashboardKey, [COMPLIANCE_AUD]);
    await expect(verify(token)).rejects.toThrow();
  });

  it('llm-shaped verifier rejects the same token (aud=compliance, not llm)', async () => {
    const verify = await createJwksTokenVerifier(jwks.url, LLM_AUD);
    const token = await signDashboardToken(dashboardKey, [COMPLIANCE_AUD]);
    await expect(verify(token)).rejects.toThrow();
  });

  it('multi-audience token covers all three services (D-05)', async () => {
    const complianceV = await createJwksTokenVerifier(jwks.url, COMPLIANCE_AUD);
    const brandingV = await createJwksTokenVerifier(jwks.url, BRANDING_AUD);
    const llmV = await createJwksTokenVerifier(jwks.url, LLM_AUD);
    const token = await signDashboardToken(dashboardKey, [
      COMPLIANCE_AUD,
      BRANDING_AUD,
      LLM_AUD,
    ]);
    await expect(complianceV(token)).resolves.toBeDefined();
    await expect(brandingV(token)).resolves.toBeDefined();
    await expect(llmV(token)).resolves.toBeDefined();
  });
});
