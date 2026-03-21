import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ScanDb } from '../../db/scans.js';
import type { PluginManager } from '../../plugins/manager.js';
import { adminGuard } from '../../auth/middleware.js';
import { toastHtml, escapeHtml } from './helpers.js';
import { testSmtpConnection } from '../../email/sender.js';
import { processEmailReport } from '../../email/scheduler.js';
import { computeNextSendAt } from '../../email/scheduler.js';

const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];
const VALID_FORMATS = ['pdf', 'csv', 'both'];

const EMAIL_PLUGIN_PACKAGE = '@luqen/plugin-notify-email';

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validateRecipients(recipients: string): string | null {
  const emails = recipients.split(',').map((e) => e.trim()).filter(Boolean);
  if (emails.length === 0) return 'At least one recipient email is required.';
  for (const email of emails) {
    if (!validateEmail(email)) return `Invalid email address: ${email}`;
  }
  return null;
}

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isEmailPluginActive(pluginManager?: PluginManager): boolean {
  if (!pluginManager) return false;
  const instance = pluginManager.getActiveInstanceByPackageName(EMAIL_PLUGIN_PACKAGE);
  return instance !== null;
}

export async function emailReportRoutes(
  server: FastifyInstance,
  db: ScanDb,
  pluginManager?: PluginManager,
): Promise<void> {

  // GET /admin/email-reports — list email reports + config status
  server.get(
    '/admin/email-reports',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const pluginActive = isEmailPluginActive(pluginManager);
      if (!pluginActive) {
        // No legacy smtp_config either — redirect to plugins page
        const orgId = request.user?.currentOrgId ?? 'system';
        const legacySmtp = db.getSmtpConfig(orgId) ?? db.getSmtpConfig('system');
        if (legacySmtp === null) {
          return reply.redirect('/admin/plugins');
        }
      }
      const orgId = request.user?.currentOrgId ?? 'system';
      const reports = db.listEmailReports(orgId);

      // Legacy: check if smtp_config exists for backward compat
      const smtpConfig = db.getSmtpConfig(orgId) ?? db.getSmtpConfig('system');
      const smtpConfigured = pluginActive || smtpConfig !== null;

      const formatted = reports.map((r) => ({
        ...r,
        nextSendAtDisplay: new Date(r.nextSendAt).toLocaleString(),
        lastSentAtDisplay: r.lastSentAt ? new Date(r.lastSentAt).toLocaleString() : 'Never',
        enabledLabel: r.enabled ? 'Active' : 'Disabled',
        enabledClass: r.enabled ? 'badge--success' : 'badge--neutral',
      }));

      return reply.view('admin/email-reports.hbs', {
        pageTitle: 'Email Reports',
        currentPath: '/admin/email-reports',
        user: request.user,
        emailPluginActive: pluginActive,
        smtpConfig: smtpConfig ?? {
          host: '',
          port: 587,
          secure: true,
          username: '',
          password: '',
          fromAddress: '',
          fromName: 'Luqen',
        },
        smtpConfigured,
        reports: formatted,
      });
    },
  );

  // POST /admin/email-reports/smtp — save SMTP config (legacy)
  server.post(
    '/admin/email-reports/smtp',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        host?: string;
        port?: string;
        secure?: string;
        username?: string;
        password?: string;
        fromAddress?: string;
        fromName?: string;
      };

      const host = body.host?.trim();
      const username = body.username?.trim();
      const password = body.password?.trim();
      const fromAddress = body.fromAddress?.trim();

      if (!host) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('SMTP host is required.', 'error'));
      }
      if (!username) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('SMTP username is required.', 'error'));
      }
      if (!password) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('SMTP password is required.', 'error'));
      }
      if (!fromAddress) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('From address is required.', 'error'));
      }

      const port = parseInt(body.port ?? '587', 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Invalid port number.', 'error'));
      }

      const orgId = request.user?.currentOrgId ?? 'system';

      db.upsertSmtpConfig({
        host,
        port,
        secure: body.secure === 'on',
        username,
        password,
        fromAddress,
        fromName: body.fromName?.trim() || 'Luqen',
        orgId,
      });

      return reply.code(200).header('content-type', 'text/html').send(toastHtml('SMTP configuration saved.'));
    },
  );

  // POST /admin/email-reports/smtp/test — test SMTP connection
  server.post(
    '/admin/email-reports/smtp/test',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // If the email plugin is active, use its test method
      if (pluginManager) {
        const instance = pluginManager.getActiveInstanceByPackageName(EMAIL_PLUGIN_PACKAGE);
        if (instance !== null) {
          try {
            const testFn = (instance as unknown as { testConnection: () => Promise<boolean> }).testConnection;
            if (typeof testFn === 'function') {
              const success = await testFn();
              if (success) {
                return reply.code(200).header('content-type', 'text/html').send(toastHtml('SMTP connection successful (via Email plugin).'));
              }
              return reply.code(200).header('content-type', 'text/html').send(toastHtml('SMTP connection failed. Check plugin settings.', 'error'));
            }
          } catch {
            // Fall through to legacy
          }
        }
      }

      // Legacy: use smtp_config from DB
      const orgId = request.user?.currentOrgId ?? 'system';
      const smtpConfig = db.getSmtpConfig(orgId) ?? db.getSmtpConfig('system');

      if (smtpConfig === null) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('No SMTP configuration found. Install and activate the Email Notifications plugin, or save SMTP settings below.', 'error'));
      }

      const success = await testSmtpConnection({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        username: smtpConfig.username,
        password: smtpConfig.password,
        fromAddress: smtpConfig.fromAddress,
        fromName: smtpConfig.fromName,
      });

      if (success) {
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('SMTP connection successful.'));
      }
      return reply.code(200).header('content-type', 'text/html').send(toastHtml('SMTP connection failed. Check your settings.', 'error'));
    },
  );

  // POST /admin/email-reports — create new email report schedule
  server.post(
    '/admin/email-reports',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name?: string;
        siteUrl?: string;
        recipients?: string;
        frequency?: string;
        format?: string;
        includeCsv?: string;
      };

      const name = body.name?.trim();
      const siteUrl = body.siteUrl?.trim();
      const recipients = body.recipients?.trim();
      const frequency = body.frequency?.trim() ?? 'weekly';
      const format = body.format?.trim() ?? 'pdf';

      if (!name) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Report name is required.', 'error'));
      }
      if (!siteUrl || !validateUrl(siteUrl)) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('A valid site URL is required.', 'error'));
      }
      if (!recipients) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('At least one recipient is required.', 'error'));
      }

      const recipientError = validateRecipients(recipients);
      if (recipientError !== null) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml(recipientError, 'error'));
      }

      if (!VALID_FREQUENCIES.includes(frequency)) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Invalid frequency. Must be daily, weekly, or monthly.', 'error'));
      }
      if (!VALID_FORMATS.includes(format)) {
        return reply.code(400).header('content-type', 'text/html').send(toastHtml('Invalid format. Must be pdf, csv, or both.', 'error'));
      }

      const id = randomUUID();
      const orgId = request.user?.currentOrgId ?? 'system';
      const nextSendAt = computeNextSendAt(frequency);

      const report = db.createEmailReport({
        id,
        name,
        siteUrl,
        recipients,
        frequency,
        format,
        includeCsv: body.includeCsv === 'on',
        nextSendAt,
        createdBy: request.user?.username ?? 'unknown',
        orgId,
      });

      // Return a new table row via HTMX
      const row = buildReportRow(report);
      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(`${row}\n${toastHtml('Email report schedule created.')}`);
    },
  );

  // DELETE /admin/email-reports/:id — delete email report
  server.delete(
    '/admin/email-reports/:id',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const report = db.getEmailReport(id);

      if (report === null) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Email report not found.', 'error'));
      }

      db.deleteEmailReport(id);
      return reply.code(200).header('content-type', 'text/html').send(toastHtml('Email report deleted.'));
    },
  );

  // PATCH /admin/email-reports/:id/toggle — enable/disable
  server.patch(
    '/admin/email-reports/:id/toggle',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const report = db.getEmailReport(id);

      if (report === null) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Email report not found.', 'error'));
      }

      const newEnabled = !report.enabled;
      db.updateEmailReport(id, { enabled: newEnabled });

      const updated = db.getEmailReport(id);
      if (updated === null) {
        return reply.code(500).header('content-type', 'text/html').send(toastHtml('Failed to update report.', 'error'));
      }

      const statusBadge = newEnabled
        ? '<span class="badge badge--success">Active</span>'
        : '<span class="badge badge--neutral">Disabled</span>';
      const toggleLabel = newEnabled ? 'Disable' : 'Enable';

      return reply
        .code(200)
        .header('content-type', 'text/html')
        .send(
          `<td data-label="Status" id="status-${escapeHtml(id)}" hx-swap-oob="true">${statusBadge}</td>` +
          `<button hx-patch="/admin/email-reports/${encodeURIComponent(id)}/toggle" ` +
          `hx-target="#report-row-${escapeHtml(id)}" hx-swap="outerHTML" ` +
          `class="btn btn--sm btn--secondary" ` +
          `id="toggle-btn-${escapeHtml(id)}" hx-swap-oob="true">${toggleLabel}</button>` +
          `\n${toastHtml(`Email report ${newEnabled ? 'enabled' : 'disabled'}.`)}`,
        );
    },
  );

  // POST /admin/email-reports/:id/send-now — send immediately for testing
  server.post(
    '/admin/email-reports/:id/send-now',
    { preHandler: adminGuard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const report = db.getEmailReport(id);

      if (report === null) {
        return reply.code(404).header('content-type', 'text/html').send(toastHtml('Email report not found.', 'error'));
      }

      // Check if email sending is configured (plugin or legacy)
      const pluginActive = isEmailPluginActive(pluginManager);
      const orgId = request.user?.currentOrgId ?? 'system';
      const smtpConfig = db.getSmtpConfig(orgId) ?? db.getSmtpConfig('system');

      if (!pluginActive && smtpConfig === null) {
        return reply.code(400).header('content-type', 'text/html').send(
          toastHtml('Email sending is not configured. Install and activate the Email Notifications plugin (Admin > Plugins), or configure SMTP settings.', 'error'),
        );
      }

      try {
        await processEmailReport(db, report, pluginManager);
        return reply.code(200).header('content-type', 'text/html').send(toastHtml('Email report sent successfully.'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send email report';
        return reply.code(500).header('content-type', 'text/html').send(toastHtml(message, 'error'));
      }
    },
  );
}

function buildReportRow(report: {
  id: string;
  name: string;
  siteUrl: string;
  recipients: string;
  frequency: string;
  format: string;
  nextSendAt: string;
  lastSentAt: string | null;
  enabled: boolean;
}): string {
  const eid = escapeHtml(report.id);
  const nextDisplay = new Date(report.nextSendAt).toLocaleString();
  const lastDisplay = report.lastSentAt ? new Date(report.lastSentAt).toLocaleString() : 'Never';
  const statusBadge = report.enabled
    ? '<span class="badge badge--success">Active</span>'
    : '<span class="badge badge--neutral">Disabled</span>';
  const toggleLabel = report.enabled ? 'Disable' : 'Enable';

  return `<tr id="report-row-${eid}">
  <td data-label="Name">${escapeHtml(report.name)}</td>
  <td data-label="Site URL">${escapeHtml(report.siteUrl)}</td>
  <td data-label="Recipients">${escapeHtml(report.recipients)}</td>
  <td data-label="Frequency">${escapeHtml(report.frequency)}</td>
  <td data-label="Format">${escapeHtml(report.format)}</td>
  <td data-label="Next Send">${escapeHtml(nextDisplay)}</td>
  <td data-label="Last Sent">${escapeHtml(lastDisplay)}</td>
  <td data-label="Status" id="status-${eid}">${statusBadge}</td>
  <td>
    <button hx-patch="/admin/email-reports/${encodeURIComponent(report.id)}/toggle"
            hx-target="#report-row-${eid}"
            hx-swap="outerHTML"
            class="btn btn--sm btn--secondary"
            id="toggle-btn-${eid}">${toggleLabel}</button>
    <button hx-post="/admin/email-reports/${encodeURIComponent(report.id)}/send-now"
            hx-target="#toast-container"
            hx-swap="innerHTML"
            class="btn btn--sm btn--secondary"
            aria-label="Send report now">Send Now</button>
    <button hx-delete="/admin/email-reports/${encodeURIComponent(report.id)}"
            hx-confirm="Delete this email report?"
            hx-target="closest tr"
            hx-swap="outerHTML swap:500ms"
            class="btn btn--sm btn--danger"
            aria-label="Delete email report">Delete</button>
  </td>
</tr>`;
}
