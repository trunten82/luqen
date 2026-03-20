import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listJurisdictions,
  createJurisdiction,
  updateJurisdiction,
  deleteJurisdiction,
} from '../../compliance-client.js';
import { adminGuard } from '../../auth/middleware.js';

function getToken(request: FastifyRequest): string {
  const session = request.session as { token?: string };
  return session.token ?? '';
}

function getOrgId(request: FastifyRequest): string | undefined {
  return request.user?.currentOrgId;
}

function toastHtml(message: string, type: 'success' | 'error' = 'success'): string {
  return `<div id="toast" hx-swap-oob="true" role="alert" aria-live="assertive" class="toast toast--${type}">${message}</div>`;
}

export async function jurisdictionRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/jurisdictions — list table
  server.get(
    '/admin/jurisdictions',
    { preHandler: adminGuard },
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
      const hasPrev = offset > 0;
      const hasNext = offset + limit < total;
      const currentPage = Math.floor(offset / limit) + 1;

      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply.view('admin/jurisdictions-table.hbs', {
          jurisdictions: page,
          error,
          hasPrev,
          hasNext,
          prevOffset: Math.max(0, offset - limit),
          nextOffset: offset + limit,
          limit,
          currentPage,
          q,
        });
      }

      return reply.view('admin/jurisdictions.hbs', {
        pageTitle: 'Jurisdictions',
        currentPath: '/admin/jurisdictions',
        user: request.user,
        jurisdictions: page,
        error,
        hasPrev,
        hasNext,
        prevOffset: Math.max(0, offset - limit),
        nextOffset: offset + limit,
        limit,
        currentPage,
        q,
      });
    },
  );

  // GET /admin/jurisdictions/new — modal form fragment
  server.get(
    '/admin/jurisdictions/new',
    { preHandler: adminGuard },
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
    { preHandler: adminGuard },
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
  <td>${created.id}</td>
  <td>${created.name}</td>
  <td>${created.type}</td>
  <td>${created.parentId ?? ''}</td>
  <td>
    <button hx-get="/admin/jurisdictions/${encodeURIComponent(created.id)}/edit"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Edit ${created.name}">Edit</button>
    <button hx-delete="/admin/jurisdictions/${encodeURIComponent(created.id)}"
            hx-confirm="Delete jurisdiction ${created.name}?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${created.name}">Delete</button>
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

  // GET /admin/jurisdictions/:id/edit — edit form fragment
  server.get(
    '/admin/jurisdictions/:id/edit',
    { preHandler: adminGuard },
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
    { preHandler: adminGuard },
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
  <td>${updated.id}</td>
  <td>${updated.name}</td>
  <td>${updated.type}</td>
  <td>${updated.parentId ?? ''}</td>
  <td>
    <button hx-get="/admin/jurisdictions/${encodeURIComponent(updated.id)}/edit"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Edit ${updated.name}">Edit</button>
    <button hx-delete="/admin/jurisdictions/${encodeURIComponent(updated.id)}"
            hx-confirm="Delete jurisdiction ${updated.name}?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${updated.name}">Delete</button>
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
    { preHandler: adminGuard },
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
