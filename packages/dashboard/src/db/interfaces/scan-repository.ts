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
}
