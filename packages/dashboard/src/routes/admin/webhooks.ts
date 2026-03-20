import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
} from '../../compliance-client.js';
import { adminGuard } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function webhookRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/webhooks — list webhooks
  server.get(
    '/admin/webhooks',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let webhooks: Awaited<ReturnType<typeof listWebhooks>> = [];
      let error: string | undefined;

      try {
        webhooks = await listWebhooks(baseUrl, getToken(request), getOrgId(request));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load webhooks';
      }

      const formatted = webhooks.map((w) => ({
        ...w,
        createdAtDisplay: new Date(w.createdAt).toLocaleString(),
        eventsDisplay: w.events.join(', '),
      }));

      return reply.view('admin/webhooks.hbs', {
        pageTitle: 'Webhooks',
        currentPath: '/admin/webhooks',
        user: request.user,
        webhooks: formatted,
        error,
      });
    },
  );

  // GET /admin/webhooks/new — modal form fragment
  server.get(
    '/admin/webhooks/new',
    { preHandler: adminGuard },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/webhook-form.hbs', {
        isNew: true,
        webhook: { url: '', events: [], secret: '' },
        availableEvents: ['compliance.check', 'scan.complete', 'proposal.created', 'proposal.approved', 'proposal.rejected'],
      });
    },
  );

  // POST /admin/webhooks — add webhook
  server.post(
    '/admin/webhooks',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        url?: string;
        events?: string | string[];
        secret?: string;
      };

      if (!body.url?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('URL is required.', 'error'));
      }

      const events = Array.isArray(body.events)
        ? body.events
        : body.events !== undefined
        ? [body.events]
        : [];

      try {
        const created = await createWebhook(baseUrl, getToken(request), {
          url: body.url.trim(),
          events,
          secret: body.secret?.trim(),
        }, getOrgId(request));

        const row = `<tr id="webhook-${created.id}">
  <td><a href="${created.url}" target="_blank" rel="noopener noreferrer">${created.url}</a></td>
  <td>${created.events.join(', ')}</td>
  <td><span class="badge ${created.active ? 'badge--success' : 'badge--neutral'}">${created.active ? 'Active' : 'Inactive'}</span></td>
  <td>${new Date(created.createdAt).toLocaleString()}</td>
  <td>
    <button hx-post="/admin/webhooks/${encodeURIComponent(created.id)}/test"
            hx-target="#toast-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Test webhook ${created.url}">Test</button>
    <button hx-delete="/admin/webhooks/${encodeURIComponent(created.id)}"
            hx-confirm="Delete this webhook?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete webhook ${created.url}">Delete</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml('Webhook added successfully.')}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add webhook';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/webhooks/:id/test — test delivery
  server.post(
    '/admin/webhooks/:id/test',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await testWebhook(baseUrl, getToken(request), id);
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('Test delivery sent successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send test delivery';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/webhooks/:id — delete webhook
  server.delete(
    '/admin/webhooks/:id',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await deleteWebhook(baseUrl, getToken(request), id, getOrgId(request));
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('Webhook deleted successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete webhook';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
