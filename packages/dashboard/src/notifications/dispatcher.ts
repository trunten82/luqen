import type { FastifyBaseLogger } from 'fastify';
import type { NotificationTemplateRepository } from '../db/interfaces/notification-template-repository.js';
import type { PluginManager } from '../plugins/manager.js';
import type { LuqenEvent, NotificationPlugin } from '../plugins/types.js';
import { renderForChannel } from './render.js';
import type { BrandContextProvider } from './brand-context.js';
import type { LogoCache } from './logo-cache.js';

// ---------------------------------------------------------------------------
// LLM client surface — Phase 50-02.
// Structural typing so dispatcher tests can supply a stub without pulling in
// the full LLMClient (and its OAuth token manager).
// ---------------------------------------------------------------------------

export interface DispatcherLLMClient {
  generateNotificationContent(
    input: {
      readonly template: { readonly subject: string; readonly body: string };
      readonly voice?: string | null;
      readonly signature?: string | null;
      readonly brandContext?: { readonly name: string; readonly voice?: string | null } | null;
      readonly eventData: Record<string, unknown>;
      readonly channel: 'email' | 'slack' | 'teams';
      readonly outputFormat: 'subject' | 'body' | 'both';
      readonly orgId?: string;
    },
    options?: { readonly timeoutMs?: number },
  ): Promise<{
    subject: string;
    body: string;
    model: string;
    provider: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
  } | null>;
}

export interface DispatchAuditWriter {
  log(entry: {
    readonly actor: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly details: Record<string, unknown>;
    readonly orgId?: string | null | undefined;
  }): void | Promise<void>;
}

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
  readonly llmUsed?: boolean;
  readonly llmModel?: string;
  readonly llmLatencyMs?: number;
}

export interface DispatchLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface DispatcherDeps {
  readonly brandContext?: BrandContextProvider;
  readonly logoCache?: LogoCache;
  /**
   * Phase 50-02 — when supplied AND template.llmEnabled is true, the
   * dispatcher will call the LLM service to rewrite the template before
   * channel rendering. Failure (null/timeout/error) silently falls back to
   * deterministic — never blocks delivery.
   */
  readonly llmClient?: DispatcherLLMClient;
  /**
   * Phase 50-02 — when supplied, every dispatch result writes one
   * `notification.dispatch` audit entry with LLM provenance + status.
   */
  readonly audit?: DispatchAuditWriter;
  /**
   * Phase 50-02 — LLM call timeout in ms (default 5000).
   */
  readonly llmTimeoutMs?: number;
  /**
   * Phase 50-02 — used to populate `brandContext.name` when calling the LLM.
   * Optional; if absent the orgId is used as the brand name.
   */
  readonly orgNameLookup?: (orgId: string) => Promise<string | null>;
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
  private readonly llmClient: DispatcherLLMClient | undefined;
  private readonly audit: DispatchAuditWriter | undefined;
  private readonly llmTimeoutMs: number;
  private readonly orgNameLookup: ((orgId: string) => Promise<string | null>) | undefined;

  constructor(
    private readonly templateRepo: NotificationTemplateRepository,
    private readonly pluginManager: PluginManager,
    private readonly logger: DispatchLogger,
    deps: DispatcherDeps = {},
  ) {
    this.brandContext = deps.brandContext;
    this.logoCache = deps.logoCache;
    this.llmClient = deps.llmClient;
    this.audit = deps.audit;
    this.llmTimeoutMs = deps.llmTimeoutMs ?? 5000;
    this.orgNameLookup = deps.orgNameLookup;
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

      // Phase 50-02 — LLM rewrite (gated on template.llmEnabled). Failures
      // (null result OR thrown error) silently fall back to deterministic.
      let workingTemplate = template;
      let llmUsed = false;
      let llmModel: string | undefined;
      let llmLatencyMs: number | undefined;
      if (template.llmEnabled === true && this.llmClient !== undefined) {
        const orgName = this.orgNameLookup !== undefined
          ? (await this.orgNameLookup(orgId).catch(() => null)) ?? orgId
          : orgId;
        try {
          const generated = await this.llmClient.generateNotificationContent(
            {
              template: {
                subject: template.subjectTemplate,
                body: template.bodyTemplate,
              },
              voice: template.voice,
              signature: template.signature,
              brandContext: { name: orgName },
              eventData: event.data ?? {},
              channel,
              outputFormat: 'both',
              orgId,
            },
            { timeoutMs: this.llmTimeoutMs },
          );
          if (generated !== null) {
            workingTemplate = {
              ...template,
              subjectTemplate: generated.subject,
              bodyTemplate: generated.body,
            };
            llmUsed = true;
            llmModel = generated.model;
            llmLatencyMs = generated.latencyMs;
          }
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : 'unknown', templateId: template.id, channel },
            'llm notification rewrite failed — falling back to deterministic',
          );
        }
      }

      const rendered = await renderForChannel(
        workingTemplate,
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

      let dispatchResult: DispatchResult;
      try {
        await (plugin.instance as NotificationPlugin).send(enrichedEvent);
        dispatchResult = {
          channel,
          pluginId: plugin.id,
          templateId: template.id,
          status: 'sent',
          llmUsed,
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(llmLatencyMs !== undefined ? { llmLatencyMs } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        this.logger.warn(
          { err: message, channel, templateId: template.id, pluginId: plugin.id },
          'notification plugin send failed',
        );
        dispatchResult = {
          channel,
          pluginId: plugin.id,
          templateId: template.id,
          status: 'error',
          error: message,
          llmUsed,
          ...(llmModel !== undefined ? { llmModel } : {}),
          ...(llmLatencyMs !== undefined ? { llmLatencyMs } : {}),
        };
        // Continue dispatching to other plugins — a single failure must not
        // block other channels.
      }
      results.push(dispatchResult);

      // Phase 50-02 — audit log entry per dispatch with LLM provenance.
      if (this.audit !== undefined) {
        try {
          await this.audit.log({
            actor: 'system',
            action: 'notification.dispatch',
            resourceType: 'notification_template',
            resourceId: template.id,
            details: {
              channel,
              pluginId: plugin.id,
              status: dispatchResult.status,
              eventType: event.type,
              llmUsed,
              ...(llmModel !== undefined ? { llmModel } : {}),
              ...(llmLatencyMs !== undefined ? { llmLatencyMs } : {}),
              ...(dispatchResult.error !== undefined ? { error: dispatchResult.error } : {}),
            },
            orgId,
          });
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : 'unknown' },
            'notification dispatch audit log failed',
          );
        }
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
