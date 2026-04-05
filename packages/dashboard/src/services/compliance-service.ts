/**
 * Compliance Service — centralized compliance API interactions.
 *
 * Wraps the low-level compliance-client functions with:
 * - Automatic token management via ServiceTokenManager
 * - In-memory caching of jurisdiction and regulation lookups
 * - Graceful degradation when the compliance service is unavailable
 */

import { ServiceTokenManager } from '../auth/service-token.js';
import type { DashboardConfig } from '../config.js';
import type { OrgRepository } from '../db/interfaces/org-repository.js';
import {
  listJurisdictions,
  listRegulations,
  checkCompliance,
  type Jurisdiction,
  type Regulation,
  type ComplianceIssueInput,
  type ComplianceCheckResult,
} from '../compliance-client.js';

// ── Cache entry type ─────────────────────────────────────────────────────────

interface CacheEntry<T> {
  readonly data: T;
  readonly expiresAt: number;
}

// ── Simplified return types for route consumption ────────────────────────────

export interface JurisdictionSummary {
  readonly id: string;
  readonly name: string;
}

export interface RegulationSummary {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly jurisdictionId: string;
}

export interface ComplianceLookupResult {
  readonly jurisdictions: JurisdictionSummary[];
  readonly regulations: RegulationSummary[];
  readonly warning: string;
}

// ── Service class ────────────────────────────────────────────────────────────

/**
 * Getter function for the current global compliance token manager. Returning
 * a function (rather than a direct reference) lets the ServiceClientRegistry
 * hot-swap the underlying token manager after an admin UI save without the
 * ComplianceService caching a stale reference.
 */
export type ComplianceTokenManagerGetter = () => ServiceTokenManager | null;

export class ComplianceService {
  private readonly getTokenManager: ComplianceTokenManagerGetter;
  private readonly complianceUrl: string;
  private readonly orgRepository?: OrgRepository;

  /** Per-org token managers keyed by orgId. */
  private readonly orgTokenManagers = new Map<string, ServiceTokenManager>();

  /** Default cache TTL in milliseconds (5 minutes). */
  private readonly cacheTtlMs: number;

  private jurisdictionCache = new Map<string, CacheEntry<Jurisdiction[]>>();
  private regulationCache = new Map<string, CacheEntry<Regulation[]>>();

  constructor(
    config: DashboardConfig,
    getTokenManager: ComplianceTokenManagerGetter,
    orgRepository?: OrgRepository,
  ) {
    this.complianceUrl = config.complianceUrl;
    this.cacheTtlMs = 5 * 60 * 1000;
    this.orgRepository = orgRepository;
    this.getTokenManager = getTokenManager;
  }

  // ── Token helpers ────────────────────────────────────────────────────────

  /**
   * Resolve the current global compliance token manager. Throws if no
   * compliance connection is configured (neither DB row nor config fallback).
   */
  private requireTokenManager(): ServiceTokenManager {
    const tm = this.getTokenManager();
    if (tm === null) {
      throw new Error('Compliance service is not configured');
    }
    return tm;
  }

  /**
   * Get a valid compliance API token. Uses the ServiceTokenManager's
   * auto-refreshing client_credentials flow internally.
   */
  async getToken(): Promise<string> {
    return this.requireTokenManager().getToken();
  }

  /**
   * Get a compliance API token scoped to a specific org.
   *
   * Looks up the org's stored compliance client credentials and uses a
   * per-org ServiceTokenManager to get/cache tokens. Falls back to the
   * global service token if the org has no stored credentials.
   */
  async getOrgToken(orgId: string): Promise<string> {
    // Check if we already have a token manager for this org
    const existing = this.orgTokenManagers.get(orgId);
    if (existing !== undefined) {
      return existing.getToken();
    }

    // Look up org credentials from the DB
    if (this.orgRepository === undefined) {
      return this.requireTokenManager().getToken();
    }

    const credentials = await this.orgRepository.getOrgComplianceCredentials(orgId);
    if (credentials === null || credentials.clientId === '' || credentials.clientSecret === '') {
      return this.requireTokenManager().getToken();
    }

    // Create and cache a new token manager for this org
    const orgManager = new ServiceTokenManager(
      this.complianceUrl,
      credentials.clientId,
      credentials.clientSecret,
    );
    this.orgTokenManagers.set(orgId, orgManager);

    return orgManager.getToken();
  }

