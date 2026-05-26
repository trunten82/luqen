import type { ScanRecord, ScanFilters, ScanUpdateData, CreateScanInput } from '../types.js';

export interface ScanRepository {
  createScan(data: CreateScanInput): Promise<ScanRecord>;
  getScan(id: string): Promise<ScanRecord | null>;
  listScans(filters?: ScanFilters): Promise<ScanRecord[]>;
  /**
   * Phase 63.4 — Cursor-paginated list scoped to a single org. Rows are
   * returned in `created_at DESC` order; the cursor is the `created_at`
   * of the last row from the previous page. Backed by the
   * idx_scan_records_org_created composite from migration 071.
   */
  listForOrg(
    orgId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{ items: readonly ScanRecord[]; nextCursor: string | null }>;
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
