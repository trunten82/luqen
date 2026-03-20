import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerClientRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/clients
  app.get('/api/v1/clients', {
    preHandler: [requireScope('admin')],
  }, async (_request, reply) => {
    try {
      const clients = await db.listClients();
      // Strip secretHash from response
      const safeClients = clients.map(({ secretHash: _sh, ...rest }) => rest);
      await reply.send(safeClients);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/clients
  app.post('/api/v1/clients', {
    preHandler: [requireScope('admin')],
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
      const client = await db.createClient({
        name: body.name as string,
        scopes: body.scopes as string[],
        grantTypes: body.grantTypes as ('client_credentials' | 'authorization_code')[],
        ...(Array.isArray(body.redirectUris) ? { redirectUris: body.redirectUris as string[] } : {}),
      });
      // Strip secretHash, keep secret (returned on creation only)
      const { secretHash: _sh, ...safeClient } = client;
      await reply.status(201).send(safeClient);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // POST /api/v1/clients/:id/revoke
  app.post('/api/v1/clients/:id/revoke', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await db.deleteClient(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
