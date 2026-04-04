import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listSources,
  createSource,
  deleteSource,
  scanSources,
  uploadSource,
  updateSourceMode,
  bulkSwitchSourceMode,
} from '../../compliance-client.js';
import { escapeHtml } from './helpers.js';
import { requirePermission } from '../../auth/middleware.js';
import { getToken, getOrgId, toastHtml } from './helpers.js';

export async function sourceRoutes(
  server: FastifyInstance,
  baseUrl: string,
  pluginManager?: import('../../plugins/manager.js').PluginManager,
  llmClient?: import('../../llm-client.js').LLMClient | null,
): Promise<void> {
  // GET /admin/sources — list monitored sources
  server.get(
    '/admin/sources',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let sources: Awaited<ReturnType<typeof listSources>> = [];
      let error: string | undefined;
      let llmConnected = false;

      try {
        sources = await listSources(baseUrl, getToken(request), getOrgId(request));
      } catch (err) {
        error = err instanceof Error ? err.message : 'Failed to load sources';
      }

      if (llmClient) {
        try {
          await llmClient.health();
          llmConnected = true;
        } catch {
          // LLM service unreachable — leave llmConnected = false
        }
      }

      return reply.view('admin/sources.hbs', {
        pageTitle: 'Monitored Sources',
        currentPath: '/admin/sources',
        user: request.user,
        sources,
        error,
        llmConnected,
      });
    },
  );

  // GET /admin/sources/new — modal form fragment
  server.get(
    '/admin/sources/new',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.view('admin/source-form.hbs', {
        isNew: true,
        source: { id: '', name: '', url: '', type: 'rss', schedule: 'daily' },
      });
    },
  );

  // GET /admin/sources/:id/view — view source detail modal
  server.get(
    '/admin/sources/:id/view',
    { preHandler: requirePermission('admin.system', 'compliance.view') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const sources = await listSources(baseUrl, getToken(request), getOrgId(request));
        const source = sources.find((s) => s.id === id);
        if (source === undefined) {
          return reply.code(404).header('content-type', 'text/html').send(toastHtml('Source not found.', 'error'));
        }
        const isSystem = source.orgId === 'system' || source.orgId === undefined;
        return reply.view('admin/source-view.hbs', { source, isSystem });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load source';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/sources — add new source
  server.post(
    '/admin/sources',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        url?: string;
        type?: string;
        schedule?: string;
      };

      if (!body.name?.trim() || !body.url?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Name and URL are required.', 'error'));
      }

      try {
        const created = await createSource(baseUrl, getToken(request), {
          name: body.name.trim(),
          url: body.url.trim(),
          type: body.type?.trim() ?? 'rss',
          schedule: body.schedule?.trim() ?? 'daily',
        }, getOrgId(request));

        const ownerBadge = created.orgId === 'system' || created.orgId === undefined
          ? '<span class="badge badge--neutral">System</span>'
          : (created.orgId ?? '');
        const row = `<tr id="source-${created.id}">
  <td data-label="Name">${created.name}</td>
  <td data-label="Type"><span class="badge badge--info">${created.type}</span></td>
  <td data-label="Schedule">${created.schedule}</td>
  <td data-label="Last Checked">${created.lastCheckedAt ?? 'Never'}</td>
  <td data-label="Owner">${ownerBadge}</td>
  <td>
    <button hx-get="/admin/sources/${encodeURIComponent(created.id)}/view"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="View ${created.name}">View</button>
  </td>
</tr>`;

        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send(`${row}\n<div id="modal-container" hx-swap-oob="true"></div>\n${toastHtml(`Source "${created.name}" added successfully.`)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add source';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // DELETE /admin/sources/:id — remove source
  server.delete(
    '/admin/sources/:id',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await deleteSource(baseUrl, getToken(request), id, getOrgId(request));
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('Source removed successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove source';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );

  // POST /admin/sources/upload — upload document for LLM parsing
  server.post(
    '/admin/sources/upload',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        content?: string;
        name?: string;
        regulationId?: string;
        regulationName?: string;
        jurisdictionId?: string;
        pluginId?: string;
      };

      if (!body.content?.trim() || !body.name?.trim()) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Name and content are required.', 'error'));
      }

      try {
        const result = await uploadSource(baseUrl, getToken(request), {
          content: body.content.trim(),
          name: body.name.trim(),
          regulationId: body.regulationId,
          regulationName: body.regulationName ?? body.name.trim(),
          jurisdictionId: body.jurisdictionId,
          pluginId: body.pluginId,
        }, getOrgId(request));

        const msg = result.message as string ?? `Extracted ${result.criteriaCount ?? 0} requirement(s)`;
        return reply.code(200).header('content-type', 'text/html').send(toastHtml(escapeHtml(msg)));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(escapeHtml(message), 'error'));
      }
    },
  );

  // POST /admin/sources/bulk-switch — switch all government sources
  server.post(
    '/admin/sources/bulk-switch',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { mode?: string };
      const mode = body.mode === 'manual' ? 'manual' : 'llm';
      try {
        const result = await bulkSwitchSourceMode(baseUrl, getToken(request), mode);
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/sources')
          .send(toastHtml(`${result.updated} sources switched to ${mode}`, 'success'));
      } catch (err) {
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(err instanceof Error ? err.message : 'Failed', 'error'));
      }
    },
  );

  // POST /admin/sources/:id/mode — toggle management mode
  server.post(
    '/admin/sources/:id/mode',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { mode?: string };
      if (body.mode !== 'llm' && body.mode !== 'manual') {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Invalid mode', 'error'));
      }
      try {
        await updateSourceMode(baseUrl, getToken(request), id, body.mode);
        return reply
          .header('content-type', 'text/html')
          .header('HX-Redirect', '/admin/sources')
          .send(toastHtml(`Switched to ${body.mode}`, 'success'));
      } catch (err) {
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(toastHtml(err instanceof Error ? err.message : 'Failed', 'error'));
      }
    },
  );

  // POST /admin/sources/scan — trigger scan
  server.post(
    '/admin/sources/scan',
    { preHandler: requirePermission('admin.system', 'compliance.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getToken(request);

      // Fire-and-forget: respond immediately, run scan in background
      const scanPromise = scanSources(baseUrl, token, true)
        .then((result) => {
          const changed = result.changed ?? 0;
          request.log.info(
            { scanned: result.scanned, changed, proposals: result.proposalsCreated },
            'Source scan completed',
          );
        })
        .catch((err) => {
          request.log.error({ err }, 'Background source scan failed');
        });

      // Don't block the response — let it run
      void scanPromise;

      const html = `<div id="scan-results" aria-live="polite">
  <p class="text--info">Source scan started in background. Check proposals for results.</p>
</div>
${toastHtml('Source scan started — results will appear in Regulatory Updates when complete.')}`;

      return reply.code(200).header('content-type', 'text/html').send(html);
    },
  );
}
