import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerClientRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/clients — org-scoped: system sees all, org sees system + own
  app.get('/api/v1/clients', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const clients = await db.listClients(orgId);
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
        orgId: typeof body.orgId === 'string' ? body.orgId : 'system',
      });
      // Strip secretHash, keep secret (returned on creation only)
      const { secretHash: _sh, ...safeClient } = client;
      await reply.status(201).send(safeClient);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // POST /api/v1/clients/:id/revoke — org ownership check
  app.post('/api/v1/clients/:id/revoke', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const requestOrgId = (request as unknown as { orgId?: string }).orgId;
      const recordOrgId = await db.getClientOrgId(id);

      if (recordOrgId == null) {
        await reply.status(404).send({ error: 'Client not found', statusCode: 404 });
        return;
      }

      // Non-system callers cannot delete system clients
      if (recordOrgId === 'system' && requestOrgId !== 'system') {
        await reply.status(403).send({ error: 'Cannot revoke system client', statusCode: 403 });
        return;
      }

      // Non-system callers cannot delete other orgs' clients
      if (requestOrgId != null && recordOrgId !== 'system' && recordOrgId !== requestOrgId) {
        await reply.status(403).send({ error: 'Cannot revoke client belonging to another organisation', statusCode: 403 });
        return;
      }

      await db.deleteClient(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
