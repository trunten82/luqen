import type { StorageAdapter } from '../db/index.js';
import type { EmailReport } from '../db/types.js';
import type { PluginManager } from '../plugins/manager.js';
import { buildEmailBody } from './report-generator.js';
import {
  buildEmailSubject,
  parseRecipients,
  buildAttachments,
  sendNotification,
} from '../services/notification-service.js';

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
  storage: StorageAdapter,
  report: EmailReport,
  pluginManager?: PluginManager,
): Promise<void> {
  // Find the latest completed scan for this site URL
  const scans = await storage.scans.listScans({
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

  // Build attachments via notification service
  const attachments = await buildAttachments(storage, scan, report);

  // Build email content
  const subject = buildEmailSubject(scan);
  const recipients = parseRecipients(report.recipients);

  if (recipients.length === 0) {
    console.warn(`[email-scheduler] No valid recipients for report ${report.id}`);
    return;
  }

  const emailBody = buildEmailBody(scan);

  // Send via notification service (plugin or legacy SMTP)
  try {
    await sendNotification(storage, report, recipients, subject, emailBody, attachments, pluginManager);
  } catch (err) {
    console.error(
      `[email-scheduler] ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Update next_send_at and last_sent_at
  const now = new Date();
  const nextSendAt = computeNextSendAt(report.frequency, now);
  await storage.email.updateEmailReport(report.id, {
    lastSentAt: now.toISOString(),
    nextSendAt,
  });
}

export function startEmailScheduler(
  storage: StorageAdapter,
  pluginManager?: PluginManager,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const due = await storage.email.getDueEmailReports();
      if (due.length === 0) return;

      for (const report of due) {
        try {
          await processEmailReport(storage, report, pluginManager);
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
