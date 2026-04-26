import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorEnvelope } from '../schemas/envelope.js';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

const Webhook = Type.Object({}, { additionalProperties: true });
const WebhookList = Type.Array(Webhook);
const WebhookParams = Type.Object({ id: Type.String() });
const WebhookBody = Type.Object(
  {
    url: Type.Optional(Type.String()),
    secret: Type.Optional(Type.String()),
    events: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);
const WebhookTestResponse = Type.Object({}, { additionalProperties: true });
const WebhookDispatchBody = Type.Object(
  {
    event: Type.String(),
    data: Type.Optional(Type.Object({}, { additionalProperties: true })),
  },
  { additionalProperties: true },
);
const WebhookDispatchResponse = Type.Object({ ok: Type.Boolean() }, { additionalProperties: true });

export async function registerWebhookRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  // GET /api/v1/webhooks
  app.get('/api/v1/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'List webhooks',
      response: { 200: WebhookList, 401: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const orgId = (request as unknown as { orgId?: string }).orgId;
      const filters = orgId != null ? { orgId } : undefined;
      const webhooks = await db.listWebhooks(filters);
      await reply.send(webhooks);
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // POST /api/v1/webhooks
  app.post('/api/v1/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'Create webhook subscription',
      body: WebhookBody,
      response: { 201: Webhook, 400: ErrorEnvelope, 401: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const rawBody = request.body as Parameters<typeof db.createWebhook>[0];
      const orgId = (request as unknown as { orgId?: string }).orgId ?? 'system';
      const body = { ...rawBody, orgId };
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
    schema: {
      tags: ['webhooks'],
      summary: 'Send test payload to webhook',
      params: WebhookParams,
      response: { 200: WebhookTestResponse, 404: ErrorEnvelope, 500: ErrorEnvelope },
    },
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

  // POST /api/v1/webhooks/dispatch — trigger webhook dispatch for an event
  app.post('/api/v1/webhooks/dispatch', {
    schema: {
      tags: ['webhooks'],
      summary: 'Trigger webhook dispatch for an event',
      body: WebhookDispatchBody,
      response: { 200: WebhookDispatchResponse, 400: ErrorEnvelope, 500: ErrorEnvelope },
    },
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const body = request.body as { event?: string; data?: Record<string, unknown> };
      if (!body.event || typeof body.event !== 'string') {
        await reply.status(400).send({ error: 'event is required', statusCode: 400 });
        return;
      }
      const { dispatchWebhook } = await import('../../engine/webhooks.js');
      dispatchWebhook(db, body.event, body.data ?? {});
      await reply.send({ ok: true });
    } catch (err) {
      await reply.status(500).send({ error: 'Internal server error', statusCode: 500 });
    }
  });

  // DELETE /api/v1/webhooks/:id
  app.delete('/api/v1/webhooks/:id', {
    schema: {
      tags: ['webhooks'],
      summary: 'Delete webhook',
      params: WebhookParams,
      response: { 204: Type.Null(), 500: ErrorEnvelope },
    },
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
