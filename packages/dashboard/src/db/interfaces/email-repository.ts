import type { SmtpConfig, SmtpConfigInput, EmailReport, CreateEmailReportInput } from '../types.js';

export interface EmailRepository {
  getSmtpConfig(orgId?: string): Promise<SmtpConfig | null>;
  upsertSmtpConfig(data: SmtpConfigInput): Promise<void>;
  listEmailReports(orgId?: string): Promise<EmailReport[]>;
  getEmailReport(id: string): Promise<EmailReport | null>;
  createEmailReport(data: CreateEmailReportInput): Promise<EmailReport>;
  updateEmailReport(id: string, data: Partial<{
    name: string;
    siteUrl: string;
    recipients: string;
    frequency: string;
    format: string;
    includeCsv: boolean;
    nextSendAt: string;
    lastSentAt: string;
    enabled: boolean;
  }>): Promise<void>;
  deleteEmailReport(id: string): Promise<void>;
  getDueEmailReports(): Promise<EmailReport[]>;
}
