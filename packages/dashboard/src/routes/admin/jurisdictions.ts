import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listJurisdictions,
  listRegulations,
  createJurisdiction,
  updateJurisdiction,
  deleteJurisdiction,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function jurisdictionRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/jurisdictions — list table
  server.get(
    '/admin/jurisdictions',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { q?: string; offset?: string; limit?: string };
      const q = query.q?.trim().toLowerCase() ?? '';
      const offset = parseInt(query.offset ?? '0', 10);
      const limit = parseInt(query.limit ?? '20', 10);

      let jurisdictions: Awaited<ReturnType<typeof listJurisdictions>> = [];
      let error: string | undefined;

      try {
        jurisdictions = await listJurisdictions(baseUrl, getToken(request), getOrgId(request));
        if (q !== '') {
          jurisdictions = jurisdictions.filter(
            (j) =>
              j.name.toLowerCase().includes(q) ||
              j.id.toLowerCase().includes(q),
          );
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load jurisdictions';
      }

      const total = jurisdictions.length;
      const page = jurisdictions.slice(offset, offset + limit);
      const hasNext = offset + limit < total;

      const isPartialRows = (request.query as { partial?: string }).partial === 'rows';
      const isHtmx = request.headers['hx-request'] === 'true';

      if (isPartialRows) {
        const escQ = encodeURIComponent(q);
        const shown = offset + page.length;
        let html = page.map((j) =>
          `<tr id="jurisdiction-${j.id}">
  <td data-label="ID">${j.id}</td>
  <td data-label="Name">${j.name}</td>
  <td data-label="Type">${j.type}</td>
  <td data-label="Parent">${j.parentId ?? ''}</td>
  <td><button hx-get="/admin/jurisdictions/${encodeURIComponent(j.id)}/view" hx-target="#modal-container" hx-swap="innerHTML" class="btn btn--sm btn--secondary" aria-label="View ${j.name}">View</button></td>
</tr>`
        ).join('\n');

        // OOB swap: replace the load-more div and the counter
        const counterOob = `<span id="jurisdictions-counter" hx-swap-oob="true">Showing ${shown} of ${total}</span>`;
        let loadMoreOob: string;
        if (hasNext) {
          loadMoreOob = `<div id="load-more-jurisdictions" hx-swap-oob="true" class="load-more"><button hx-get="/admin/jurisdictions?offset=${shown}&limit=${limit}&q=${escQ}&partial=rows" hx-target="#jurisdictions-table-body" hx-swap="beforeend" class="btn btn--ghost btn--full">Load more (${shown} of ${total})</button></div>`;
        } else {
          loadMoreOob = `<div id="load-more-jurisdictions" hx-swap-oob="true"></div>`;
        }

        return reply.code(200).header('content-type', 'text/html').send(`${html}\n${counterOob}\n${loadMoreOob}`);
      }

      if (isHtmx && !isPartialRows) {
        // Search — return full table HTML for the list area
        const escQ = encodeURIComponent(q);
        let rows = '';
        if (page.length === 0) {
          rows = '<tr><td colspan="5">No jurisdictions found.</td></tr>';
        } else {
          rows = page.map((j) =>
            `<tr id="jurisdiction-${j.id}">
  <td data-label="ID">${j.id}</td>
  <td data-label="Name">${j.name}</td>
  <td data-label="Type">${j.type}</td>
  <td data-label="Parent">${j.parentId ?? ''}</td>
  <td><button hx-get="/admin/jurisdictions/${encodeURIComponent(j.id)}/view" hx-target="#modal-container" hx-swap="innerHTML" class="btn btn--sm btn--secondary" aria-label="View ${j.name}">View</button></td>
</tr>`
          ).join('\n');
        }

        let loadMore = '';
        if (hasNext) {
          loadMore = `<div class="load-more"><button hx-get="/admin/jurisdictions?offset=${offset + limit}&limit=${limit}&q=${escQ}&partial=rows" hx-target="#jurisdictions-table-body" hx-swap="beforeend" class="btn btn--ghost btn--full" hx-on::after-request="this.closest('.load-more').remove()">Load more (${offset + limit} of ${total})</button></div>`;
        }

        const html = `<div class="table-wrapper"><table aria-label="Jurisdictions"><thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Parent</th><th scope="col">Actions</th></tr></thead><tbody id="jurisdictions-table-body">${rows}</tbody></table></div>${loadMore}`;
        return reply.code(200).header('content-type', 'text/html').send(html);
      }

      return reply.view('admin/jurisdictions.hbs', {
        pageTitle: 'Jurisdictions',
        currentPath: '/admin/jurisdictions',
        user: request.user,
        jurisdictions: page,
        error,
        hasNext,
        nextOffset: offset + limit,
        limit,
        total,
        q,
      });
    },
  );

  // GET /admin/jurisdictions/new — modal form fragment
  server.get(
    '/admin/jurisdictions/new',
    { preHandler: requirePermission('admin.system') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/jurisdiction-form.hbs', {
        isNew: true,
        jurisdiction: { id: '', name: '', type: '', parentId: '' },
      });
    },
  );

  // POST /admin/jurisdictions — create
  server.post(
    '/admin/jurisdictions',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { id?: string; name?: string; type?: string; parentId?: string };

      if (!body.id?.trim() || !body.name?.trim() || !body.type?.trim()) {
        return reply
          .code(400)
          .send(toastHtml('ID, name, and type are required.', 'error'));
      }

      try {
        const created = await createJurisdiction(baseUrl, getToken(request), {
          id: body.id.trim(),
          name: body.name.trim(),
          type: body.type.trim(),
          parentId: body.parentId?.trim() || undefined,
        }, getOrgId(request));

        const row = `<tr id="jurisdiction-${created.id}">
  <td data-label="ID">${created.id}</td>
  <td data-label="Name">${created.name}</td>
  <td data-label="Type">${created.type}</td>
  <td data-label="Parent">${created.parentId ?? ''}</td>
  <td>
    <button hx-get="/admin/jurisdictions/${encodeURIComponent(created.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${created.name}">View</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${row}
<div id="modal-container" hx-swap-oob="true"></div>
${toastHtml(`Jurisdiction "${created.name}" created successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create jurisdiction';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/jurisdictions/:id/view — read-only detail modal
  server.get(
    '/admin/jurisdictions/:id/view',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const [jurisdictions, regulations] = await Promise.all([
          listJurisdictions(baseUrl, getToken(request), getOrgId(request)),
          listRegulations(baseUrl, getToken(request), { jurisdictionId: id }, getOrgId(request)),
        ]);
        const jurisdiction = jurisdictions.find((j) => j.id === id);
        if (jurisdiction === undefined) {
          return reply.code(404).send(toastHtml('Jurisdiction not found.', 'error'));
        }
        const isSystem = jurisdiction.orgId === 'system' || jurisdiction.orgId === undefined;
        return reply.view('admin/jurisdiction-view.hbs', { jurisdiction, regulations, isSystem });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load jurisdiction';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/jurisdictions/:id/edit — edit form fragment
  server.get(
    '/admin/jurisdictions/:id/edit',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const jurisdictions = await listJurisdictions(baseUrl, getToken(request), getOrgId(request));
        const jurisdiction = jurisdictions.find((j) => j.id === id);

        if (jurisdiction === undefined) {
          return reply.code(404).send(toastHtml('Jurisdiction not found.', 'error'));
        }

        return reply.view('admin/jurisdiction-form.hbs', {
          isNew: false,
          jurisdiction,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load jurisdiction';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // PATCH /admin/jurisdictions/:id — update
  server.patch(
    '/admin/jurisdictions/:id',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; type?: string; parentId?: string };

      if (!body.name?.trim() || !body.type?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Name and type are required.', 'error'));
      }

      try {
        const updated = await updateJurisdiction(baseUrl, getToken(request), id, {
          name: body.name.trim(),
          type: body.type.trim(),
          parentId: body.parentId?.trim() || undefined,
        }, getOrgId(request));

        const row = `<tr id="jurisdiction-${updated.id}">
  <td data-label="ID">${updated.id}</td>
  <td data-label="Name">${updated.name}</td>
  <td data-label="Type">${updated.type}</td>
  <td data-label="Parent">${updated.parentId ?? ''}</td>
  <td>
    <button hx-get="/admin/jurisdictions/${encodeURIComponent(updated.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${updated.name}">View</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(
            `${row}
<div id="modal-container" hx-swap-oob="true"></div>
${toastHtml(`Jurisdiction "${updated.name}" updated successfully.`)}`,
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update jurisdiction';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/jurisdictions/:id — delete
  server.delete(
    '/admin/jurisdictions/:id',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await deleteJurisdiction(baseUrl, getToken(request), id, getOrgId(request));
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(toastHtml(`Jurisdiction deleted successfully.`));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete jurisdiction';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
