import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LuqenResponse, ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';
import { hashClientSecret, generateClientCredentials } from '../../auth/oauth.js';

const Client = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    scopes: Type.Array(Type.String()),
    grantTypes: Type.Array(Type.String()),
    orgId: Type.String(),
    createdAt: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const CreateClientBody = Type.Object(
  {
    name: Type.Optional(Type.String()),
    scopes: Type.Optional(Type.Array(Type.String())),
    grantTypes: Type.Optional(Type.Array(Type.String())),
    orgId: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const ClientWithSecret = Type.Intersect([
  Client,
  Type.Object({ clientSecret: Type.String() }, { additionalProperties: true }),
]);

const IdParams = Type.Object({ id: Type.String() }, { additionalProperties: true });

export async function registerClientRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/clients
  app.get('/api/v1/clients', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['clients'],
      summary: 'List OAuth clients (secrets stripped)',
      response: {
        200: LuqenResponse(Type.Array(Client)),
        500: ErrorEnvelope,
      },
    },
  }, async (_request, reply) => {
    try {
      const clients = await db.listClients();
      const safeClients = clients.map(({ secretHash: _sh, ...rest }) => rest);
      await reply.send(safeClients);
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/clients
  app.post('/api/v1/clients', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['clients'],
      summary: 'Create a new OAuth client (returns plaintext secret once)',
      body: CreateClientBody,
      response: {
        201: LuqenResponse(ClientWithSecret),
        400: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;

      if (!body.name || !Array.isArray(body.scopes) || !Array.isArray(body.grantTypes)) {
        await reply.status(400).send({
          error: 'name, scopes, and grantTypes are required',
          statusCode: 400,
        });
        return;
      }

      const { clientId, clientSecret } = generateClientCredentials();
      const secretHash = await hashClientSecret(clientSecret);

      const client = await db.createClient({
        name: String(body.name),
        secretHash,
        scopes: body.scopes as string[],
        grantTypes: body.grantTypes as string[],
        orgId: typeof body.orgId === 'string' ? body.orgId : 'system',
      });

      // Return with the plaintext secret (only time it is visible) and client id
      const { secretHash: _sh, ...safeClient } = client;
      await reply.status(201).send({
        ...safeClient,
        id: clientId,
        clientSecret,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // DELETE /api/v1/clients/:id
  app.delete('/api/v1/clients/:id', {
    preHandler: [requireScope('admin')],
    schema: {
      tags: ['clients'],
      summary: 'Delete an OAuth client',
      params: IdParams,
      response: {
        204: Type.Null(),
        404: ErrorEnvelope,
        500: ErrorEnvelope,
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const deleted = await db.deleteClient(id);
      if (!deleted) {
        await reply.status(404).send({ error: 'Client not found', statusCode: 404 });
        return;
      }
      await reply.status(204).send();
    } catch (_err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
