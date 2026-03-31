/**
 * Branding Service — centralized branding API interactions.
 *
 * Wraps the low-level branding-client functions with:
 * - Automatic token management via ServiceTokenManager
 * - Graceful degradation when the branding service is unavailable
 */

import { ServiceTokenManager } from '../auth/service-token.js';
import type { DashboardConfig } from '../config.js';
import {
  listGuidelines,
  getGuideline,
  getGuidelineForSite,
  matchIssues,
  type BrandingGuideline,
  type BrandedIssueResponse,
} from '../branding-client.js';

export class BrandingService {
  private readonly tokenManager: ServiceTokenManager;
  private readonly brandingUrl: string;

  constructor(config: DashboardConfig) {
    this.brandingUrl = config.brandingUrl;
    this.tokenManager = new ServiceTokenManager(
      config.brandingUrl,
      config.brandingClientId,
      config.brandingClientSecret,
    );
  }

  async listGuidelines(orgId?: string): Promise<BrandingGuideline[]> {
    const token = await this.tokenManager.getToken();
    return listGuidelines(this.brandingUrl, token, orgId);
  }

  async getGuideline(id: string): Promise<BrandingGuideline> {
    const token = await this.tokenManager.getToken();
    return getGuideline(this.brandingUrl, token, id);
  }

  async getGuidelineForSite(siteUrl: string, orgId: string): Promise<BrandingGuideline | null> {
    const token = await this.tokenManager.getToken();
    return getGuidelineForSite(this.brandingUrl, token, siteUrl, orgId);
  }

  async matchIssues(issues: unknown[], siteUrl: string, orgId: string): Promise<BrandedIssueResponse[]> {
    const token = await this.tokenManager.getToken();
    return matchIssues(this.brandingUrl, token, issues, siteUrl, orgId);
  }

  destroy(): void {
    this.tokenManager.destroy();
  }
}
