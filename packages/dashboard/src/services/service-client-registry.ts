/**
 * ServiceClientRegistry — single owner of the three outbound service clients
 * (compliance, branding, LLM) with runtime hot-swap support.
 *
 * Phase 06 CONTEXT decisions implemented:
 *   - D-07 / D-08 : registry owns the clients; getters return the current
 *                   live reference.
 *   - D-09        : reload(serviceId) reads the latest row, builds a new
 *                   client, atomically swaps, then destroys the old one.
 *                   If construction throws, the old client stays active and
 *                   the error propagates to the caller.
 *   - D-10 / D-11 : server.ts constructs the registry at startup and calls
 *                   destroyAll() from the onClose hook.
 *   - D-14        : per-service fallback — if a service has no DB row, its
 *                   client is built from config values for THAT service only.
 *
 * This module is the ONLY place in the dashboard that directly constructs
 * ServiceTokenManager / LLMClient instances. Every route obtains the current
 * instance via the registry (or via a stable proxy facade — see server.ts).
 */

import type { FastifyBaseLogger } from 'fastify';
import { ServiceTokenManager } from '../auth/service-token.js';
import { createLLMClient, type LLMClient } from '../llm-client.js';
import type {
  ServiceConnectionsRepository,
  ServiceId,
} from '../db/service-connections-repository.js';
import type { DashboardConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Resolved per-service connection (DB row or config fallback, D-14)
// ---------------------------------------------------------------------------

interface ResolvedConnection {
  readonly url: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Resolve a single service connection: prefer DB row, fall back to config
 * values for that specific service. Returns null when neither has a URL.
 */
async function resolveConnection(
  repo: ServiceConnectionsRepository,
  config: DashboardConfig,
  serviceId: ServiceId,
): Promise<ResolvedConnection | null> {
  const row = await repo.get(serviceId);
  if (row !== null && row.url !== '') {
    return {
      url: row.url,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
    };
  }

  // Per-service config fallback (D-14)
  if (serviceId === 'compliance') {
    if (!config.complianceUrl) return null;
    return {
      url: config.complianceUrl,
      clientId: config.complianceClientId,
      clientSecret: config.complianceClientSecret,
    };
  }
  if (serviceId === 'branding') {
    if (!config.brandingUrl) return null;
    return {
      url: config.brandingUrl,
      clientId: config.brandingClientId,
      clientSecret: config.brandingClientSecret,
    };
  }
  // llm
  if (!config.llmUrl) return null;
  return {
    url: config.llmUrl,
    clientId: config.llmClientId,
    clientSecret: config.llmClientSecret,
  };
}

// ---------------------------------------------------------------------------
// ServiceClientRegistry
// ---------------------------------------------------------------------------

export class ServiceClientRegistry {
  /**
   * Current live references. These are swapped atomically inside {@link reload}
   * — routes that capture a reference at module-load time would see stale
   * values, so the recommended pattern is to call the getter per request (or
   * use the proxy facades exposed by server.ts).
   */
  private complianceTokenManager: ServiceTokenManager | null = null;
  private brandingTokenManager: ServiceTokenManager | null = null;
  private llmClient: LLMClient | null = null;

  private constructor(
    private readonly repo: ServiceConnectionsRepository,
    private readonly config: DashboardConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Factory: build the registry and its three clients from the current DB
   * state (with per-service config fallback).
   */
  static async create(
    repo: ServiceConnectionsRepository,
    config: DashboardConfig,
    logger: FastifyBaseLogger,
  ): Promise<ServiceClientRegistry> {
    const reg = new ServiceClientRegistry(repo, config, logger);
    reg.complianceTokenManager = await reg.buildCompliance();
    reg.brandingTokenManager = await reg.buildBranding();
    reg.llmClient = await reg.buildLLM();
    return reg;
  }

  // -------------------------------------------------------------------------
  // Getters — routes should call these per-request, not at registration time.
  // -------------------------------------------------------------------------

  getComplianceTokenManager(): ServiceTokenManager | null {
    return this.complianceTokenManager;
  }

  getBrandingTokenManager(): ServiceTokenManager | null {
    return this.brandingTokenManager;
  }

  getLLMClient(): LLMClient | null {
    return this.llmClient;
  }

  // -------------------------------------------------------------------------
  // Reload — the reason this class exists. Called by the admin save handler
  // after a DB upsert to swap the in-memory client.
  //
  // Exception safety contract (D-09 sub-bullet):
  //   1. Build the new client FIRST. If the builder throws, nothing has
  //      changed and the error propagates to the caller untouched.
  //   2. Only after a successful build do we overwrite the field.
  //   3. After the swap, best-effort destroy the old instance. Failures
  //      during destroy are logged (warn) but do not fail the reload.
  // -------------------------------------------------------------------------

  async reload(serviceId: ServiceId): Promise<void> {
    if (serviceId === 'compliance') {
      const next = await this.buildCompliance(); // may throw → caller sees it
      const old = this.complianceTokenManager;
      this.complianceTokenManager = next;
      this.safeDestroyTokenManager(old, 'compliance');
    } else if (serviceId === 'branding') {
      const next = await this.buildBranding();
      const old = this.brandingTokenManager;
      this.brandingTokenManager = next;
      this.safeDestroyTokenManager(old, 'branding');
    } else if (serviceId === 'llm') {
      const next = await this.buildLLM();
      const old = this.llmClient;
      this.llmClient = next;
      this.safeDestroyLLM(old);
    }

    this.logger.info({ serviceId }, 'Service client reloaded');
  }

  /**
   * Destroy all three clients — called from the server onClose hook (D-11).
   */
  async destroyAll(): Promise<void> {
    this.safeDestroyTokenManager(this.complianceTokenManager, 'compliance');
    this.safeDestroyTokenManager(this.brandingTokenManager, 'branding');
    this.safeDestroyLLM(this.llmClient);
    this.complianceTokenManager = null;
    this.brandingTokenManager = null;
    this.llmClient = null;
  }

  // -------------------------------------------------------------------------
  // Private: builders (DB-first, config-fallback per-service)
  // -------------------------------------------------------------------------

  private async buildCompliance(): Promise<ServiceTokenManager | null> {
    const resolved = await resolveConnection(this.repo, this.config, 'compliance');
    if (resolved === null) return null;
    return new ServiceTokenManager(resolved.url, resolved.clientId, resolved.clientSecret);
  }

  private async buildBranding(): Promise<ServiceTokenManager | null> {
    const resolved = await resolveConnection(this.repo, this.config, 'branding');
    if (resolved === null) return null;
    return new ServiceTokenManager(resolved.url, resolved.clientId, resolved.clientSecret);
  }

  private async buildLLM(): Promise<LLMClient | null> {
    const resolved = await resolveConnection(this.repo, this.config, 'llm');
    if (resolved === null) return null;
    return createLLMClient(resolved.url, resolved.clientId, resolved.clientSecret);
  }

  // -------------------------------------------------------------------------
  // Private: safe destroy helpers (never throw, log on failure)
  // -------------------------------------------------------------------------

  private safeDestroyTokenManager(
    client: ServiceTokenManager | null,
    label: string,
  ): void {
    if (client === null) return;
    try {
      client.destroy();
    } catch (err) {
      this.logger.warn(
        { err, service: label },
        'Failed to destroy old service token manager',
      );
    }
  }

  private safeDestroyLLM(client: LLMClient | null): void {
    if (client === null) return;
    try {
      client.destroy();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to destroy old LLM client');
    }
  }
}
