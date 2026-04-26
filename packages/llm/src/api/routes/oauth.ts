import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import type { TokenSigner } from '../../auth/oauth.js';
import { verifyClientSecret, verifyPassword } from '../../auth/oauth.js';

interface OAuthDeps {
  readonly db: DbAdapter;
  readonly signToken: TokenSigner;
  readonly tokenExpiry: string;
}

const TokenBody = Type.Object(
  {
    grant_type: Type.Optional(Type.String()),
    client_id: Type.Optional(Type.String()),
    client_secret: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    username: Type.Optional(Type.String()),
    password: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const TokenResponse = Type.Object(
  {
    access_token: Type.String(),
    token_type: Type.String(),
    expires_in: Type.Number(),
    scope: Type.String(),
  },
  { additionalProperties: true },
);

const RevokeResponse = Type.Object(
  { revoked: Type.Boolean() },
  { additionalProperties: true },
);

function parseExpiryToSeconds(tokenExpiry: string): number {
  if (tokenExpiry.endsWith('h')) return parseInt(tokenExpiry, 10) * 3600;
  if (tokenExpiry.endsWith('m')) return parseInt(tokenExpiry, 10) * 60;
  return parseInt(tokenExpiry, 10);
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  deps: OAuthDeps,
): Promise<void> {
  const { db, signToken, tokenExpiry } = deps;

  // POST /api/v1/oauth/token
  app.post('/api/v1/oauth/token', {
    schema: {
      tags: ['oauth'],
      summary: 'Exchange credentials for an access token (client_credentials or password grant)',
      body: TokenBody,
      response: {
        200: LuqenResponse(TokenResponse),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      let clientId: string | undefined;
      let clientSecret: string | undefined;
      let grantType: string | undefined;
      let requestedScopes: string[] = [];

      // Check Basic auth header
      const authHeader = request.headers.authorization;
      if (authHeader != null && authHeader.startsWith('Basic ')) {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx !== -1) {
          clientId = decoded.slice(0, colonIdx);
          clientSecret = decoded.slice(colonIdx + 1);
        }
      }

      // Body params override Basic auth
      if (body.client_id != null) clientId = String(body.client_id);
      if (body.client_secret != null) clientSecret = String(body.client_secret);
      if (body.grant_type != null) grantType = String(body.grant_type);
      if (body.scope != null) {
        requestedScopes = String(body.scope).split(' ').filter(Boolean);
      }

      if (grantType === 'password') {
        const username = body.username != null ? String(body.username) : undefined;
        const password = body.password != null ? String(body.password) : undefined;

        if (username == null || password == null) {
          await reply.status(400).send({
            error: 'invalid_request: username and password are required',
            statusCode: 400,
          });
          return;
        }

        const user = await db.getUserByUsername(username);
        if (user == null) {
          await reply.status(401).send({ error: 'invalid_grant', statusCode: 401 });
          return;
        }

        const validPassword = await verifyPassword(password, user.passwordHash);
        if (!validPassword) {
          await reply.status(401).send({ error: 'invalid_grant', statusCode: 401 });
          return;
        }

        const roleScopes: Record<string, string[]> = {
          admin: ['read', 'write', 'admin'],
          editor: ['read', 'write'],
          viewer: ['read'],
          user: ['read'],
        };
        const defaultScopes = roleScopes[user.role] ?? ['read'];

        let grantedScopes: string[];
        if (requestedScopes.length > 0) {
          grantedScopes = requestedScopes.filter(s => defaultScopes.includes(s));
          if (grantedScopes.length === 0) {
            await reply.status(400).send({ error: 'invalid_scope', statusCode: 400 });
            return;
          }
        } else {
          grantedScopes = defaultScopes;
        }

        const accessToken = await signToken({
          sub: user.id,
          scopes: grantedScopes,
          expiresIn: tokenExpiry,
          role: user.role,
          username: user.username,
        });

        await reply.status(200).send({
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: parseExpiryToSeconds(tokenExpiry),
          scope: grantedScopes.join(' '),
        });
        return;
      }

      if (grantType !== 'client_credentials') {
        await reply.status(400).send({
          error: 'unsupported_grant_type',
          statusCode: 400,
        });
        return;
      }

      if (clientId == null || clientSecret == null) {
        await reply.status(400).send({
          error: 'invalid_request: client_id and client_secret are required',
          statusCode: 400,
        });
        return;
      }

      const client = await db.getClientById(clientId);
      if (client == null) {
        await reply.status(401).send({ error: 'invalid_client', statusCode: 401 });
        return;
      }

      const valid = await verifyClientSecret(clientSecret, client.secretHash);
      if (!valid) {
        await reply.status(401).send({ error: 'invalid_client', statusCode: 401 });
        return;
      }

      let grantedScopes: string[];
      if (requestedScopes.length > 0) {
        grantedScopes = requestedScopes.filter(s => client.scopes.includes(s));
        if (grantedScopes.length === 0) {
          await reply.status(400).send({ error: 'invalid_scope', statusCode: 400 });
          return;
        }
      } else {
        grantedScopes = [...client.scopes];
      }

      const accessToken = await signToken({
        sub: clientId,
        scopes: grantedScopes,
        expiresIn: tokenExpiry,
        ...(client.orgId !== 'system' ? { orgId: client.orgId } : {}),
      });

      await reply.status(200).send({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: parseExpiryToSeconds(tokenExpiry),
        scope: grantedScopes.join(' '),
      });
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/oauth/revoke — stateless JWT, just acknowledge
  app.post('/api/v1/oauth/revoke', {
    schema: {
      tags: ['oauth'],
      summary: 'Revoke a token (no-op for stateless JWT — always 200)',
      response: {
        200: LuqenResponse(RevokeResponse),
      },
    },
  }, async (_request, reply) => {
    await reply.status(200).send({ revoked: true });
  });
}
