import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { listGitHostPluginTypes } from '../../git-hosts/registry.js';
import { isPrivateHostname } from '../../services/scan-service.js';
import { escapeHtml } from './helpers.js';
import { ErrorEnvelope, HtmlPageSchema } from '../../api/schemas/envelope.js';

// Phase 41.1-03 — local TypeBox shapes.
const GitHostCreateBody = Type.Object(
  {
    pluginType: Type.Optional(Type.String()),
    hostUrl: Type.Optional(Type.String()),
    displayName: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const GitHostIdParams = Type.Object(
  { id: Type.String() },
  { additionalProperties: true },
);

const HtmlPartialResponse = {
  produces: ['text/html'],
  response: {
    200: Type.String(),
    400: Type.String(),
    401: ErrorEnvelope,
    403: ErrorEnvelope,
    404: ErrorEnvelope,
    500: Type.String(),
  },
} as const;

export async function gitHostRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/git-hosts — list configured git hosts
  server.get(
    '/admin/git-hosts',
    {
      preHandler: requirePermission('repos.manage'),
      schema: HtmlPageSchema,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const configs = await storage.gitHosts.listConfigs(orgId);
      const pluginTypes = listGitHostPluginTypes();

      return reply.view('admin/git-hosts.hbs', {
        configs,
        pluginTypes,
        pageTitle: 'Git Hosts',
        currentPath: '/admin/git-hosts',
        user: request.user,
      });
    },
  );

  // POST /admin/git-hosts — add a new git host config
  server.post(
    '/admin/git-hosts',
    {
      preHandler: requirePermission('repos.manage'),
      schema: { body: GitHostCreateBody, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        pluginType?: string;
        hostUrl?: string;
        displayName?: string;
      };

      const pluginType = body.pluginType?.trim() ?? '';
      const hostUrl = body.hostUrl?.trim() ?? '';
      const displayName = body.displayName?.trim() ?? '';

      // Validate hostUrl: must be a valid http(s) URL and not a private address
      try {
        const parsed = new URL(hostUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          const orgId = request.user?.currentOrgId ?? 'system';
          const configs = await storage.gitHosts.listConfigs(orgId);
          const pluginTypes = listGitHostPluginTypes();
          return reply.code(400).view('admin/git-hosts.hbs', {
            configs,
            pluginTypes,
            pageTitle: 'Git Hosts',
            currentPath: '/admin/git-hosts',
            user: request.user,
            error: 'Host URL must use http or https protocol.',
          });
        }
        if (isPrivateHostname(parsed.hostname)) {
          const orgId = request.user?.currentOrgId ?? 'system';
          const configs = await storage.gitHosts.listConfigs(orgId);
          const pluginTypes = listGitHostPluginTypes();
          return reply.code(400).view('admin/git-hosts.hbs', {
            configs,
            pluginTypes,
            pageTitle: 'Git Hosts',
            currentPath: '/admin/git-hosts',
            user: request.user,
            error: 'Private or internal host addresses are not allowed.',
          });
        }
      } catch {
        const orgId = request.user?.currentOrgId ?? 'system';
        const configs = await storage.gitHosts.listConfigs(orgId);
        const pluginTypes = listGitHostPluginTypes();
        return reply.code(400).view('admin/git-hosts.hbs', {
          configs,
          pluginTypes,
          pageTitle: 'Git Hosts',
          currentPath: '/admin/git-hosts',
          user: request.user,
          error: 'Invalid host URL.',
        });
      }

      if (!pluginType || !hostUrl || !displayName) {
        const orgId = request.user?.currentOrgId ?? 'system';
        const configs = await storage.gitHosts.listConfigs(orgId);
        const pluginTypes = listGitHostPluginTypes();

        return reply.code(400).view('admin/git-hosts.hbs', {
          configs,
          pluginTypes,
          pageTitle: 'Git Hosts',
          currentPath: '/admin/git-hosts',
          user: request.user,
          error: 'All fields are required.',
        });
      }

      const orgId = request.user?.currentOrgId ?? 'system';
      await storage.gitHosts.createConfig({ orgId, pluginType, hostUrl, displayName });

      return reply.redirect('/admin/git-hosts');
    },
  );

  // DELETE /admin/git-hosts/:id — remove a git host config
  server.delete(
    '/admin/git-hosts/:id',
    {
      preHandler: requirePermission('repos.manage'),
      schema: { params: GitHostIdParams, ...HtmlPartialResponse },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        await storage.gitHosts.deleteConfig(id);
        return reply
          .code(200)
          .header('content-type', 'text/html')
          .send('<div class="alert alert--success">Git host removed</div>');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove git host';
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">${escapeHtml(message)}</div>`);
      }
    },
  );
}
