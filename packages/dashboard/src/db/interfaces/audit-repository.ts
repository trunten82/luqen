import type { AuditEntry, AuditQuery, CreateAuditInput } from '../types.js';

export interface AuditRepository {
  log(entry: CreateAuditInput): Promise<void>;
  query(params: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }>;
}
