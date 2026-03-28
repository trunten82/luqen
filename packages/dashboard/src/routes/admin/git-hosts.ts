import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../../db/adapter.js';
import { requirePermission } from '../../auth/middleware.js';
import { listGitHostPluginTypes } from '../../git-hosts/registry.js';

export async function gitHostRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
): Promise<void> {
  // GET /admin/git-hosts — list configured git hosts
  server.get(
    '/admin/git-hosts',
    { preHandler: requirePermission('repos.manage') },
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
    { preHandler: requirePermission('repos.manage') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        pluginType?: string;
        hostUrl?: string;
        displayName?: string;
      };

      const pluginType = body.pluginType?.trim() ?? '';
      const hostUrl = body.hostUrl?.trim() ?? '';
      const displayName = body.displayName?.trim() ?? '';

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
    { preHandler: requirePermission('repos.manage') },
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
          .send(`<div class="alert alert--error">${message}</div>`);
      }
    },
  );
}
