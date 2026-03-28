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
  storage?: import('../../db/index.js').StorageAdapter,
): Promise<void> {
  // GET /admin/plugins — render plugins page (scoped by org)
  server.get(
    '/admin/plugins',
    { preHandler: requirePermission('admin.system', 'admin.plugins') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = request.user?.currentOrgId ?? 'system';
      const isAdmin = request.user?.role === 'admin';
      const perms = (request as unknown as Record<string, unknown>)['permissions'] as Set<string> | undefined ?? new Set<string>();

      // Global admin sees all; org admin sees global plugins (as available to activate for their org)
      const allInstalled = pluginManager.list();
      const globalPlugins = allInstalled.filter((p) => p.orgId === 'system' || p.orgId === undefined);
      const orgInstances = allInstalled.filter((p) => p.orgId !== 'system' && p.orgId !== undefined);

      const allOrgs = isAdmin && storage ? await storage.organizations.listOrgs() : [];

      let installed: Array<Record<string, unknown>>;
      if (isAdmin) {
        // For global admin: annotate each global plugin with org usage
        const orgMap = new Map(allOrgs.map((o: { id: string; name: string }) => [o.id, o.name]));

        installed = globalPlugins.map((p) => {
          const orgUsage = orgInstances
            .filter((oi) => oi.packageName === p.packageName)
            .map((oi) => ({
              orgName: orgMap.get(oi.orgId ?? '') ?? oi.orgId ?? 'unknown',
              status: oi.status,
              hasCustomConfig: oi.config !== p.config,
            }));
          return { ...p, orgUsage, orgUsageCount: orgUsage.length };
        });
      } else {
        // Org admin sees: global plugins (to activate for org) + org-specific instances
        const orgPlugins = allInstalled.filter((p) => p.orgId === orgId);
        const orgPackages = new Set(orgPlugins.map((p) => p.packageName));
        // For global plugins not yet activated for this org, show them with a flag
        const globalForOrg = globalPlugins
          .filter((p) => !orgPackages.has(p.packageName))
          .map((p) => ({ ...p, isGlobalOnly: true }));
        installed = [...orgPlugins.map((p) => ({ ...p, isOrgInstance: true })), ...globalForOrg];
      }

      const installedPackages = new Set(allInstalled.map((p) => p.packageName));
      const available = registryEntries.filter(
        (entry) => !installedPackages.has(entry.packageName),
      );

      const activeCount = installed.filter((p) => p.status === 'active').length;

      return reply.view('admin/plugins.hbs', {
        pageTitle: 'Plugins',
        currentPath: '/admin/plugins',
        user: request.user,
        installed,
        available,
        counts: {
          installed: installed.length,
          active: activeCount,
          available: available.length,
        },
        isAdmin,
        canInstallPlugins: isAdmin || perms.has('admin.plugins'),
        orgId,
        allOrgs,
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

  // POST /admin/plugins/:id/activate-for-org — global admin activates for a specific org
  server.post<{ Params: { id: string }; Body: { orgId?: string | string[] } }>(
    '/admin/plugins/:id/activate-for-org',
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      try {
        const raw = (request.body as Record<string, unknown>)?.orgId;
        const orgIds: string[] = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.length > 0 ? [raw] : []);

        if (orgIds.length === 0) {
          return reply
            .code(400)
            .header('content-type', 'text/html')
            .send('<div class="alert alert--error">Select at least one organization</div>');
        }

        let count = 0;
        for (const oid of orgIds) {
          try {
            await pluginManager.activateForOrg(request.params.id, oid);
            count++;
          } catch { /* skip orgs that already have it */ }
        }

        return reply
          .header('content-type', 'text/html')
          .header('hx-trigger', 'pluginChanged')
          .send(
            `<div class="alert alert--success">Plugin activated for ${count} organization(s)</div>`,
          );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .header('content-type', 'text/html')
          .send(`<div class="alert alert--error">Activate for org failed: ${escapeHtml(message)}</div>`);
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