  // ── Jurisdiction lookups ─────────────────────────────────────────────────

  /**
   * List jurisdictions with caching. Falls back to empty array on failure.
   */
  async listJurisdictions(
    token: string,
    orgId?: string,
  ): Promise<Jurisdiction[]> {
    const cacheKey = `${token}:${orgId ?? ''}`;
    const cached = this.jurisdictionCache.get(cacheKey);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const data = await listJurisdictions(this.complianceUrl, token, orgId);
    this.jurisdictionCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return data;
  }

  /**
   * Safe variant — returns empty array on failure (graceful degradation).
   */
  async safeListJurisdictions(
    token: string,
    orgId?: string,
  ): Promise<Jurisdiction[]> {
    try {
      return await this.listJurisdictions(token, orgId);
    } catch {
      return [];
    }
  }

  // ── Regulation lookups ───────────────────────────────────────────────────

  /**
   * List regulations with caching. Falls back to empty array on failure.
   */
  async listRegulations(
    token: string,
    filters?: Record<string, string>,
    orgId?: string,
  ): Promise<Regulation[]> {
    const filterKey = filters !== undefined ? JSON.stringify(filters) : '';
    const cacheKey = `${token}:${orgId ?? ''}:${filterKey}`;
    const cached = this.regulationCache.get(cacheKey);
    if (cached !== undefined && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const data = await listRegulations(this.complianceUrl, token, filters, orgId);
    this.regulationCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    return data;
  }

  /**
   * Safe variant — returns empty array on failure (graceful degradation).
   */
  async safeListRegulations(
    token: string,
    filters?: Record<string, string>,
    orgId?: string,
  ): Promise<Regulation[]> {
    try {
      return await this.listRegulations(token, filters, orgId);
    } catch {
      return [];
    }
  }

  // ── Combined lookup for scan form ────────────────────────────────────────

  /**
   * Fetch jurisdictions and regulations in parallel. Used by the "New Scan"
   * form. Returns simplified summaries and a warning string if the
   * compliance service is unreachable.
   */
  async getComplianceLookupData(
    token: string,
    orgId?: string,
  ): Promise<ComplianceLookupResult> {
    try {
      const [rawJ, rawR] = await Promise.all([
        this.listJurisdictions(token, orgId),
        this.listRegulations(token, undefined, orgId),
      ]);

      return {
        jurisdictions: rawJ.map((j) => ({ id: j.id, name: j.name })),
        regulations: rawR.map((r) => ({
          id: r.id,
          name: r.name,
          shortName: r.shortName,
          jurisdictionId: r.jurisdictionId,
        })),
        warning: '',
      };
    } catch {
      return {
        jurisdictions: [],
        regulations: [],
        warning:
          'Compliance service is unreachable. Jurisdiction and regulation selection is unavailable. Scans will still work without compliance checking.',
      };
    }
  }

  // ── Issue annotation (compliance check) ──────────────────────────────────

  /**
   * Run a compliance check against the given jurisdictions and issues.
   * Wraps the low-level checkCompliance call.
   */
  async checkCompliance(
    token: string,
    jurisdictions: readonly string[],
    regulations: readonly string[],
    issues: readonly ComplianceIssueInput[],
    orgId?: string,
  ): Promise<ComplianceCheckResult> {
    return checkCompliance(this.complianceUrl, token, jurisdictions, regulations, issues, orgId);
  }

  // ── Cache management ─────────────────────────────────────────────────────

  /**
   * Clear all cached compliance data. Useful after admin mutations
   * (jurisdiction/regulation CRUD).
   */
  clearCache(): void {
    this.jurisdictionCache.clear();
    this.regulationCache.clear();
  }

  /**
   * Destroy all per-org token managers (cleanup on shutdown).
   */
  destroyOrgTokenManagers(): void {
    for (const manager of this.orgTokenManagers.values()) {
      manager.destroy();
    }
    this.orgTokenManagers.clear();
  }
}
