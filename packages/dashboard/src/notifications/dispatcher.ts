import type { FastifyBaseLogger } from 'fastify';
import type { NotificationTemplateRepository } from '../db/interfaces/notification-template-repository.js';
import type { PluginManager } from '../plugins/manager.js';
import type { LuqenEvent, NotificationPlugin } from '../plugins/types.js';
import { renderForChannel } from './render.js';
import type { BrandContextProvider } from './brand-context.js';
import type { LogoCache } from './logo-cache.js';

// ---------------------------------------------------------------------------
// Dispatcher result types
// ---------------------------------------------------------------------------

export type DispatchStatus =
  | 'sent'
  | 'fallback'
  | 'no-template'
  | 'no-plugin'
  | 'error';

export interface DispatchResult {
  readonly channel: 'email' | 'slack' | 'teams';
  readonly pluginId: string;
  readonly templateId: string;
  readonly status: DispatchStatus;
  readonly error?: string;
}

export interface DispatchLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface DispatcherDeps {
  readonly brandContext?: BrandContextProvider;
  readonly logoCache?: LogoCache;
}

// ---------------------------------------------------------------------------
// NotificationDispatcher
//
// Phase 47 — resolves event → template (org-or-system fallback) → renders
// subject/body via the default token renderer → enriches the event's data
// with `renderedSubject`, `renderedBody`, `templateId`, `templateVersion`,
// `templateScope` → calls the plugin's existing `send(event)` contract.
//
// Phase 49 — additionally enriches the event with channel-specific
// fields (`renderedHtml`, `renderedPlaintext`, `logoAttachment`,
// `brandColor` for email; `renderedBlocks` + `iconUrl` for Slack;
// `renderedAdaptiveCard` + `logoUrl` for Teams). The plugin contract
// (NotificationPlugin.send(event)) is preserved byte-identically. Plugins
// that ignore the new fields keep working with `renderedBody`.
// ---------------------------------------------------------------------------

export class NotificationDispatcher {
  private readonly brandContext: BrandContextProvider | undefined;
  private readonly logoCache: LogoCache | undefined;

  constructor(
    private readonly templateRepo: NotificationTemplateRepository,
    private readonly pluginManager: PluginManager,
    private readonly logger: DispatchLogger,
    deps: DispatcherDeps = {},
  ) {
    this.brandContext = deps.brandContext;
    this.logoCache = deps.logoCache;
  }

  async dispatch(event: LuqenEvent, orgId: string): Promise<DispatchResult[]> {
    const plugins = this.pluginManager.getActiveNotificationPlugins();
    if (plugins.length === 0) return [];

    const results: DispatchResult[] = [];

    // Resolve brand context once per dispatch — same org for every plugin.
    const brand =
      this.brandContext !== undefined
        ? await this.brandContext.get(orgId).catch(() => null)
        : null;

    for (const plugin of plugins) {
      const channel = plugin.channel;
      const template = await this.templateRepo.resolve(
        event.type,
        channel,
        orgId,
      );

      if (template === null) {
        results.push({
          channel,
          pluginId: plugin.id,
          templateId: '',
          status: 'no-template',
        });
        continue;
      }

      const rendered = await renderForChannel(
        template,
        event.data,
        channel,
        brand,
        this.logoCache !== undefined ? { logoCache: this.logoCache } : {},
      );

      const enrichedEvent: LuqenEvent = {
        type: event.type,
        timestamp: event.timestamp,
        data: {
          ...event.data,
          renderedSubject: rendered.subject,
          renderedBody: rendered.body,
          templateId: template.id,
          templateVersion: template.version,
          templateScope: template.scope,
          ...(rendered.html !== undefined ? { renderedHtml: rendered.html } : {}),
          ...(rendered.plaintext !== undefined
            ? { renderedPlaintext: rendered.plaintext }
            : {}),
          ...(rendered.brandColor !== undefined
            ? { brandColor: rendered.brandColor }
            : {}),
          ...(rendered.logoAttachment !== undefined
            ? { logoAttachment: rendered.logoAttachment }
            : {}),
          ...(rendered.logoCid !== undefined ? { logoCid: rendered.logoCid } : {}),
          ...(rendered.blocks !== undefined ? { renderedBlocks: rendered.blocks } : {}),
          ...(rendered.iconUrl !== undefined ? { iconUrl: rendered.iconUrl } : {}),
          ...(rendered.adaptiveCard !== undefined
            ? { renderedAdaptiveCard: rendered.adaptiveCard }
            : {}),
          ...(rendered.logoUrl !== undefined ? { logoUrl: rendered.logoUrl } : {}),
        },
      };

      try {
        await (plugin.instance as NotificationPlugin).send(enrichedEvent);
        results.push({
          channel,
          pluginId: plugin.id,
          templateId: template.id,
          status: 'sent',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(
          { err: message, channel, templateId: template.id, pluginId: plugin.id },
          'notification plugin send failed',
        );
        results.push({
          channel,
          pluginId: plugin.id,
          templateId: template.id,
          status: 'error',
          error: message,
        });
        // Continue dispatching to other plugins — a single failure must not
        // block other channels.
      }
    }

    return results;
  }
}

/**
 * Adapter so callers using `console`-style loggers (or the bare Fastify base
 * logger) can plug straight into the dispatcher without importing logger types.
 */
export function loggerFromFastify(log: FastifyBaseLogger): DispatchLogger {
  return {
    warn: (obj, msg) => log.warn(obj, msg),
  };
}
