import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listJurisdictions,
  listRegulations,
  createRegulation,
  updateRegulation,
  deleteRegulation,
} from '../../compliance-client.js';
import { adminGuard } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function regulationRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/regulations — list table
  server.get(
    '/admin/regulations',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { jurisdictionId?: string; q?: string; offset?: string; limit?: string };
      const jurisdictionId = query.jurisdictionId;
      const q = query.q?.trim().toLowerCase() ?? '';
      const offset = parseInt(query.offset ?? '0', 10);
      const limit = parseInt(query.limit ?? '20', 10);

      let jurisdictions: Awaited<ReturnType<typeof listJurisdictions>> = [];
      let regulations: Awaited<ReturnType<typeof listRegulations>> = [];
      let error: string | undefined;

      try {
        [jurisdictions, regulations] = await Promise.all([
          listJurisdictions(baseUrl, getToken(request), getOrgId(request)),
          listRegulations(
            baseUrl,
            getToken(request),
            jurisdictionId !== undefined && jurisdictionId !== ''
              ? { jurisdictionId }
              : undefined,
            getOrgId(request),
          ),
        ]);

        if (q !== '') {
          regulations = regulations.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.shortName.toLowerCase().includes(q),
          );
        }
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load regulations';
      }

      const total = regulations.length;
      const page = regulations.slice(offset, offset + limit);
      const hasPrev = offset > 0;
      const hasNext = offset + limit < total;
      const currentPage = Math.floor(offset / limit) + 1;

      const isHtmx = request.headers['hx-request'] === 'true';
      if (isHtmx) {
        return reply.view('admin/regulations-table.hbs', {
          regulations: page,
          error,
          hasPrev,
          hasNext,
          prevOffset: Math.max(0, offset - limit),
          nextOffset: offset + limit,
          limit,
          currentPage,
          q,
          jurisdictionId,
        });
      }

      return reply.view('admin/regulations.hbs', {
        pageTitle: 'Regulations',
        currentPath: '/admin/regulations',
        user: request.user,
        regulations: page,
        jurisdictions,
        error,
        hasPrev,
        hasNext,
        prevOffset: Math.max(0, offset - limit),
        nextOffset: offset + limit,
        limit,
        currentPage,
        q,
        jurisdictionId,
      });
    },
  );

  // GET /admin/regulations/new — modal form fragment
  server.get(
    '/admin/regulations/new',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { jurisdictionId?: string };
      let jurisdictions: Awaited<ReturnType<typeof listJurisdictions>> = [];

      try {
        jurisdictions = await listJurisdictions(baseUrl, getToken(request), getOrgId(request));
      } catch {
        // non-fatal; jurisdictions list will be empty
      }

      return reply.view('admin/regulation-form.hbs', {
        isNew: true,
        regulation: {
          id: '',
          name: '',
          shortName: '',
          jurisdictionId: query.jurisdictionId ?? '',
          enforcementDate: '',
          status: 'active',
          scope: '',
        },
        jurisdictions,
      });
    },
  );

  // POST /admin/regulations — create
  server.post(
    '/admin/regulations',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        id?: string;
        name?: string;
        shortName?: string;
        jurisdictionId?: string;
        enforcementDate?: string;
        status?: string;
        scope?: string;
      };

      if (!body.id?.trim() || !body.name?.trim() || !body.jurisdictionId?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('ID, name, and jurisdiction are required.', 'error'));
      }

      try {
        const created = await createRegulation(baseUrl, getToken(request), {
          id: body.id.trim(),
          name: body.name.trim(),
          shortName: body.shortName?.trim() ?? '',
          jurisdictionId: body.jurisdictionId.trim(),
          enforcementDate: body.enforcementDate?.trim() ?? '',
          status: body.status?.trim() ?? 'active',
          scope: body.scope?.trim() ?? '',
        }, getOrgId(request));

        const row = `<tr id="regulation-${created.id}">
  <td>${created.id}</td>
  <td>${created.name}</td>
  <td>${created.shortName}</td>
  <td>${created.jurisdictionId}</td>
  <td>${created.enforcementDate}</td>
  <td>${created.status}</td>
  <td>${created.scope}</td>
  <td>
    <button hx-get="/admin/regulations/${encodeURIComponent(created.id)}/edit"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Edit ${created.name}">Edit</button>
    <button hx-delete="/admin/regulations/${encodeURIComponent(created.id)}"
            hx-confirm="Delete regulation ${created.name}?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${created.name}">Delete</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`Regulation "${created.name}" created successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create regulation';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/regulations/:id/edit — edit form fragment
  server.get(
    '/admin/regulations/:id/edit',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const [jurisdictions, regulations] = await Promise.all([
          listJurisdictions(baseUrl, getToken(request), getOrgId(request)),
          listRegulations(baseUrl, getToken(request), undefined, getOrgId(request)),
        ]);
        const regulation = regulations.find((r) => r.id === id);

        if (regulation === undefined) {
          return reply.code(404).header('content-type', 'text/html').send(toastHtml('Regulation not found.', 'error'));
        }

        return reply.view('admin/regulation-form.hbs', {
          isNew: false,
          regulation,
          jurisdictions,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load regulation';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // PATCH /admin/regulations/:id — update
  server.patch(
    '/admin/regulations/:id',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        shortName?: string;
        jurisdictionId?: string;
        enforcementDate?: string;
        status?: string;
        scope?: string;
      };

      if (!body.name?.trim() || !body.jurisdictionId?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Name and jurisdiction are required.', 'error'));
      }

      try {
        const updated = await updateRegulation(baseUrl, getToken(request), id, {
          name: body.name.trim(),
          shortName: body.shortName?.trim(),
          jurisdictionId: body.jurisdictionId.trim(),
          enforcementDate: body.enforcementDate?.trim(),
          status: body.status?.trim(),
          scope: body.scope?.trim(),
        }, getOrgId(request));

        const row = `<tr id="regulation-${updated.id}">
  <td>${updated.id}</td>
  <td>${updated.name}</td>
  <td>${updated.shortName}</td>
  <td>${updated.jurisdictionId}</td>
  <td>${updated.enforcementDate}</td>
  <td>${updated.status}</td>
  <td>${updated.scope}</td>
  <td>
    <button hx-get="/admin/regulations/${encodeURIComponent(updated.id)}/edit"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Edit ${updated.name}">Edit</button>
    <button hx-delete="/admin/regulations/${encodeURIComponent(updated.id)}"
            hx-confirm="Delete regulation ${updated.name}?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete ${updated.name}">Delete</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`Regulation "${updated.name}" updated successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update regulation';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/regulations/:id — delete
  server.delete(
    '/admin/regulations/:id',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await deleteRegulation(baseUrl, getToken(request), id, getOrgId(request));
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('Regulation deleted successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete regulation';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}
