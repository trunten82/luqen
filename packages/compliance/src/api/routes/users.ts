import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerUserRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/users
  app.get('/api/v1/users', {
    preHandler: [requireScope('admin')],
  }, async (_request, reply) => {
    try {
      const users = await db.listUsers();
      // Strip passwordHash from response
      const safeUsers = users.map(({ passwordHash: _ph, ...rest }) => rest);
      await reply.send(safeUsers);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/users
  app.post('/api/v1/users', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      if (!body.username || !body.password || !body.role) {
        await reply.status(400).send({
          error: 'username, password, and role are required',
          statusCode: 400,
        });
        return;
      }
      const user = await db.createUser({
        username: body.username as string,
        password: body.password as string,
        role: body.role as 'admin' | 'editor' | 'viewer',
      });
      // Strip passwordHash from response
      const { passwordHash: _ph, ...safeUser } = user;
      await reply.status(201).send(safeUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // PATCH /api/v1/users/:id/deactivate
  app.patch('/api/v1/users/:id/deactivate', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await db.deactivateUser(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
