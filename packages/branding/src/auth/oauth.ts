import {
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
