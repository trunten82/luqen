/**
 * OAuth 2.1 Dynamic Client Registration (RFC 7591) — Phase 31.1 Plan 02 Task 3.
 *
 * POST /oauth/register — open endpoint that accepts `client_metadata` and
 * returns a fresh `client_id` (and, for confidential clients, a one-shot
 * `client_secret`). Rate-limited at 10 req/hour/IP (D-17 / T-31.1-02-08).
 *
 * Security posture (D-16): open DCR is safe because the Authorization Code
 * flow always requires explicit user consent via `/oauth/authorize` before a
 * token is issued — a rogue registration by itself cannot do anything. Admins
 * can revoke DCR'd clients from `/admin/clients` (Plan 04).
 *
 * Scope tier invariant (Phase 30.1 D-07) is preserved — the registration
 * endpoint doesn't mint tokens, it only persists the metadata. Scopes flow
 * through the normal `filterToolsByScope` rule when tokens are finally
 * issued at /oauth/token.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import rateLimit from '@fastify/rate-limit';
import { ErrorEnvelope } from '../../api/schemas/envelope.js';
import type { StorageAdapter } from '../../db/adapter.js';

// RFC 7591 §2 client_metadata request body. Field types stay loose
// (e.g. `redirect_uris` typed as string[] though the handler validates each
// entry manually) — additionalProperties:true allows extension members
// without breaking AJV.
const ClientRegistrationRequestSchema = Type.Object(
  {
    client_name: Type.Optional(Type.String()),
    redirect_uris: Type.Optional(Type.Array(Type.String())),
    grant_types: Type.Optional(Type.Array(Type.String())),
    response_types: Type.Optional(Type.Array(Type.String())),
    token_endpoint_auth_method: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    contacts: Type.Optional(Type.Array(Type.String())),
    logo_uri: Type.Optional(Type.String()),
    client_uri: Type.Optional(Type.String()),
    policy_uri: Type.Optional(Type.String()),
    tos_uri: Type.Optional(Type.String()),
    software_id: Type.Optional(Type.String()),
    software_version: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

// RFC 7591 §3.2.1 client_information_response. Matches reply.send(...) shape
// in the handler below.
const ClientRegistrationResponseSchema = Type.Object(
  {
    client_id: Type.String(),
    // RFC 7591 §3.2.1: public clients (token_endpoint_auth_method=none) MUST
    // get null for client_secret. Type.Optional(Type.String()) coerces null
    // to '' through Fastify's TypeBox serializer; the union preserves null.
    client_secret: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    client_id_issued_at: Type.Optional(Type.Number()),
    client_secret_expires_at: Type.Optional(Type.Number()),
    redirect_uris: Type.Array(Type.String()),
    grant_types: Type.Optional(Type.Array(Type.String())),
    token_endpoint_auth_method: Type.Optional(Type.String()),
    client_name: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const SUPPORTED_GRANTS = new Set(['authorization_code', 'refresh_token']);
const SUPPORTED_AUTH_METHODS = new Set(['none', 'client_secret_basic']);

interface RegisterBody {
  readonly client_name?: unknown;
  readonly redirect_uris?: unknown;
  readonly grant_types?: unknown;
  readonly token_endpoint_auth_method?: unknown;
  readonly scope?: unknown;
  readonly software_id?: unknown;
  readonly software_version?: unknown;
}

function isHttps(uri: URL): boolean {
  return uri.protocol === 'https:';
}

function isLocalhostHttp(uri: URL): boolean {
  return uri.protocol === 'http:' && (uri.hostname === 'localhost' || uri.hostname === '127.0.0.1');
}

/**
 * Returns true iff the redirect URI is either (a) https, or (b) http targeting
 * localhost / 127.0.0.1 (to support MCP clients in development, e.g. Claude
 * Desktop running locally against a dev dashboard).
 */
function validateRedirectUri(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const u = new URL(value);
    return isHttps(u) || isLocalhostHttp(u);
  } catch {
    return false;
  }
}

export async function registerRegisterRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // The rate-limit plugin is encapsulated so this 10/hr/IP ceiling applies
  // ONLY to /oauth/register — we don't want to throttle other routes.
  await server.register(async (instance) => {
    await instance.register(rateLimit, {
      max: 10,
      timeWindow: '1 hour',
      keyGenerator: (req: FastifyRequest) => req.ip,
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      // errorResponseBuilder — returns JSON at the 429 boundary. This is the
      // `errorResponseBuilder` mechanism; the onSend-hook mechanism (see
      // server.ts global 429 handler) is for HTML 429 pages only.
      errorResponseBuilder: () => ({ error: 'too_many_requests', statusCode: 429 }),
    });

    instance.post('/oauth/register', {
      schema: {
        tags: ['oauth', 'dcr'],
        body: ClientRegistrationRequestSchema,
        response: {
          201: ClientRegistrationResponseSchema,
          400: ErrorEnvelope,
          401: ErrorEnvelope,
          429: ErrorEnvelope,
        },
      },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as RegisterBody;

      // client_name required (RFC 7591 §2 — client_metadata).
      if (typeof body.client_name !== 'string' || body.client_name.length === 0) {
        return reply.status(400).send({
          error: 'invalid_client_metadata',
          error_description: 'client_name required',
        });
      }

      // redirect_uris required + validated.
      if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
        return reply.status(400).send({ error: 'invalid_redirect_uri' });
      }
      for (const uri of body.redirect_uris) {
        if (!validateRedirectUri(uri)) {
          return reply.status(400).send({ error: 'invalid_redirect_uri' });
        }
      }

      // grant_types default to [authorization_code, refresh_token] when omitted.
      const rawGrants = Array.isArray(body.grant_types)
        ? body.grant_types
        : ['authorization_code', 'refresh_token'];
      for (const g of rawGrants) {
        if (typeof g !== 'string' || !SUPPORTED_GRANTS.has(g)) {
          return reply.status(400).send({
            error: 'invalid_client_metadata',
            error_description: `unsupported grant_type: ${String(g)}`,
          });
        }
      }

      // token_endpoint_auth_method defaults to 'none' (public client).
      const authMethod = typeof body.token_endpoint_auth_method === 'string'
        ? body.token_endpoint_auth_method
        : 'none';
      if (!SUPPORTED_AUTH_METHODS.has(authMethod)) {
        return reply.status(400).send({
          error: 'invalid_client_metadata',
          error_description: 'unsupported token_endpoint_auth_method',
        });
      }

      const scope = typeof body.scope === 'string' ? body.scope : 'read';
      const softwareId = typeof body.software_id === 'string' ? body.software_id : undefined;
      const softwareVersion = typeof body.software_version === 'string' ? body.software_version : undefined;

      const result = await storage.oauthClients.register({
        clientName: body.client_name,
        redirectUris: body.redirect_uris as string[],
        grantTypes: rawGrants as string[],
        tokenEndpointAuthMethod: authMethod as 'none' | 'client_secret_basic',
        scope,
        ...(softwareId !== undefined ? { softwareId } : {}),
        ...(softwareVersion !== undefined ? { softwareVersion } : {}),
      });

      return reply.status(201).send({
        client_id: result.clientId,
        client_id_issued_at: Math.floor(Date.parse(result.createdAt) / 1000),
        client_secret: result.clientSecret,
        token_endpoint_auth_method: authMethod,
        grant_types: rawGrants,
        redirect_uris: body.redirect_uris,
        client_name: body.client_name,
        scope,
      });
    });
  });
}
