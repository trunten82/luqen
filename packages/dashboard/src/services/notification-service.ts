import type { StorageAdapter } from '../db/index.js';
import type { EmailReport, ScanRecord } from '../db/types.js';
import type { PluginManager } from '../plugins/manager.js';
import { generateIssuesCsv, buildEmailBody } from '../email/report-generator.js';
import { generatePdfFromData } from '../pdf/generator.js';
import type { PdfReportData, PdfScanMeta } from '../pdf/generator.js';
import { normalizeReportData } from './report-service.js';
import type { JsonReportFile } from './report-service.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Legacy import kept for backward compatibility with smtp_config table
import { sendEmail } from '../email/sender.js';
import type { EmailAttachment } from '../email/sender.js';

const EMAIL_PLUGIN_PACKAGE = '@luqen/plugin-notify-email';

// ---------------------------------------------------------------------------
// Build email subject line from scan data
// ---------------------------------------------------------------------------

export function buildEmailSubject(scan: ScanRecord): string {
  const totalIssues = (scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0);
  return `Accessibility Report: ${scan.siteUrl} — ${totalIssues} issues (${scan.errors ?? 0} errors)`;
}

// ---------------------------------------------------------------------------
// Parse recipient string into validated list
// ---------------------------------------------------------------------------

export function parseRecipients(recipients: string): readonly string[] {
  return recipients
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Extract hostname from URL (with fallback for invalid URLs)
// ---------------------------------------------------------------------------

function extractHostname(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
  }
}

// ---------------------------------------------------------------------------
// Build PDF attachment from scan data
// ---------------------------------------------------------------------------

export async function buildPdfAttachment(
  storage: StorageAdapter,
  scan: ScanRecord,
  reportPath: string,
): Promise<EmailAttachment | null> {
  const hostname = extractHostname(scan.siteUrl);

  try {
    let reportJson: JsonReportFile | null = null;
    const dbReport = await storage.scans.getReport(scan.id);
    if (dbReport !== null) {
      reportJson = dbReport as JsonReportFile;
    } else if (reportPath && existsSync(reportPath)) {
      reportJson = JSON.parse(await readFile(reportPath, 'utf-8')) as JsonReportFile;
    }

    if (reportJson === null) return null;

    const reportData = normalizeReportData(reportJson, scan);
    const scanMeta: PdfScanMeta = {
      siteUrl: scan.siteUrl,
      standard: scan.standard,
      jurisdictions: scan.jurisdictions.join(', '),
      createdAtDisplay: new Date(scan.createdAt).toLocaleString(),
    };
    const pdfBuffer = await generatePdfFromData(scanMeta, reportData as PdfReportData);
    return {
      filename: `luqen-report-${hostname}.pdf`,
      content: pdfBuffer.toString('base64'),
      contentType: 'application/pdf',
    };
  } catch (err) {
    console.warn(
      `[notification-service] PDF generation failed for scan ${scan.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build CSV attachment from scan data
// ---------------------------------------------------------------------------

export async function buildCsvAttachment(
  scan: ScanRecord,
  reportPath: string,
): Promise<EmailAttachment | null> {
  const csv = await generateIssuesCsv(scan, reportPath);
  if (csv === null) return null;

  const hostname = extractHostname(scan.siteUrl);
  return {
    filename: `luqen-issues-${hostname}.csv`,
    content: csv,
    contentType: 'text/csv',
  };
}

// ---------------------------------------------------------------------------
// Build all attachments based on report format preferences
// ---------------------------------------------------------------------------

export async function buildAttachments(
  storage: StorageAdapter,
  scan: ScanRecord,
  report: EmailReport,
): Promise<readonly EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];

  const wantsPdf = report.format === 'pdf' || report.format === 'both';
  const wantsCsv = report.format === 'csv' || report.format === 'both' || report.includeCsv;

  const reportPath = scan.jsonReportPath;
  if (reportPath === undefined) return attachments;

  if (wantsPdf) {
    const pdf = await buildPdfAttachment(storage, scan, reportPath);
    if (pdf !== null) {
      attachments.push(pdf);
    }
  }

  if (wantsCsv) {
    const csv = await buildCsvAttachment(scan, reportPath);
    if (csv !== null) {
      attachments.push(csv);
    }
  }

  return attachments;
}

// ---------------------------------------------------------------------------
// Send notification via email plugin or legacy SMTP
// ---------------------------------------------------------------------------

export async function sendNotification(
  storage: StorageAdapter,
  report: EmailReport,
  recipients: readonly string[],
  subject: string,
  emailBody: string,
  attachments: readonly EmailAttachment[],
  pluginManager?: PluginManager,
): Promise<void> {
  const emailPlugin = pluginManager?.getActiveInstanceByPackageName(EMAIL_PLUGIN_PACKAGE);

  if (emailPlugin !== undefined && emailPlugin !== null) {
    // Plugin is active -- use it to send
    const pluginSendReport = (emailPlugin as unknown as {
      sendReport: (opts: {
        to: readonly string[];
        subject: string;
        html: string;
        attachments?: readonly EmailAttachment[];
      }) => Promise<void>;
    }).sendReport;

    if (typeof pluginSendReport === 'function') {
      await pluginSendReport({ to: recipients, subject, html: emailBody, attachments });
    } else {
      throw new Error('Email plugin does not expose sendReport method');
    }
  } else {
    // Fallback: use legacy smtp_config from dashboard DB
    const smtpConfig =
      await storage.email.getSmtpConfig(report.orgId) ??
      await storage.email.getSmtpConfig('system');

    if (smtpConfig === null) {
      throw new Error(`No email plugin active and no SMTP config found for report ${report.id}`);
    }

    await sendEmail({
      smtp: {
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        username: smtpConfig.username,
        password: smtpConfig.password,
        fromAddress: smtpConfig.fromAddress,
        fromName: smtpConfig.fromName,
      },
      to: recipients,
      subject,
      html: emailBody,
      attachments,
    });
  }
}
