import type { RemediationEvent, CreateRemediationEventInput } from '../types.js';

/**
 * Append-only store of dated good-faith remediation actions. There is no
 * update/delete by design — the log's evidentiary value depends on it being
 * immutable.
 */
export interface RemediationEventRepository {
  record(data: CreateRemediationEventInput): Promise<RemediationEvent>;
  listForSite(orgId: string, siteUrl: string, limit?: number): Promise<RemediationEvent[]>;
  listForScan(scanId: string): Promise<RemediationEvent[]>;
}
