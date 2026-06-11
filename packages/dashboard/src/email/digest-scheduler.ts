/**
 * Digest sweep scheduler for scheduled executive digests.
 *
 * Mirrors the email scheduler pattern (email/scheduler.ts):
 *   - computeNextDigestSendAt: +7d weekly, +30d monthly
 *   - processDigest: per-schedule fan-out to opt-in channels
 *   - startDigestScheduler: setInterval with .unref()
 *
 * D-09 — resilient degradation:
 *   - Each channel is wrapped in its own try/catch (log + continue on error)
 *   - nextSendAt/lastSentAt are ALWAYS advanced after the channel loop,
 *     even on partial failure — a misconfigured channel CANNOT wedge the schedule
 *
 * D-08 — Slack/Teams get text summary + dashboard link only (no file attachment)
 *
 * Conservative framing (D-06/D-12):
 *   - Band expressed as icon+label in all messages
 *   - Disclaimer line in every Slack/Teams message
 *   - No forbidden words
 */

import type { StorageAdapter } from '../db/index.js';
import type { DigestSchedule, EmailReport } from '../db/types.js';
import type { PluginManager } from '../plugins/manager.js';
import { buildDigestEmailBody } from './digest-email-builder.js';
import { parseRecipients, sendNotification } from '../services/notification-service.js';
import { buildDigestPdfAttachment } from '../pdf/digest-generator.js';
import { buildDigest } from '../services/digest-service.js';
import type { DigestData, SiteDelta } from '../services/digest-service.js';
import type { ExposureBand } from '../services/legal-exposure.js';

// Plugin package names for Slack/Teams notify plugins
const SLACK_PLUGIN = '@luqen/plugin-notify-slack';
const TEAMS_PLUGIN = '@luqen/plugin-notify-teams';

// ---------------------------------------------------------------------------
// computeNextDigestSendAt — mirrors scheduler.ts computeNextSendAt
// digest only needs weekly | monthly
// ---------------------------------------------------------------------------

