import { describe, it, expect } from 'vitest';
import { SignJWT, generateKeyPair, exportSPKI } from 'jose';
import { createDashboardJwtVerifier } from '../../src/mcp/verifier.js';

// ---------------------------------------------------------------------------
// Helpers — generate RSA keypair once per suite for signing test tokens
// ---------------------------------------------------------------------------

async function makeKeypair(): Promise<{
  publicKeyPem: string;
  privateKey: CryptoKey;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const publicKeyPem = await exportSPKI(publicKey);
  return { publicKeyPem, privateKey };
}

async function signRs256(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  overrides: { sub?: string } = {},
): Promise<string> {
  const jwt = new SignJWT({ scopes: ['read'], orgId: 'org-1', role: 'member', ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(overrides.sub ?? 'user-1')
    .setIssuedAt();
  return jwt.sign(privateKey);
}

// ---------------------------------------------------------------------------
// createDashboardJwtVerifier
// ---------------------------------------------------------------------------

describe('createDashboardJwtVerifier', () => {
  it('Test 1: throws when PEM is empty — DASHBOARD_JWT_PUBLIC_KEY message mentioned', async () => {
    await expect(createDashboardJwtVerifier('')).rejects.toThrow(/DASHBOARD_JWT_PUBLIC_KEY/);
    await expect(createDashboardJwtVerifier('   ')).rejects.toThrow(/DASHBOARD_JWT_PUBLIC_KEY/);
  });

  it('Test 2: valid RS256-signed token returns payload with sub, scopes, orgId, role', async () => {
    const { publicKeyPem, privateKey } = await makeKeypair();
    const verify = await createDashboardJwtVerifier(publicKeyPem);
    const token = await signRs256(privateKey, {
      scopes: ['read', 'write'],
      orgId: 'org-42',
      role: 'member',
    });
    const payload = await verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.scopes).toEqual(['read', 'write']);
    expect(payload.orgId).toBe('org-42');
    expect(payload.role).toBe('member');
    expect(typeof payload.iat).toBe('number');
  });

  it('Test 3: HS256-signed token is rejected (algorithm confusion)', async () => {
    const { publicKeyPem } = await makeKeypair();
    const verify = await createDashboardJwtVerifier(publicKeyPem);
    const hsToken = await new SignJWT({ scopes: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-hs')
      .sign(new TextEncoder().encode('some-shared-secret-at-least-32bytes-long'));
    await expect(verify(hsToken)).rejects.toThrow();
  });

  it('Test 4: unsigned token (alg:none style) is rejected', async () => {
    const { publicKeyPem } = await makeKeypair();
    const verify = await createDashboardJwtVerifier(publicKeyPem);
    // Build a token with alg: none — two base64url segments + empty signature.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'user-attacker', scopes: ['admin'] })).toString(
      'base64url',
    );
    const unsignedToken = `${header}.${body}.`;
    await expect(verify(unsignedToken)).rejects.toThrow();
  });

  it('Test 5: token signed by a different RSA key is rejected', async () => {
    const { publicKeyPem } = await makeKeypair();
    const { privateKey: attackerPrivateKey } = await makeKeypair();
    const verify = await createDashboardJwtVerifier(publicKeyPem);
    const token = await signRs256(attackerPrivateKey, { scopes: ['admin'] });
    await expect(verify(token)).rejects.toThrow();
  });
});
