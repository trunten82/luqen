import type {
  AppendManualTestAuditInput,
  ManualTestAuditRecord,
} from '../types.js';

/**
 * Append-only audit trail of manual-test verdict changes (with optional reason).
 *
 * The current verdict lives in {@link ManualTestRepository}; each change appends
 * a row here. Surfaced as per-criterion history on the manual page and
 * summarised in the VPAT/ACR.
 */
export interface ManualTestAuditRepository {
  /** Append one audit row; returns the persisted record. */
  appendAudit(data: AppendManualTestAuditInput): Promise<ManualTestAuditRecord>;
  /** All audit rows for a scan, newest first. */
  listAudit(scanId: string): Promise<ManualTestAuditRecord[]>;
  /** Count of audit rows that carry a non-empty comment, per scan (VPAT summary). */
  countReasonedChanges(scanId: string): Promise<number>;
}
