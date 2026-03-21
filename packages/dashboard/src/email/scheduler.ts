import type { ScanDb } from '../db/scans.js';
import type { EmailReport } from '../db/scans.js';
import { sendEmail } from './sender.js';
import { generateReportHtml, generateIssuesCsv, buildEmailBody } from './report-generator.js';
import type { EmailAttachment } from './sender.js';

function computeNextSendAt(frequency: string, fromDate: Date = new Date()): string {
  const next = new Date(fromDate.getTime());
  switch (frequency) {
    case 'daily':
      next.setTime(next.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'weekly':
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'monthly':
      next.setTime(next.getTime() + 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return next.toISOString();
}

export { computeNextSendAt };

export async function processEmailReport(
  db: ScanDb,
  report: EmailReport,
): Promise<void> {
  const smtpConfig = db.getSmtpConfig(report.orgId) ?? db.getSmtpConfig('system');
  if (smtpConfig === null) {
    console.error(`[email-scheduler] No SMTP config found for report ${report.id}`);
    return;
  }

  // Find the latest completed scan for this site URL
  const scans = db.listScans({
    siteUrl: report.siteUrl,
    status: 'completed',
    limit: 1,
  });

  if (scans.length === 0) {
    console.warn(`[email-scheduler] No completed scans found for ${report.siteUrl}, skipping report ${report.id}`);
    return;
  }

  const scan = scans[0];
  const reportPath = scan.jsonReportPath;

  if (reportPath === undefined) {
    console.warn(`[email-scheduler] No JSON report path for scan ${scan.id}, skipping`);
    return;
  }

  // Build attachments
  const attachments: EmailAttachment[] = [];

  const wantsPdf = report.format === 'pdf' || report.format === 'both';
  const wantsCsv = report.format === 'csv' || report.format === 'both' || report.includeCsv;

  if (wantsPdf) {
    const html = await generateReportHtml(scan, reportPath);
    if (html !== null) {
      let hostname: string;
      try {
        hostname = new URL(scan.siteUrl).hostname;
      } catch {
        hostname = scan.siteUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
      }
      attachments.push({
        filename: `pally-report-${hostname}.html`,
        content: html,
        contentType: 'text/html',
      });
    }
  }

  if (wantsCsv) {
    const csv = await generateIssuesCsv(scan, reportPath);
    if (csv !== null) {
      let hostname: string;
      try {
        hostname = new URL(scan.siteUrl).hostname;
      } catch {
        hostname = scan.siteUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
      }
      attachments.push({
        filename: `pally-issues-${hostname}.csv`,
        content: csv,
        contentType: 'text/csv',
      });
    }
  }

  // Build email
  const totalIssues = (scan.errors ?? 0) + (scan.warnings ?? 0) + (scan.notices ?? 0);
  const subject = `Accessibility Report: ${scan.siteUrl} — ${totalIssues} issues (${scan.errors ?? 0} errors)`;
  const recipients = report.recipients
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    console.warn(`[email-scheduler] No valid recipients for report ${report.id}`);
    return;
  }

  const emailBody = buildEmailBody(scan);

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

  // Update next_send_at and last_sent_at
  const now = new Date();
  const nextSendAt = computeNextSendAt(report.frequency, now);
  db.updateEmailReport(report.id, {
    lastSentAt: now.toISOString(),
    nextSendAt,
  });
}

export function startEmailScheduler(
  db: ScanDb,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const due = db.getDueEmailReports();
      if (due.length === 0) return;

      for (const report of due) {
        try {
          await processEmailReport(db, report);
        } catch (err) {
          console.error(
            `[email-scheduler] Failed to send email report ${report.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (err) {
      console.error(
        '[email-scheduler] Error processing due email reports:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, intervalMs);
}
