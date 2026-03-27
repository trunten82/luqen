import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import type { PluginManager } from '../../plugins/manager.js';
import type { RegistryEntry, ConfigField, PluginManifest } from '../../plugins/types.js';
import { escapeHtml } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'badge--success';
    case 'inactive':
      return 'badge--neutral';
    case 'error':
    case 'install-failed':
      return 'badge--error';
    case 'unhealthy':
      return 'badge--warning';
    default:
      return 'badge--neutral';
  }
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case 'auth':
      return 'badge--info';
    case 'notification':
      return 'badge--warning';
    case 'storage':
      return 'badge--neutral';
    case 'scanner':
      return 'badge--success';
    default:
      return 'badge--neutral';
  }
}

function renderConfigField(field: ConfigField, currentValue: unknown): string {
  const value = currentValue ?? field.default ?? '';
  const requiredAttr = field.required ? 'required' : '';
  const descHtml = field.description
    ? `<small class="form-hint">${escapeHtml(field.description)}</small>`
    : '';

  switch (field.type) {
    case 'string':
      return `
        <div class="form-group">
          <label for="cfg-${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <input type="text" id="cfg-${escapeHtml(field.key)}" name="${escapeHtml(field.key)}"
                 value="${escapeHtml(String(value))}" class="input" ${requiredAttr} />
          ${descHtml}
        </div>`;
    case 'secret':
      return `
        <div class="form-group">
          <label for="cfg-${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <input type="password" id="cfg-${escapeHtml(field.key)}" name="${escapeHtml(field.key)}"
                 value="" placeholder="Enter new value to change" class="input" ${requiredAttr} />
          ${descHtml}
        </div>`;
    case 'number':
      return `
        <div class="form-group">
          <label for="cfg-${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <input type="number" id="cfg-${escapeHtml(field.key)}" name="${escapeHtml(field.key)}"
                 value="${escapeHtml(String(value))}" class="input" ${requiredAttr} />
          ${descHtml}
        </div>`;
    case 'boolean':
      return `
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="cfg-${escapeHtml(field.key)}" name="${escapeHtml(field.key)}"
                   value="true" ${value === true ? 'checked' : ''} />
            ${escapeHtml(field.label)}
          </label>
          ${descHtml}
        </div>`;
    case 'select':
      return `
        <div class="form-group">
          <label for="cfg-${escapeHtml(field.key)}">${escapeHtml(field.label)}</label>
          <select id="cfg-${escapeHtml(field.key)}" name="${escapeHtml(field.key)}" class="input" ${requiredAttr}>
            ${(field.options ?? []).map((opt) =>
              `<option value="${escapeHtml(opt)}" ${String(value) === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`,
            ).join('\n')}
          </select>
          ${descHtml}
        </div>`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function pluginAdminRoutes(
  server: FastifyInstance,
  pluginManager: PluginManager,
  registryEntries: readonly RegistryEntry[],
): Promise<void> {
  // GET /admin/plugins — render plugins page (scoped by org)
  server.get(
    '/admin/plugins',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const isAdmin = request.user?.role === 'admin';

      // Admin without org context sees all; others see org-scoped + global
      const installed = isAdmin && orgId === 'system'
        ? pluginManager.list()
        : pluginManager.list(orgId);

      const installedPackages = new Set(installed.map((p) => p.packageName));

      const available = registryEntries.filter(
        (entry) => !installedPackages.has(entry.packageName),
      );

      const activeCount = installed.filter((p) => p.status === 'active').length;

      // Separate global vs org plugins for display
      const globalPlugins = installed.filter((p) => p.orgId === 'system' || p.orgId === undefined);
      const orgPlugins = installed.filter((p) => p.orgId !== 'system' && p.orgId !== undefined);

      return reply.view('admin/plugins.hbs', {
        pageTitle: 'Plugins',
        currentPath: '/admin/plugins',
        user: request.user,
        installed,
        globalPlugins,
        orgPlugins,
        hasOrgPlugins: orgPlugins.length > 0,
        available,
        counts: {
          installed: installed.length,
          active: activeCount,
          available: available.length,
        },
        isAdmin,
        orgId,
        orgName: (request as unknown as Record<string, unknown>).orgContext
          ? ((request as unknown as Record<string, { currentOrg?: { name?: string } }>).orgContext?.currentOrg?.name ?? orgId)
          : orgId,
        statusBadgeClass,
        typeBadgeClass,
      });
    },
  );

  // POST /admin/plugins/install — HTMX install (returns updated HTML fragment)
  server.post<{ Body: { packageName?: string } }>(
    '/admin/plugins/install',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      const { packageName } = request.body ?? {};
      if (!packageName || typeof packageName !== 'string') {
        return reply
          .code(400)
          .header('content-type', 'text/html')
          .send('<div class="alert alert--error">Missing packageName</div>');
      }

      try {
        const plugin = await pluginManager.install(packageName);
        // TODO: audit logging via storage.audit.log
        void ({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'plugin.install', resourceType: 'plugin', resourceId: plugin.id, details: { packageName: plugin.packageName, version: plugin.version }, ipAddress: request.ip });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin "${escapeHtml(plugin.packageName)}" installed successfully (${escapeHtml(plugin.type)}, v${escapeHtml(plugin.version)})</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Install failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // POST /admin/plugins/:id/activate — HTMX activate
  server.post<{ Params: { id: string } }>(
    '/admin/plugins/:id/activate',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const plugin = await pluginManager.activate(request.params.id);
        // TODO: audit logging via storage.audit.log
        void ({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'plugin.activate', resourceType: 'plugin', resourceId: request.params.id, details: { packageName: plugin.packageName }, ipAddress: request.ip });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin "${escapeHtml(plugin.packageName)}" activated</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Activate failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // POST /admin/plugins/:id/deactivate — HTMX deactivate
  server.post<{ Params: { id: string } }>(
    '/admin/plugins/:id/deactivate',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const plugin = await pluginManager.deactivate(request.params.id);
        // TODO: audit logging via storage.audit.log
        void ({ actor: request.user?.username ?? 'unknown', actorId: request.user?.id, action: 'plugin.deactivate', resourceType: 'plugin', resourceId: request.params.id, details: { packageName: plugin.packageName }, ipAddress: request.ip });
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin "${escapeHtml(plugin.packageName)}" deactivated</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Deactivate failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // DELETE /admin/plugins/:id — HTMX remove
  server.delete<{ Params: { id: string } }>(
    '/admin/plugins/:id',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        await pluginManager.remove(request.params.id);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send('<div class="alert alert--success">Plugin removed successfully</div>');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Remove failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // GET /admin/plugins/:id/configure — render config form
  server.get<{ Params: { id: string } }>(
    '/admin/plugins/:id/configure',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const plugin = pluginManager.getPlugin(request.params.id);
        if (!plugin) {
          return reply
            .code(404)
            .header('content-type', 'text/html')
            .send('<div class="alert alert--error">Plugin not found</div>');
        }

        // Try to read the manifest config schema
        let configSchema: readonly ConfigField[] = [];
        const manifest: PluginManifest | null = pluginManager.getManifest(request.params.id);
        if (manifest) {
          configSchema = manifest.configSchema ?? [];
        }

        const fieldsHtml = configSchema.length > 0
          ? configSchema
              .map((field) => renderConfigField(field, plugin.config[field.key]))
              .join('\n')
          : '<p>This plugin has no configurable settings.</p>';

        const html = `
          <form hx-patch="/admin/plugins/${escapeHtml(plugin.id)}/config"
                hx-target="#plugin-messages" hx-swap="innerHTML">
            <h3>Configure ${escapeHtml(plugin.packageName)}</h3>
            ${fieldsHtml}
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Save Configuration</button>
            </div>
          </form>`;

        return reply.header('content-type', 'text/html').send(html);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">${escapeHtml(message)}</div>`);
      }
    },
  );

  // PATCH /admin/plugins/:id/config — HTMX save config
  server.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/plugins/:id/config',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const config = (request.body ?? {}) as Record<string, unknown>;

        // Remove empty strings for secret fields (means "no change")
        const cleanedConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(config)) {
          if (typeof v === 'string' && v === '') {
            continue; // skip empty secret fields
          }
          cleanedConfig[k] = v;
        }

        await pluginManager.configure(request.params.id, cleanedConfig);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send('<div class="alert alert--success">Configuration saved</div>');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Save failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // POST /admin/plugins/:id/org/activate — org-scoped activate
  server.post<{ Params: { id: string } }>(
    '/admin/plugins/:id/org/activate',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const orgId = request.user?.currentOrgId;
        if (!orgId || orgId === 'system') {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send('<div class="alert alert--error">No organization context</div>');
        }

        const plugin = await pluginManager.activateForOrg(request.params.id, orgId);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin "${escapeHtml(plugin.packageName)}" activated for organization</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Activate failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // POST /admin/plugins/:id/org/deactivate — org-scoped deactivate
  server.post<{ Params: { id: string } }>(
    '/admin/plugins/:id/org/deactivate',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const orgId = request.user?.currentOrgId;
        if (!orgId || orgId === 'system') {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send('<div class="alert alert--error">No organization context</div>');
        }

        const plugin = await pluginManager.deactivateForOrg(request.params.id, orgId);
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin "${escapeHtml(plugin.packageName)}" deactivated for organization</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Deactivate failed: ${escapeHtml(message)}</div>`);
      }
    },
  );

  // PATCH /admin/plugins/:packageName/org-config — save org-specific plugin config
  server.patch<{ Params: { packageName: string }; Body: Record<string, unknown> }>(
    '/admin/plugins/:packageName/org-config',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request, reply) => {
      try {
        const orgId = request.user?.currentOrgId;
        if (!orgId || orgId === 'system') {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send('<div class="alert alert--error">No organization context</div>');
        }

        const config = (request.body ?? {}) as Record<string, unknown>;

        // Remove empty strings for secret fields (means "no change")
        const cleanedConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(config)) {
          if (typeof v === 'string' && v === '') {
            continue;
          }
          cleanedConfig[k] = v;
        }

        await pluginManager.configureForOrg(
          decodeURIComponent(request.params.packageName),
          orgId,
          cleanedConfig,
        );
        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send('<div class="alert alert--success">Organization plugin configuration saved</div>');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Save failed: ${escapeHtml(message)}</div>`);
      }
    },
  );
}
