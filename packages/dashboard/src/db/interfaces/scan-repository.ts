import type { ScanRecord, ScanFilters, ScanUpdateData, CreateScanInput } from '../types.js';

export interface ScanRepository {
  createScan(data: CreateScanInput): Promise<ScanRecord>;
  getScan(id: string): Promise<ScanRecord | null>;
  listScans(filters?: ScanFilters): Promise<ScanRecord[]>;
  countScans(filters?: ScanFilters): Promise<number>;
  updateScan(id: string, data: ScanUpdateData): Promise<ScanRecord>;
  deleteScan(id: string): Promise<void>;
  deleteOrgScans(orgId: string): Promise<void>;
  getReport(id: string): Promise<Record<string, unknown> | null>;
  getTrendData(orgId?: string): Promise<ScanRecord[]>;
  getLatestPerSite(orgId: string): Promise<ScanRecord[]>;
  /**
   * Toggle the public-share flag on a scan. Org-scoped: returns false if the
   * scan does not exist or does not belong to `orgId`. Idempotent.
   * `userId` is recorded for the admin audit trail (Phase 64.1).
   */
  setPublicShare(id: string, orgId: string, enabled: boolean, userId: string): Promise<boolean>;
  /**
   * Most recent completed scan for one specific site within an org.
   * Used by the live badge resolver (Phase 64). Returns null when no
   * completed scan exists for (orgId, siteUrl).
   */
  getLatestCompletedForSite(orgId: string, siteUrl: string): Promise<ScanRecord | null>;
  /**
   * Admin audit (Phase 64.1): every scan with public_share_enabled = 1.
   * Sorted by most-recently-enabled first.
   */
  listPubliclyShared(orgIdFilter?: string): Promise<ScanRecord[]>;
}
