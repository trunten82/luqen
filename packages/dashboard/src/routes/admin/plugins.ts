import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../auth/middleware.js';
import type { PluginManager } from '../../plugins/manager.js';
import type { RegistryEntry, ConfigField } from '../../plugins/types.js';
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
  pluginsDir?: string,
): Promise<void> {
  // GET /admin/plugins — render plugins page
  server.get(
    '/admin/plugins',
    { preHandler: requirePermission('admin.system') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const installed = pluginManager.list();
      const installedPackages = new Set(installed.map((p) => p.packageName));

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
        statusBadgeClass,
        typeBadgeClass,
      });
    },
  );

  // POST /admin/plugins/install — HTMX install (returns updated HTML fragment)
  server.post<{ Body: { packageName?: string } }>(
    '/admin/plugins/install',
    { preHandler: requirePermission('admin.system') },
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
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      try {
        const plugin = await pluginManager.activate(request.params.id);
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
    { preHandler: requirePermission('admin.system') },
    async (request, reply) => {
      try {
        const plugin = await pluginManager.deactivate(request.params.id);
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
    { preHandler: requirePermission('admin.system') },
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
    { preHandler: requirePermission('admin.system') },
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
        try {
          const entry = registryEntries.find((e) => e.packageName === plugin.packageName);
          if (entry) {
            // Read manifest from installed plugin dir
            const { readFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const manifestPath = join(
              pluginsDir ?? '',
              'node_modules',
              ...plugin.packageName.split('/'),
              'manifest.json',
            );
            const raw = readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(raw) as { configSchema?: readonly ConfigField[] };
            configSchema = manifest.configSchema ?? [];
          }
        } catch {
          // No manifest available — show empty form
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
    { preHandler: requirePermission('admin.system') },
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
}
