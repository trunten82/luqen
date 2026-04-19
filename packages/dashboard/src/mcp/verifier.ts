/**
 * createDashboardJwtVerifier — RS256 verifier for dashboard MCP endpoint.
 *
 * Phase 31.1 Plan 03 (MCPAUTH-01 / MCPAUTH-02): swapped from a single static
 * PEM (DASHBOARD_JWT_PUBLIC_KEY env var) to JWKS-backed key lookup via the
 * dashboard's own /oauth/jwks.json. The verifier looks up the signing key
 * by `kid` header, supporting seamless key rotation (D-25 overlap window).
 *
 * The `expectedAudience` parameter enforces RFC 8707 audience binding —
 * tokens minted for another service (e.g. compliance) are rejected when
 * presented to the dashboard MCP endpoint.
 *
 * Legacy support: `legacyPem` is accepted with a deprecation warning so
 * existing deployments mid-upgrade keep working. The legacy path ALSO
 * enforces `aud` — the audience invariant holds on both code paths.
 *
 * COMMITTED DECISION (Phase 28 + 31.1): dashboard MCP accepts ONLY RS256-signed
 * JWTs. No HS256, no unsigned tokens (alg:none), no shared-secret fallback.
 */

import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { McpTokenPayload, McpTokenVerifier } from './middleware.js';

export interface DashboardJwtVerifierOptions {
  readonly jwksUri?: string;
  readonly expectedAudience: string;
  readonly legacyPem?: string;
}

let deprecationWarned = false;

export async function createDashboardJwtVerifier(
  opts: DashboardJwtVerifierOptions,
): Promise<McpTokenVerifier> {
  const hasJwks = opts.jwksUri != null && opts.jwksUri.trim().length > 0;
  const hasLegacyPem =
    opts.legacyPem != null && opts.legacyPem.trim().length > 0;

  if (!hasJwks && !hasLegacyPem) {
    throw new Error(
      'Dashboard MCP verifier requires either DASHBOARD_JWKS_URI (preferred) or DASHBOARD_JWT_PUBLIC_KEY (deprecated).',
    );
  }

  if (hasJwks) {
    const jwks = createRemoteJWKSet(new URL(opts.jwksUri!));
    return async function verifyJwks(token: string): Promise<McpTokenPayload> {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['RS256'],
        audience: opts.expectedAudience,
      });
      return extractPayload(payload);
    };
  }

  // Legacy path — emit deprecation notice once per process lifetime.
  if (!deprecationWarned) {
    // eslint-disable-next-line no-console
    console.warn(
      '[31.1] DASHBOARD_JWT_PUBLIC_KEY is deprecated; set DASHBOARD_JWKS_URI to fetch keys from the dashboard AS /oauth/jwks.json with built-in TTL caching.',
    );
    deprecationWarned = true;
  }
  const key = await importSPKI(opts.legacyPem!, 'RS256');
  return async function verifyPem(token: string): Promise<McpTokenPayload> {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      audience: opts.expectedAudience,
    });
    return extractPayload(payload);
  };
}

function extractPayload(payload: Record<string, unknown>): McpTokenPayload {
  if (typeof payload['sub'] !== 'string') {
    throw new Error('Invalid token: missing sub claim');
  }
  const rawScopes = payload['scopes'];
  const scopes = Array.isArray(rawScopes)
    ? (rawScopes as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const rawOrgId = payload['orgId'];
  const rawRole = payload['role'];
  return {
    sub: payload['sub'],
    scopes,
    orgId: typeof rawOrgId === 'string' ? rawOrgId : undefined,
    role: typeof rawRole === 'string' ? rawRole : undefined,
    iat: typeof payload['iat'] === 'number' ? payload['iat'] : undefined,
    exp: typeof payload['exp'] === 'number' ? payload['exp'] : undefined,
  };
}
