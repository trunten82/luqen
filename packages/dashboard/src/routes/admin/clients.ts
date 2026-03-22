import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listClients,
  createClient,
  revokeClient,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml, escapeHtml } from './helpers.js';

export async function clientRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/clients — list OAuth clients
  server.get(
    '/admin/clients',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let clients: Awaited<ReturnType<typeof listClients>> = [];
      let error: string | undefined;

      try {
        clients = await listClients(baseUrl, getToken(request), getOrgId(request));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load OAuth clients';
      }

      const formatted = clients.map((c) => ({
        ...c,
        createdAtDisplay: new Date(c.createdAt).toLocaleString(),
        scopesDisplay: c.scopes.join(', '),
        grantTypesDisplay: c.grantTypes.join(', '),
      }));

      return reply.view('admin/clients.hbs', {
        pageTitle: 'OAuth Clients',
        currentPath: '/admin/clients',
        user: request.user,
        clients: formatted,
        error,
      });
    },
  );

  // GET /admin/clients/new — modal form fragment
  server.get(
    '/admin/clients/new',
    { preHandler: requirePermission('admin.system') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/client-form.hbs', {
        isNew: true,
        formClient: { name: '', scopes: '', grantTypes: 'client_credentials' },
        availableGrantTypes: ['client_credentials', 'password', 'authorization_code', 'refresh_token'],
      });
    },
  );

  // POST /admin/clients — create OAuth client
  server.post(
    '/admin/clients',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        scopes?: string;
        grantTypes?: string | string[];
      };

      if (!body.name?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Client name is required.', 'error'));
      }

      const scopes = (body.scopes ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const grantTypes = Array.isArray(body.grantTypes)
        ? body.grantTypes
        : body.grantTypes !== undefined
        ? [body.grantTypes]
        : ['client_credentials'];

      try {
        const created = await createClient(baseUrl, getToken(request), {
          name: body.name.trim(),
          scopes,
          grantTypes,
        }, getOrgId(request));

        // Secret is shown once in a modal dialog; no inline JS handlers needed
        const secretModal = `<div id="modal-container" hx-swap-oob="true">
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="secret-modal-title">
    <div class="modal">
      <h2 id="secret-modal-title">Client Secret — Copy Now</h2>
      <p class="text--warning">This secret will only be shown once. Copy it now and store it securely.</p>
      <div class="secret-box">
        <code id="client-secret-display">${escapeHtml(created.secret)}</code>
      </div>
      <p><strong>Client ID:</strong> <code>${escapeHtml(created.clientId)}</code></p>
      <p><strong>Name:</strong> ${escapeHtml(created.name)}</p>
      <button class="btn btn--primary close-modal-btn" aria-label="Close — I have copied the secret">
        I have copied the secret
      </button>
    </div>
  </div>
</div>`;

        const row = `<tr id="client-${escapeHtml(created.clientId)}">
  <td data-label="Name">${escapeHtml(created.name)}</td>
  <td data-label="Client ID"><code>${escapeHtml(created.clientId)}</code></td>
  <td data-label="Scopes">${escapeHtml(scopes.join(', '))}</td>
  <td data-label="Grant Types">${escapeHtml(grantTypes.join(', '))}</td>
  <td data-label="Created">${new Date(created.createdAt).toLocaleString()}</td>
  <td>
    <button hx-post="/admin/clients/${encodeURIComponent(created.clientId)}/revoke"
            hx-confirm="Revoke client ${escapeHtml(created.name)}? This cannot be undone."
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Revoke ${escapeHtml(created.name)}">Revoke</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n${secretModal}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create OAuth client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/clients/:id/revoke — revoke OAuth client
  server.post(
    '/admin/clients/:id/revoke',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await revokeClient(baseUrl, getToken(request), id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml('OAuth client revoked successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to revoke client';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
