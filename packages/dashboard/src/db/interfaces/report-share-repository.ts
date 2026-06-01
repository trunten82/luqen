import type { AddReportShareInput, ReportShareRecord } from '../types.js';

/**
 * Secure external report shares. Each row authorises anonymous, token-based
 * access to one scan's VPAT/ACR + evidence pack until it expires or is revoked.
 * The token is the secret carried in the /share/:token URL — never the scan id.
 */
export interface ReportShareRepository {
  /** Create a share link; returns the persisted record (incl. the token). */
  createShare(data: AddReportShareInput): Promise<ReportShareRecord>;
  /** Look up a share by its token (null when absent). */
  getByToken(token: string): Promise<ReportShareRecord | null>;
  /** A single share by id (null when absent). */
  getShare(id: string): Promise<ReportShareRecord | null>;
  /** All shares for a scan, newest first. */
  listForScan(scanId: string): Promise<ReportShareRecord[]>;
  /** Mark a share revoked; returns true when a row was updated. */
  revoke(id: string): Promise<boolean>;
}
