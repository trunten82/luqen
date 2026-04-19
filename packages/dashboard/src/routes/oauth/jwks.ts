/**
 * JWKS endpoints — Phase 31.1 Plan 02 Task 1 (D-24 / D-25).
 *
 * Mounts identical handlers on:
 *   - GET /oauth/jwks.json
 *   - GET /.well-known/jwks.json
 *
 * The body shape follows RFC 7517 §4 — one JWK object per publishable key.
 * "Publishable" = `removed_at IS NULL` in `oauth_signing_keys` (i.e. either
 * currently active, or retired but still inside the 30-day overlap window so
 * tokens minted before retirement continue to validate).
 *
 * Response:
 *   {
 *     "keys": [
 *       { "kid": "...", "kty": "RSA", "alg": "RS256", "use": "sig",
 *         "n": "<base64url>", "e": "<base64url>" },
 *       ...
 *     ]
 *   }
 *
 * Caches publicly for 1h — services consuming the JWKS (@luqen/core verifier,
 * downstream RS's in Plan 03) rely on jose.createRemoteJWKSet's built-in
 * TTL handling. On a `kid` cache miss the verifier re-fetches; no push
 * invalidation is needed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createPublicKey } from 'node:crypto';
import type { StorageAdapter } from '../../db/adapter.js';

interface PublishedJwk {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly alg: 'RS256';
  readonly use: 'sig';
  readonly n: string;
  readonly e: string;
}

export async function registerJwksRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  async function handler(_req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const keys = await storage.oauthSigningKeys.listPublishableKeys();
    const jwks: { keys: readonly PublishedJwk[] } = {
      keys: keys.map((k): PublishedJwk => {
        const publicKeyObject = createPublicKey({ key: k.publicKeyPem, format: 'pem' });
        const jwk = publicKeyObject.export({ format: 'jwk' }) as { n?: string; e?: string };
        if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
          throw new Error(`Signing key ${k.kid} is not an RSA key — cannot publish in JWKS`);
        }
        return {
          kid: k.kid,
          kty: 'RSA',
          alg: 'RS256',
          use: 'sig',
          n: jwk.n,
          e: jwk.e,
        };
      }),
    };

    reply.header('Cache-Control', 'public, max-age=3600');
    reply.header('Content-Type', 'application/json');
    return reply.send(jwks);
  }

  server.get('/oauth/jwks.json', handler);
  server.get('/.well-known/jwks.json', handler);
}
