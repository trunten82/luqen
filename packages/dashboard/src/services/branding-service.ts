/**
 * Branding Service — centralized branding API interactions.
 *
 * Wraps the low-level branding-client functions with:
 * - Automatic token management via ServiceTokenManager
 * - Graceful degradation when the branding service is unavailable
 */

import type { ServiceTokenManager } from '../auth/service-token.js';
import type { DashboardConfig } from '../config.js';
import {
  listGuidelines,
  getGuideline,
  getGuidelineForSite,
  matchIssues,
  type BrandingGuideline,
  type BrandedIssueResponse,
} from '../branding-client.js';

/**
 * Getter for the current global branding token manager. Receiving a getter
 * rather than a direct reference lets the ServiceClientRegistry hot-swap the
 * underlying token manager without this service caching a stale reference.
 */
export type BrandingTokenManagerGetter = () => ServiceTokenManager | null;

export class BrandingService {
  private readonly getTokenManager: BrandingTokenManagerGetter;
  private readonly brandingUrl: string;

  constructor(config: DashboardConfig, getTokenManager: BrandingTokenManagerGetter) {
    this.brandingUrl = config.brandingUrl;
    this.getTokenManager = getTokenManager;
  }

  private async getToken(): Promise<string> {
    const tm = this.getTokenManager();
    if (tm === null) {
      throw new Error('Branding service is not configured');
    }
    return tm.getToken();
  }

  async listGuidelines(orgId?: string): Promise<BrandingGuideline[]> {
    const token = await this.getToken();
    return listGuidelines(this.brandingUrl, token, orgId);
  }

  async getGuideline(id: string): Promise<BrandingGuideline> {
    const token = await this.getToken();
    return getGuideline(this.brandingUrl, token, id);
  }

  async getGuidelineForSite(siteUrl: string, orgId: string): Promise<BrandingGuideline | null> {
    const token = await this.getToken();
    return getGuidelineForSite(this.brandingUrl, token, siteUrl, orgId);
  }

  async matchIssues(issues: unknown[], siteUrl: string, orgId: string): Promise<BrandedIssueResponse[]> {
    const token = await this.getToken();
    return matchIssues(this.brandingUrl, token, issues, siteUrl, orgId);
  }

  /**
   * Destroying the token manager is the registry's responsibility.
   * This remains as a no-op for API shape compatibility.
   */
  destroy(): void {
    /* owned by ServiceClientRegistry */
  }
}
