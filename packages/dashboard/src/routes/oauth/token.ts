/**
 * OAuth 2.1 /oauth/token endpoint — Phase 31.1 Plan 02 Task 2.
 *
 * Supports three grants (D-11):
 *   - authorization_code: PKCE S256 verified + single-use code consumption
 *     + RS256 JWT mint + refresh rotation chain root insertion.
 *   - refresh_token:      rotate-on-use with reuse-detection revocation
 *     (D-29 / T-31.1-02-07). Returns a fresh access_token + fresh refresh_token.
 *     A cross-client refresh is blocked (parent.clientId must match the
 *     presented client).
 *   - client_credentials: confidential-client flow — sub = clientId,
 *     orgId = 'system'. Scopes + resources come from the request body (or
 *     fall back to the client's registered scope).
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
import { createHash, randomBytes } from 'node:crypto';
import type { StorageAdapter } from '../../db/adapter.js';
import type { OauthClient } from '../../db/interfaces/oauth-client-repository.js';
import { verifyS256Challenge } from '../../auth/oauth-pkce.js';
import type { DashboardSigner } from '../../auth/oauth-signer.js';

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
  server.post('/oauth/token', async (request: FastifyRequest, reply: FastifyReply) => {
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

    // 3. Branch on grant_type.
    switch (body.grant_type) {
      case 'authorization_code':
        return handleAuthCode(storage, signer, client, body, reply);
      case 'refresh_token':
        return handleRefresh(storage, signer, client, body, reply);
      case 'client_credentials':
        return handleClientCredentials(signer, client, body, reply);
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
  });

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: newRaw,
    scope: result.child.scope,
  });
}

// ── grant_type=client_credentials ──────────────────────────────────────────

async function handleClientCredentials(
  signer: DashboardSigner,
  client: OauthClient,
  body: TokenBody,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const scopes = splitSpace(body.scope ?? client.scope);
  const resources = splitSpace(body.resource);

  const accessToken = await signer.mintAccessToken({
    sub: client.clientId,
    scopes,
    orgId: 'system',
    aud: resources,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });

  return reply.send({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes.join(' '),
  });
}
