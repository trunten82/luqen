import type { DigestSchedule, CreateDigestScheduleInput } from '../types.js';

export interface DigestRepository {
  listDigestSchedules(orgId?: string): Promise<DigestSchedule[]>;
  getDigestSchedule(id: string): Promise<DigestSchedule | null>;
  createDigestSchedule(data: CreateDigestScheduleInput): Promise<DigestSchedule>;
  updateDigestSchedule(id: string, data: Partial<{
    name: string;
    siteUrl: string | null;
    recipients: string;
    frequency: string;
    channels: string;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void>;
  deleteDigestSchedule(id: string): Promise<void>;
  getDueDigestSchedules(): Promise<DigestSchedule[]>;
}
