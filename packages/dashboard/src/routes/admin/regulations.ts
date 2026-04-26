import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  listJurisdictions,
  listRegulations,
  listRequirements,
  createRegulation,
  updateRegulation,
  deleteRegulation,
} from '../../compliance-client.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes.
const RegulationListQuery = Type.Object(
  {
    jurisdictionId: Type.Optional(Type.String()),
    q: Type.Optional(Type.String()),
    offset: Type.Optional(Type.String()),
    limit: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const RegulationCreateBody = Type.Object(
  {
    id: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    shortName: Type.Optional(Type.String()),
    jurisdictionId: Type.Optional(Type.String()),
    enforcementDate: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const RegulationUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String()),
    shortName: Type.Optional(Type.String()),
    jurisdictionId: Type.Optional(Type.String()),
    enforcementDate: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const RegulationIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const NewRegQuery = Type.Object(
  { jurisdictionId: Type.Optional(Type.String()) },
  { additionalProperties: true },
);

const HtmlPartialResponse = {
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: ErrorEnvelope,
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    500: ErrorEnvelope,
  },
} as const;

export async function regulationRoutes(
  server: FastifyInstance,
  baseUrl: string,
): Promise<void> {
  // GET /admin/regulations — list table
  server.get(
    '/admin/regulations',
    {
      preHandler: requirePermission('admin.system', 'compliance.view'),
      schema: { ...HtmlPageSchema, querystring: RegulationListQuery },
    },
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
    {
      preHandler: requirePermission('admin.system', 'compliance.view'),
      schema: { querystring: NewRegQuery, ...HtmlPartialResponse },
    },
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
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { body: RegulationCreateBody, ...HtmlPartialResponse },
    },
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

        const ownerBadge = created.orgId === 'system' || created.orgId === undefined
          ? '<span class="badge badge--neutral">System</span>'
          : (created.orgId ?? '');
        const row = `<tr id="regulation-${created.id}">
  <td data-label="ID">${created.id}</td>
  <td data-label="Name">${created.name}</td>
  <td data-label="Short Name">${created.shortName}</td>
  <td data-label="Jurisdiction">${created.jurisdictionId}</td>
  <td data-label="Enforcement Date">${created.enforcementDate}</td>
  <td data-label="Status">${created.status}</td>
  <td data-label="Scope">${created.scope}</td>
  <td data-label="Owner">${ownerBadge}</td>
  <td>
    <button hx-get="/admin/regulations/${encodeURIComponent(created.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${created.name}">View</button>
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

  // GET /admin/regulations/:id/view — read-only detail modal
  server.get(
    '/admin/regulations/:id/view',
    {
      preHandler: requirePermission('admin.system', 'compliance.view'),
      schema: { params: RegulationIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const [jurisdictions, regulations, requirements] = await Promise.all([
          listJurisdictions(baseUrl, getToken(request), getOrgId(request)),
          listRegulations(baseUrl, getToken(request), undefined, getOrgId(request)),
          listRequirements(baseUrl, getToken(request), { regulationId: id }, getOrgId(request)),
        ]);
        const regulation = regulations.find((r) => r.id === id);
        if (regulation === undefined) {
          return reply.code(404).header('content-type', 'text/html').send(toastHtml('Regulation not found.', 'error'));
        }
        const jurisdiction = jurisdictions.find((j) => j.id === regulation.jurisdictionId);
        const jurisdictionName = jurisdiction?.name ?? regulation.jurisdictionId;
        const isSystem = regulation.orgId === 'system' || regulation.orgId === undefined;
        return reply.view('admin/regulation-view.hbs', { regulation, jurisdictionName, requirements, isSystem });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load regulation';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // GET /admin/regulations/:id/edit — edit form fragment
  server.get(
    '/admin/regulations/:id/edit',
    {
      preHandler: requirePermission('admin.system', 'compliance.view'),
      schema: { params: RegulationIdParams, ...HtmlPartialResponse },
    },
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
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: RegulationIdParams, body: RegulationUpdateBody, ...HtmlPartialResponse },
    },
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

        const ownerBadge = updated.orgId === 'system' || updated.orgId === undefined
          ? '<span class="badge badge--neutral">System</span>'
          : (updated.orgId ?? '');
        const row = `<tr id="regulation-${updated.id}">
  <td data-label="ID">${updated.id}</td>
  <td data-label="Name">${updated.name}</td>
  <td data-label="Short Name">${updated.shortName}</td>
  <td data-label="Jurisdiction">${updated.jurisdictionId}</td>
  <td data-label="Enforcement Date">${updated.enforcementDate}</td>
  <td data-label="Status">${updated.status}</td>
  <td data-label="Scope">${updated.scope}</td>
  <td data-label="Owner">${ownerBadge}</td>
  <td>
    <button hx-get="/admin/regulations/${encodeURIComponent(updated.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${updated.name}">View</button>
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
    {
      preHandler: requirePermission('admin.system', 'compliance.manage'),
      schema: { params: RegulationIdParams, ...HtmlPartialResponse },
    },
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
