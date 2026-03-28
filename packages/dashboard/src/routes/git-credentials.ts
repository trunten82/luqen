import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StorageAdapter } from '../db/index.js';
import type { DashboardConfig } from '../config.js';
import { requirePermission } from '../auth/middleware.js';
import { getGitHostPlugin } from '../git-hosts/registry.js';
import { encryptSecret } from '../plugins/crypto.js';
import { toastHtml } from './admin/helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreCredentialBody {
  readonly gitHostConfigId?: string;
  readonly token?: string;
  readonly _csrf?: string;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function gitCredentialRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  config: DashboardConfig,
): Promise<void> {
  const encryptionKey = config.sessionSecret;

  // ── GET /account/git-credentials — list stored credentials ────────────

  server.get(
    '/account/git-credentials',
    { preHandler: requirePermission('repos.credentials') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      const orgId = request.user?.currentOrgId ?? 'system';

      const credentials = await storage.gitHosts.listCredentials(userId);
      const configs = await storage.gitHosts.listConfigs(orgId);

      // Determine which config IDs already have a stored credential
      const usedConfigIds = new Set(credentials.map((c) => c.gitHostConfigId));
      const availableHosts = configs.filter((c) => !usedConfigIds.has(c.id));

      // Enrich credentials with host display info
      const enrichedCredentials = credentials.map((cred) => {
        const hostConfig = configs.find((c) => c.id === cred.gitHostConfigId);
        return {
          ...cred,
          hostDisplayName: hostConfig?.displayName ?? 'Unknown',
          hostPluginType: hostConfig?.pluginType ?? 'unknown',
        };
      });

      return reply.view('account/git-credentials.hbs', {
        pageTitle: 'Git Credentials',
        currentPath: '/account/git-credentials',
        user: request.user,
        credentials: enrichedCredentials,
        availableHosts,
      });
    },
  );

  // ── POST /account/git-credentials — validate & store credential ───────

  server.post(
    '/account/git-credentials',
    {
      preHandler: requirePermission('repos.credentials'),
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user!.id;
      const orgId = request.user?.currentOrgId ?? 'system';
      const body = request.body as StoreCredentialBody;

      const gitHostConfigId = body.gitHostConfigId?.trim() ?? '';
      const token = body.token?.trim() ?? '';

      if (gitHostConfigId === '' || token === '') {
        return reply.code(422).send(
          toastHtml('Git host and token are required.', 'error'),
        );
      }

      // Look up config
      const hostConfig = await storage.gitHosts.getConfig(gitHostConfigId);
      if (hostConfig === null) {
        return reply.code(404).send(
          toastHtml('Git host configuration not found.', 'error'),
        );
      }

      // Get plugin for this host type
      const plugin = getGitHostPlugin(hostConfig.pluginType);
      if (plugin === undefined) {
        return reply.code(422).send(
          toastHtml(`Unsupported git host type: ${hostConfig.pluginType}`, 'error'),
        );
      }

      // Validate token against the host
      const validation = await plugin.validateToken(hostConfig.hostUrl, token);
      if (!validation.valid) {
        const errorMsg = validation.error ?? 'Token validation failed. Please check your PAT and try again.';
        return reply.code(422).send(toastHtml(errorMsg, 'error'));
      }

      // Encrypt the token
      const encryptedToken = encryptSecret(token, encryptionKey);
      const tokenHint = '\u2022\u2022\u2022\u2022' + token.slice(-4);

      // Store the credential
      await storage.gitHosts.storeCredential({
        userId,
        gitHostConfigId,
        encryptedToken,
        tokenHint,
        validatedUsername: validation.username,
      });

      // Re-render the full page for HTMX or redirect
      if (request.headers['hx-request'] === 'true') {
        const credentials = await storage.gitHosts.listCredentials(userId);
        const configs = await storage.gitHosts.listConfigs(orgId);
        const usedConfigIds = new Set(credentials.map((c) => c.gitHostConfigId));
        const availableHosts = configs.filter((c) => !usedConfigIds.has(c.id));

        const enrichedCredentials = credentials.map((cred) => {
          const cfg = configs.find((c) => c.id === cred.gitHostConfigId);
          return {
            ...cred,
            hostDisplayName: cfg?.displayName ?? 'Unknown',
            hostPluginType: cfg?.pluginType ?? 'unknown',
          };
        });

        return reply.view('account/git-credentials.hbs', {
          pageTitle: 'Git Credentials',
          currentPath: '/account/git-credentials',
          user: request.user,
          credentials: enrichedCredentials,
          availableHosts,
          success: 'Credential saved successfully.',
        });
      }

      await reply.redirect('/account/git-credentials');
    },
  );

  // ── DELETE /account/git-credentials/:id — remove credential ───────────

  server.delete(
    '/account/git-credentials/:id',
    { preHandler: requirePermission('repos.credentials') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.id;

      await storage.gitHosts.deleteCredential(id, userId);

      if (request.headers['hx-request'] === 'true') {
        return reply.code(200).send(
          toastHtml('Credential removed.'),
        );
      }

      await reply.redirect('/account/git-credentials');
    },
  );
}
