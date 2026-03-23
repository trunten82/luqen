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

export class ComplianceService {
  private readonly tokenManager: ServiceTokenManager;
  private readonly complianceUrl: string;

  /** Default cache TTL in milliseconds (5 minutes). */
  private readonly cacheTtlMs: number;

  private jurisdictionCache = new Map<string, CacheEntry<Jurisdiction[]>>();
  private regulationCache = new Map<string, CacheEntry<Regulation[]>>();

  constructor(config: DashboardConfig, tokenManager?: ServiceTokenManager) {
    this.complianceUrl = config.complianceUrl;
    this.cacheTtlMs = 5 * 60 * 1000;

    this.tokenManager = tokenManager ?? new ServiceTokenManager(
      config.complianceUrl,
      config.complianceClientId,
      config.complianceClientSecret,
    );
  }

  // ── Token helpers ────────────────────────────────────────────────────────

  /**
   * Get a valid compliance API token. Uses the ServiceTokenManager's
   * auto-refreshing client_credentials flow internally.
   */
  async getToken(): Promise<string> {
    return this.tokenManager.getToken();
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
    issues: readonly ComplianceIssueInput[],
    orgId?: string,
  ): Promise<ComplianceCheckResult> {
    return checkCompliance(this.complianceUrl, token, jurisdictions, issues, orgId);
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
}
