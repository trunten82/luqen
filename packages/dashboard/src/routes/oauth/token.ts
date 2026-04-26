/**
 * OAuth 2.1 /oauth/token endpoint — Phase 31.1 Plan 02 Task 2.
 *
 * Supports two grants (Phase 31.2 D-15 retired client_credentials):
 *   - authorization_code: PKCE S256 verified + single-use code consumption
 *     + RS256 JWT mint + refresh rotation chain root insertion.
 *   - refresh_token:      rotate-on-use with reuse-detection revocation
 *     (D-29 / T-31.1-02-07). Returns a fresh access_token + fresh refresh_token.
 *     A cross-client refresh is blocked (parent.clientId must match the
 *     presented client).
 *
 * Phase 31.2 D-15: client_credentials removed — dashboard /oauth/token is now
 * exclusively for user flows. Service-to-service bootstrap continues via
 * per-service /api/v1/oauth/token on compliance/branding/llm (31.1 D-10
 * invariant preserved). Requests carrying grant_type=client_credentials
 * receive 400 unsupported_grant_type (OAuth 2.1 §5.2).
 *
 * Phase 31.2 D-20 bullet 3: every minted access token carries a `client_id`
 * claim so the MCP middleware's verifier can reject tokens whose owning
 * client has been revoked.
 *
 * Client authentication:
 *   token_endpoint_auth_method='none' (public)        — no secret; PKCE proof.
 *   token_endpoint_auth_method='client_secret_basic'  — HTTP Basic OR
 *                                                       client_secret body param.
 *
 * Any public client presenting a client_secret → 400 invalid_client
 * (T-31.1-02-10 / OAuth 2.1 §4.2 hygiene).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { createHash, randomBytes } from 'node:crypto';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';
import type { StorageAdapter } from '../../db/adapter.js';
import type { OauthClient } from '../../db/interfaces/oauth-client-repository.js';
import { verifyS256Challenge } from '../../auth/oauth-pkce.js';
import type { DashboardSigner } from '../../auth/oauth-signer.js';

// POST /oauth/token request body (RFC 6749 §3.2 / §4.1.3 / §6).
// Form-encoded inputs are unioned into one body schema; the handler branches
// on grant_type. additionalProperties:true keeps room for client extensions.
const TokenBodySchema = Type.Object(
  {
    grant_type: Type.Optional(Type.String()),
    client_id: Type.Optional(Type.String()),
    client_secret: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    code_verifier: Type.Optional(Type.String()),
    redirect_uri: Type.Optional(Type.String()),
    refresh_token: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    resource: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// RFC 6749 §5.1 access-token success response. refresh_token / scope are
// emitted by handleAuthCode + handleRefresh; id_token is left optional for
// future OIDC parity. additionalProperties:true matches the existing
// dashboard convention (D-05).
const TokenResponseSchema = Type.Object(
  {
    access_token: Type.String(),
    token_type: Type.String(),
    expires_in: Type.Number(),
    refresh_token: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    id_token: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

interface TokenBody {
  readonly grant_type?: string;
  readonly client_id?: string;
  readonly client_secret?: string;
  // authorization_code
  readonly code?: string;
  readonly code_verifier?: string;
  readonly redirect_uri?: string;
  // refresh_token
  readonly refresh_token?: string;
  // client_credentials
  readonly scope?: string;
  readonly resource?: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function extractClientCredentials(
  request: FastifyRequest,
  body: TokenBody,
): { clientId: string | undefined; clientSecret: string | undefined } {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon !== -1) {
      return {
        clientId: decoded.slice(0, colon),
        clientSecret: decoded.slice(colon + 1),
      };
    }
  }
  return {
    clientId: typeof body.client_id === 'string' ? body.client_id : undefined,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
  };
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function splitSpace(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) return [];
  return value.split(/\s+/).filter((s) => s.length > 0);
}

export async function registerTokenRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  signer: DashboardSigner,
): Promise<void> {
  server.post('/oauth/token', {
    schema: {
      tags: ['oauth'],
      body: TokenBodySchema,
      response: {
        200: TokenResponseSchema,
        400: ErrorEnvelope,
        401: ErrorEnvelope,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as TokenBody;

    // 1. Resolve client credentials (Basic or body).
    const { clientId, clientSecret } = extractClientCredentials(request, body);
    if (clientId === undefined) {
      return reply.status(400).send({ error: 'invalid_client' });
    }
    const client = await storage.oauthClients.findByClientId(clientId);
    if (client === null || client.revokedAt !== null) {
      return reply.status(400).send({ error: 'invalid_client' });
    }

    // 2. Verify client-auth method.
    if (client.tokenEndpointAuthMethod === 'client_secret_basic') {
      if (
        clientSecret === undefined ||
        !(await storage.oauthClients.verifyClientSecret(client.clientId, clientSecret))
      ) {
        return reply.status(400).send({ error: 'invalid_client' });
      }
    } else {
      // public client — must NOT present a secret.
      if (clientSecret !== undefined && clientSecret.length > 0) {
        return reply.status(400).send({ error: 'invalid_client' });
      }
    }

    // 3. Branch on grant_type. Phase 31.2 D-15: client_credentials retired —
    // any grant other than authorization_code / refresh_token hits the default
    // arm and returns 400 unsupported_grant_type per OAuth 2.1 §5.2.
    switch (body.grant_type) {
      case 'authorization_code':
        return handleAuthCode(storage, signer, client, body, reply);
      case 'refresh_token':
        return handleRefresh(storage, signer, client, body, reply);
      default:
        return reply.status(400).send({ error: 'unsupported_grant_type' });
    }
  });
}

// ── grant_type=authorization_code ──────────────────────────────────────────

async function handleAuthCode(
  storage: StorageAdapter,
  signer: DashboardSigner,
  client: OauthClient,
  body: TokenBody,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (body.code === undefined || body.code_verifier === undefined || body.redirect_uri === undefined) {
    return reply.status(400).send({ error: 'invalid_request' });
  }

  const row = await storage.oauthCodes.findAndConsume(body.code);
  if (row === null) return reply.status(400).send({ error: 'invalid_grant' });
  if (row.clientId !== client.clientId) return reply.status(400).send({ error: 'invalid_grant' });
  if (row.redirectUri !== body.redirect_uri) return reply.status(400).send({ error: 'invalid_grant' });
  if (!verifyS256Challenge(body.code_verifier, row.codeChallenge)) {
    return reply.status(400).send({ error: 'invalid_grant' });
  }

  const scopes = splitSpace(row.scope);
  const resources = splitSpace(row.resource);

  const accessToken = await signer.mintAccessToken({
    sub: row.userId,
    scopes,
    orgId: row.orgId,
    aud: resources,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    // Phase 31.2 D-20 bullet 3: thread clientId so the MCP middleware can
    // run a post-JWT revoked-client check. Row.clientId is the client that
    // the authorization code was bound to at /oauth/authorize/consent time.
    clientId: row.clientId,
  });

  // Mint root of a new refresh-rotation chain.
  const rawRefresh = randomBytes(32).toString('base64url');
  await storage.oauthRefresh.mint({
    tokenHash: hashToken(rawRefresh),
    clientId: client.clientId,
    userId: row.userId,
    orgId: row.orgId,
    scope: row.scope,
    resource: row.resource,
    parentId: null,
    absoluteExpiresAt: new Date(Date.now() + REFRESH_ABSOLUTE_TTL_MS).toISOString(),
  });

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: rawRefresh,
    scope: row.scope,
  });
}

// ── grant_type=refresh_token ───────────────────────────────────────────────

async function handleRefresh(
  storage: StorageAdapter,
  signer: DashboardSigner,
  client: OauthClient,
  body: TokenBody,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (body.refresh_token === undefined) {
    return reply.status(400).send({ error: 'invalid_request' });
  }

  const presentedHash = hashToken(body.refresh_token);
  const newRaw = randomBytes(32).toString('base64url');
  const newHash = hashToken(newRaw);

  const startedAt = Date.now();
  const result = await storage.oauthRefresh.rotate(presentedHash, newHash);

  if (result.kind === 'reuse_detected') {
    // Phase 31.1 Plan 04 Task 1 — Specific Ideas / D-29.
    // Write an agent_audit_log entry so operators can alert on stolen-token
    // replay attempts. user_id='system' because at reuse-detection time we
    // cannot trust WHICH party (legit owner or attacker) presented the
    // token — the outcome_detail carries clientId + chain context for
    // forensic follow-up. See T-31.1-04-07 for the accept-disposition
    // rationale on the spoofing-attribution risk.
    await storage.agentAudit.append({
      userId: 'system',
      orgId: 'system',
      toolName: 'oauth.refresh_reuse_detected',
      argsJson: JSON.stringify({
        clientId: client.clientId,
        revokedChainId: result.revokedChainId,
      }),
      outcome: 'error',
      outcomeDetail: `chain_revoked client_id=${client.clientId}`,
      latencyMs: Date.now() - startedAt,
    });
    return reply.status(400).send({ error: 'invalid_grant' });
  }

  if (result.kind !== 'success') {
    // expired / not_found → invalid_grant (same OAuth error so clients
    // cannot distinguish the two — oracle-attack defense).
    return reply.status(400).send({ error: 'invalid_grant' });
  }

  // Cross-client refresh guard (T-31.1-02-10).
  if (result.parent.clientId !== client.clientId) {
    return reply.status(400).send({ error: 'invalid_grant' });
  }

  const scopes = splitSpace(result.child.scope);
  const resources = splitSpace(result.child.resource);

  const accessToken = await signer.mintAccessToken({
    sub: result.child.userId,
    scopes,
    orgId: result.child.orgId,
    aud: resources,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    // Phase 31.2 D-20 bullet 3: client_id comes from the authenticated client
    // (result.parent.clientId === client.clientId by the cross-client refresh
    // guard above). Using client.clientId keeps the claim source symmetric
    // with handleAuthCode (both threaded from the server-verified client).
    clientId: client.clientId,
  });

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: newRaw,
    scope: result.child.scope,
  });
}
