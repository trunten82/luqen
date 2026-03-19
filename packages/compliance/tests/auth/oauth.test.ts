import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8 } from 'jose';
import {
  createTokenSigner,
  createTokenVerifier,
  hashPassword,
  verifyPassword,
  hashClientSecret,
  verifyClientSecret,
  generateClientCredentials,
  type TokenPayload,
} from '../../src/auth/oauth.js';

describe('OAuth token signing and verification', () => {
  let privateKeyPem: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    privateKeyPem = await exportPKCS8(privateKey);
    publicKeyPem = await exportSPKI(publicKey);
  });

  it('signs and verifies a token with valid claims', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read', 'write'],
      expiresIn: '1h',
    });

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const payload = await verify(token);
    expect(payload.sub).toBe('client-123');
    expect(payload.scopes).toEqual(['read', 'write']);
  });

  it('rejects an expired token', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read'],
      expiresIn: '0s',
    });

    // Wait a moment for expiry
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const sign = await createTokenSigner(privateKeyPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await sign({
      sub: 'client-123',
      scopes: ['read'],
      expiresIn: '1h',
    });

    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verify(tampered)).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const otherPem = await exportPKCS8(otherKey);

    const signOther = await createTokenSigner(otherPem);
    const verify = await createTokenVerifier(publicKeyPem);

    const token = await signOther({
      sub: 'hacker',
      scopes: ['admin'],
      expiresIn: '1h',
    });

    await expect(verify(token)).rejects.toThrow();
  });
});

describe('Password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('super-secret');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('super-secret');

    const valid = await verifyPassword('super-secret', hash);
    expect(valid).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });
});

describe('Client secret hashing', () => {
  it('hashes and verifies a client secret', async () => {
    const hash = await hashClientSecret('my-client-secret');
    expect(typeof hash).toBe('string');

    const valid = await verifyClientSecret('my-client-secret', hash);
    expect(valid).toBe(true);
  });

  it('returns false for wrong client secret', async () => {
    const hash = await hashClientSecret('real-secret');
    const valid = await verifyClientSecret('fake-secret', hash);
    expect(valid).toBe(false);
  });
});

describe('Client credentials generation', () => {
  it('generates clientId and clientSecret as non-empty strings', () => {
    const { clientId, clientSecret } = generateClientCredentials();
    expect(typeof clientId).toBe('string');
    expect(clientId.length).toBeGreaterThan(0);
    expect(typeof clientSecret).toBe('string');
    expect(clientSecret.length).toBeGreaterThan(0);
  });

  it('generates unique credentials each time', () => {
    const first = generateClientCredentials();
    const second = generateClientCredentials();
    expect(first.clientId).not.toBe(second.clientId);
    expect(first.clientSecret).not.toBe(second.clientSecret);
  });
});
