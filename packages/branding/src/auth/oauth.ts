import {
  createRemoteJWKSet,
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

export interface TokenPayload {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly orgId?: string;
  readonly iat?: number;
  readonly exp?: number;
}

export interface SignTokenInput {
  readonly sub: string;
  readonly scopes: readonly string[];
  readonly expiresIn: string;
  readonly orgId?: string;
}

export type TokenSigner = (input: SignTokenInput) => Promise<string>;
export type TokenVerifier = (token: string) => Promise<TokenPayload>;

const BCRYPT_ROUNDS = 10;

export async function createTokenSigner(
  privateKeyPem: string,
): Promise<TokenSigner> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  return async (input: SignTokenInput): Promise<string> => {
    const claims: Record<string, unknown> = { scopes: input.scopes };
    if (input.orgId != null) claims.orgId = input.orgId;

    const jwt = new SignJWT(claims as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(input.sub)
      .setIssuedAt()
      .setExpirationTime(input.expiresIn);

    return jwt.sign(privateKey);
  };
}

export async function createTokenVerifier(
  publicKeyPem: string,
): Promise<TokenVerifier> {
  const publicKey = await importSPKI(publicKeyPem, 'RS256');

  return async (token: string): Promise<TokenPayload> => {
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
    });
    const raw = payload as Record<string, unknown>;
    return {
      sub: payload.sub!,
      scopes: raw.scopes as string[],
      ...(raw.orgId != null ? { orgId: raw.orgId as string } : {}),
      iat: payload.iat,
      exp: payload.exp,
    };
  };
}

/**
 * Phase 31.1 Plan 03 (D-33 / D-34): JWKS-backed RS256 verifier for the
 * branding MCP endpoint. Pulls signing keys from the dashboard AS
 * /oauth/jwks.json with built-in jose TTL caching and kid-miss refresh.
 * Enforces `aud` claim contains this service's MCP URL (RFC 8707) —
 * tokens minted for another service are rejected when presented here.
 *
 * Distinct from createTokenVerifier above:
 *   - createTokenVerifier validates local-signed tokens from this
 *     service's own /api/v1/oauth/token (D-10 preserved).
 *   - createJwksTokenVerifier validates dashboard-issued tokens for
 *     the external MCP endpoint (/api/v1/mcp).
 */
export async function createJwksTokenVerifier(
  jwksUri: string,
  expectedAudience: string,
): Promise<TokenVerifier> {
  if (jwksUri.trim().length === 0) {
    throw new Error('createJwksTokenVerifier: jwksUri is required');
  }
  if (expectedAudience.trim().length === 0) {
    throw new Error('createJwksTokenVerifier: expectedAudience is required');
  }
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  return async (token: string): Promise<TokenPayload> => {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      audience: expectedAudience,
    });
    const raw = payload as Record<string, unknown>;
    return {
      sub: payload.sub!,
      scopes: (raw.scopes as string[]) ?? [],
      ...(raw.orgId != null ? { orgId: raw.orgId as string } : {}),
      iat: payload.iat,
      exp: payload.exp,
    };
  };
}

export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, BCRYPT_ROUNDS);
}

export async function verifyClientSecret(
  secret: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

export function generateClientCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = randomBytes(16).toString('hex');
  const clientSecret = randomBytes(32).toString('hex');
  return { clientId, clientSecret };
}