export function computeNextDigestSendAt(frequency: string, fromDate: Date = new Date()): string {
  const next = new Date(fromDate.getTime());
  switch (frequency) {
    case 'weekly':
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'monthly':
      next.setTime(next.getTime() + 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      // Fallback to weekly (conservative)
      next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// buildDigestSubject — conservative subject line (no "report"/"compliance")
// ---------------------------------------------------------------------------

function buildDigestSubject(schedule: DigestSchedule, period: { start: string; end: string }): string {
  const name = schedule.name;
  const startDate = new Date(period.start).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const endDate = new Date(period.end).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  // Conservative: "Accessibility Digest" not "compliance report"
  return `${name} — Accessibility Digest: ${startDate} – ${endDate}`;
}

// ---------------------------------------------------------------------------
// Slack / Teams message builders
// Band expressed as icon+label; disclaimer required in every message (D-08/D-12)
// ---------------------------------------------------------------------------

const BAND_ICON: Record<ExposureBand, string> = {
  lower:    '● ',
  moderate: '▲ ',
  elevated: '▲▲ ',
  high:     '⬛ ',
};

const BAND_LABEL: Record<ExposureBand, string> = {
  lower:    'Lower',
  moderate: 'Moderate',
  elevated: 'Elevated',
  high:     'High',
};

function formatBand(band: ExposureBand): string {
  return BAND_ICON[band] + BAND_LABEL[band];
}

function formatDirection(direction: SiteDelta['direction']): string {
  switch (direction) {
    case 'worsened': return '▲ Worsened';
    case 'improved': return '▼ Improved';
    default: return '— Unchanged';
  }
}

function buildSlackMessage(data: DigestData, digestViewUrl: string): string {
  const { period, sites } = data;
  const startDate = new Date(period.start).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const endDate = new Date(period.end).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const totalErrorsDelta = sites.reduce((s, site) => s + site.errorsDelta, 0);
  const totalWarningsDelta = sites.reduce((s, site) => s + site.warningsDelta, 0);
  const totalNoticesDelta = sites.reduce((s, site) => s + site.noticesDelta, 0);

  const errDeltaStr = totalErrorsDelta > 0 ? `+${totalErrorsDelta}` : String(totalErrorsDelta);
  const warnDeltaStr = totalWarningsDelta > 0 ? `+${totalWarningsDelta}` : String(totalWarningsDelta);
  const noticeDeltaStr = totalNoticesDelta > 0 ? `+${totalNoticesDelta}` : String(totalNoticesDelta);

  // Top 5 sites by exposure
  const topSites = sites.slice(0, 5);
  const riskLines = topSites.map((site) => {
    const bandStr = site.currentExposure !== null
      ? formatBand(site.currentExposure.band)
      : '(no data)';
    return `${bandStr} — ${site.siteUrl} ${formatDirection(site.direction)}`;
  }).join('\n');

  return (
    `*Accessibility Digest*\n` +
    `Period: ${startDate} – ${endDate}\n\n` +
    `*What changed:* ${errDeltaStr} errors · ${warnDeltaStr} warnings · ${noticeDeltaStr} notices\n\n` +
    `*What's at risk:*\n${riskLines}\n\n` +
    `<${digestViewUrl}|View full digest on dashboard>\n\n` +
    `_This is a legal exposure indicator, not legal advice._`
  );
}

function buildTeamsMessage(data: DigestData, digestViewUrl: string): string {
  const { period, sites } = data;
  const startDate = new Date(period.start).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const endDate = new Date(period.end).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const totalErrorsDelta = sites.reduce((s, site) => s + site.errorsDelta, 0);
  const totalWarningsDelta = sites.reduce((s, site) => s + site.warningsDelta, 0);
  const totalNoticesDelta = sites.reduce((s, site) => s + site.noticesDelta, 0);

  const errDeltaStr = totalErrorsDelta > 0 ? `+${totalErrorsDelta}` : String(totalErrorsDelta);
  const warnDeltaStr = totalWarningsDelta > 0 ? `+${totalWarningsDelta}` : String(totalWarningsDelta);
  const noticeDeltaStr = totalNoticesDelta > 0 ? `+${totalNoticesDelta}` : String(totalNoticesDelta);

  const topSites = sites.slice(0, 5);
  const riskLines = topSites.map((site) => {
    const bandStr = site.currentExposure !== null
      ? formatBand(site.currentExposure.band)
      : '(no data)';
    return `${bandStr} — ${site.siteUrl} ${formatDirection(site.direction)}`;
  }).join('\n');

  return (
    `**Accessibility Digest**\n` +
    `Period: ${startDate} – ${endDate}\n\n` +
    `**What changed:** ${errDeltaStr} errors · ${warnDeltaStr} warnings · ${noticeDeltaStr} notices\n\n` +
    `**What's at risk:**\n${riskLines}\n\n` +
    `[View full digest](${digestViewUrl})\n\n` +
    `*This is a legal exposure indicator, not legal advice.*`
  );
}

// ---------------------------------------------------------------------------
// processDigest — per-schedule delivery with isolated channel failures (D-09)
// ---------------------------------------------------------------------------

export async function processDigest(
  storage: StorageAdapter,
  schedule: DigestSchedule,
  pluginManager?: PluginManager,
): Promise<void> {
  const periodEnd = new Date();
  const periodStart = schedule.lastSentAt !== null && schedule.lastSentAt !== undefined
    ? new Date(schedule.lastSentAt)
    : new Date(schedule.createdAt);    // first run: since creation

  const digestData: DigestData = await buildDigest(
    storage,
    { orgId: schedule.orgId, siteUrl: schedule.siteUrl },
    { start: periodStart.toISOString(), end: periodEnd.toISOString() },
  );

  const channels = schedule.channels;
  const dashboardUrl = process.env['DASHBOARD_PUBLIC_URL'] ?? 'https://dashboard.luqen.local';
  const digestViewUrl = `${dashboardUrl}/admin/digest-schedules`;

  // ── Email channel ──────────────────────────────────────────────────────────
  if (channels.includes('email')) {
    const recipients = parseRecipients(schedule.recipients);
    if (recipients.length > 0) {
      const subject = buildDigestSubject(schedule, digestData.period);
      // buildDigestPdfAttachment: returns null if PDF generation fails (logged internally)
      const pdfAttachment = await buildDigestPdfAttachment(digestData, schedule);
      const attachments = pdfAttachment !== null ? [pdfAttachment] : [];
      const emailBody = buildDigestEmailBody(digestData);

      // CRITICAL: sendNotification 2nd arg is a MINIMAL adapter object.
      // sendNotification reads ONLY report.orgId (for unsubscribe-suppression lookup).
      // Recipients are NOT read from the report — they are supplied SEPARATELY as 3rd arg.
      // Because we pass our own attachments array directly as 6th arg, buildAttachments
      // is never invoked on this path (report.format=undefined yields wantsPdf/wantsCsv=false
      // in any inspecting code — harmless).
      const reportAdapter = { orgId: schedule.orgId, id: schedule.id } as unknown as EmailReport;

      try {
        await sendNotification(
          storage,
          reportAdapter,
          recipients,
          subject,
          emailBody,
          attachments,
          pluginManager,
        );
      } catch (err) {
        console.error(
          `[digest-scheduler] email channel failed for ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // D-09: channel failure does not block other channels or nextSendAt advance
      }
    }
  }

  // ── Slack channel ──────────────────────────────────────────────────────────
  // D-08: text summary + dashboard link only — no file attachment
  if (channels.includes('slack')) {
    const slackPlugin = pluginManager?.getActiveInstanceByPackageName(SLACK_PLUGIN);
    if (slackPlugin !== null && slackPlugin !== undefined) {
      try {
        const message = buildSlackMessage(digestData, digestViewUrl);
        await (slackPlugin as unknown as { send: (arg: unknown) => Promise<void> }).send({
          type: 'digest.summary',
          timestamp: new Date().toISOString(),
          data: { text: message, renderedBody: message },
        });
      } catch (err) {
        console.error(
          `[digest-scheduler] slack channel failed for ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // D-09: skip, do not fail the whole run
      }
    }
  }

  // ── Teams channel ──────────────────────────────────────────────────────────
  // D-08: text summary + dashboard link only — no file attachment
  if (channels.includes('teams')) {
    const teamsPlugin = pluginManager?.getActiveInstanceByPackageName(TEAMS_PLUGIN);
    if (teamsPlugin !== null && teamsPlugin !== undefined) {
      try {
        const message = buildTeamsMessage(digestData, digestViewUrl);
        await (teamsPlugin as unknown as { send: (arg: unknown) => Promise<void> }).send({
          type: 'digest.summary',
          timestamp: new Date().toISOString(),
          data: { text: message, renderedBody: message },
        });
      } catch (err) {
        console.error(
          `[digest-scheduler] teams channel failed for ${schedule.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // D-09: skip, do not fail the whole run
      }
    }
  }

  // ── Advance nextSendAt/lastSentAt regardless of partial delivery (D-09) ───
  // This MUST run after the channel loop, even when channels failed.
  // A failing channel CANNOT wedge the schedule into a resend loop.
  const now = new Date();
  const nextSendAt = computeNextDigestSendAt(schedule.frequency, now);
  if (storage.digest !== undefined) {
    await storage.digest.updateDigestSchedule(schedule.id, {
      lastSentAt: now.toISOString(),
      nextSendAt,
    });
  }
}

// ---------------------------------------------------------------------------
// startDigestScheduler — mirrors startEmailScheduler (scheduler.ts lines 90-117)
// ---------------------------------------------------------------------------

export function startDigestScheduler(
  storage: StorageAdapter,
  pluginManager?: PluginManager,
  intervalMs = 60_000,
): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const due = await storage.digest?.getDueDigestSchedules() ?? [];
      if (due.length === 0) return;

      for (const schedule of due) {
        try {
          await processDigest(storage, schedule, pluginManager);
        } catch (err) {
          console.error(
            `[digest-scheduler] Failed for schedule ${schedule.id}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } catch (err) {
      console.error(
        '[digest-scheduler] Error processing due digests:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, intervalMs);

  timer.unref();  // don't block process exit (mirrors scheduler.ts)
  return timer;
}
