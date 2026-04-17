/**
 * createDashboardJwtVerifier — constructs the dashboard MCP endpoint's
 * RS256 JWT verifier.
 *
 * COMMITTED DECISION (Phase 28): dashboard MCP accepts ONLY RS256-signed
 * JWTs verified against DASHBOARD_JWT_PUBLIC_KEY (PEM public key).
 * No HS256, no unsigned tokens (alg:none), no shared-secret fallback.
 *
 * The dashboard currently uses `decodeJwt` (unsigned decode) only during
 * the OAuth login flow in routes/auth.ts — that is NOT sufficient for
 * MCP and is NOT reused here. The MCP endpoint uses real signature
 * verification via jose.jwtVerify with an RS256-only algorithm allowlist.
 */

import { importSPKI, jwtVerify } from 'jose';
import type { McpTokenPayload, McpTokenVerifier } from './middleware.js';

export async function createDashboardJwtVerifier(pem: string): Promise<McpTokenVerifier> {
  if (pem.trim().length === 0) {
    throw new Error(
      'DASHBOARD_JWT_PUBLIC_KEY is required to enable dashboard MCP (RS256). ' +
        'Set it to a PEM-encoded RSA public key ' +
        '(format "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----").',
    );
  }
  const key = await importSPKI(pem, 'RS256');
  return async function verify(token: string): Promise<McpTokenPayload> {
    const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] });
    if (typeof payload.sub !== 'string') {
      throw new Error('Invalid token: missing sub claim');
    }
    const rawScopes = (payload as unknown as { scopes?: unknown }).scopes;
    const scopes = Array.isArray(rawScopes)
      ? (rawScopes as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const rawOrgId = (payload as unknown as { orgId?: unknown }).orgId;
    const rawRole = (payload as unknown as { role?: unknown }).role;
    return {
      sub: payload.sub,
      scopes,
      orgId: typeof rawOrgId === 'string' ? rawOrgId : undefined,
      role: typeof rawRole === 'string' ? rawRole : undefined,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };
  };
}
