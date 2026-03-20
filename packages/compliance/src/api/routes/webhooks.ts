import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerWebhookRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/webhooks
  app.get('/api/v1/webhooks', {
    preHandler: [requireScope('admin')],
  }, async (_request, reply) => {
    try {
      const webhooks = await db.listWebhooks();
      await reply.send(webhooks);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/webhooks
  app.post('/api/v1/webhooks', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as Parameters<typeof db.createWebhook>[0];
      if (!body.url || !body.secret || !Array.isArray(body.events)) {
        await reply.status(400).send({
          error: 'url, secret, and events are required',
          statusCode: 400,
        });
        return;
      }
      const webhook = await db.createWebhook(body);
      await reply.status(201).send(webhook);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bad request';
      await reply.status(400).send({ error: message, statusCode: 400 });
    }
  });

  // POST /api/v1/webhooks/:id/test
  app.post('/api/v1/webhooks/:id/test', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const webhooks = await db.listWebhooks();
      const webhook = webhooks.find(w => w.id === id);
      if (webhook === undefined) return reply.code(404).send({ error: 'Webhook not found' });

      const testPayload = {
        event: 'webhook.test',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test webhook delivery' },
      };

      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload),
        });
        await reply.send({ success: true, statusCode: res.status });
      } catch (fetchErr) {
        const message = fetchErr instanceof Error ? fetchErr.message : 'Request failed';
        await reply.send({ success: false, error: message });
      }
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // DELETE /api/v1/webhooks/:id
  app.delete('/api/v1/webhooks/:id', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await db.deleteWebhook(id);
      await reply.status(204).send();
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });
}
