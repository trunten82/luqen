import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmailClient, type EmailAttachment } from './email-client.js';

// Local interface definitions (compatible with dashboard's NotificationPlugin)
interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'secret' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly options?: readonly string[];
}

interface PluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'auth' | 'notification' | 'storage' | 'scanner';
  readonly version: string;
  readonly description: string;
  readonly configSchema: readonly ConfigField[];
}

interface LuqenEvent {
  readonly type: 'scan.complete' | 'scan.failed' | 'violation.found' | 'regulation.changed';
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface SendReportOptions {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly attachments?: readonly EmailAttachment[];
}

export type { EmailAttachment };

// -- Manifest ----------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const manifestPath = resolve(__dirname, '..', 'manifest.json');
const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
export const manifest: PluginManifest = Object.freeze(rawManifest);

// -- State -------------------------------------------------------------------

let client: EmailClient | null = null;
let enabledEvents: Set<string> = new Set();
let fromAddress = '';
let fromName = 'Luqen';

// -- Lifecycle ---------------------------------------------------------------

export async function activate(config: Readonly<Record<string, unknown>>): Promise<void> {
  const host = config.host as string | undefined;
  const username = config.username as string | undefined;
  const password = config.password as string | undefined;
  const from = config.fromAddress as string | undefined;

  if (!host || host === '') {
    throw new Error('SMTP host is required');
  }
  if (!username || username === '') {
    throw new Error('SMTP username is required');
  }
  if (!password || password === '') {
    throw new Error('SMTP password is required');
  }
  if (!from || from === '') {
    throw new Error('From email address is required');
  }

  const port = (config.port as number | undefined) ?? 587;
  const secure = (config.secure as boolean | undefined) ?? true;

  fromAddress = from;
  fromName = (config.fromName as string | undefined) ?? 'Luqen';

  const events = (config.events as string | undefined) ?? 'scan.complete,scan.failed';
  enabledEvents = new Set(events.split(',').map((e) => e.trim()));

  client = new EmailClient({ host, port, secure, username, password });

  // Verify the SMTP connection on activation
  const ok = await client.testConnection();
  if (!ok) {
    client.close();
    client = null;
    throw new Error('SMTP connection verification failed — check your credentials and host settings');
  }
}

export async function deactivate(): Promise<void> {
  if (client !== null) {
    client.close();
    client = null;
  }
  enabledEvents = new Set();
  fromAddress = '';
  fromName = 'Luqen';
}

export async function healthCheck(): Promise<boolean> {
  if (client === null) return false;
  return client.testConnection();
}

// -- Notification (scan events) ----------------------------------------------

export async function send(event: LuqenEvent): Promise<void> {
  if (client === null) {
    throw new Error('Email plugin is not activated');
  }

  if (!enabledEvents.has(event.type)) {
    return; // Event type not enabled, skip silently
  }

  const { subject, html } = formatEvent(event);
  const recipients = (event.data.recipients as string | undefined) ?? fromAddress;

  await client.send({
    from: `"${fromName}" <${fromAddress}>`,
    to: recipients,
    subject,
    html,
  });
}

// -- Report sending (called by dashboard scheduler) --------------------------

export async function sendReport(options: SendReportOptions): Promise<void> {
  if (client === null) {
    throw new Error('Email plugin is not activated');
  }

  await client.send({
    from: `"${fromName}" <${fromAddress}>`,
    to: options.to.join(', '),
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  });
}

// -- SMTP connection test (used by dashboard routes) -------------------------

export async function testConnection(): Promise<boolean> {
  if (client === null) {
    throw new Error('Email plugin is not activated');
  }
  return client.testConnection();
}

// -- Formatting --------------------------------------------------------------

function formatEvent(event: LuqenEvent): { subject: string; html: string } {
  const data = event.data;

  switch (event.type) {
    case 'scan.complete': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const issues = (data.totalIssues as number) ?? 0;
      const pages = (data.pagesScanned as number) ?? 0;
      return {
        subject: `Scan Complete: ${url} - ${issues} issues found`,
        html: buildNotificationHtml(
          'Scan Complete',
          `<p><strong>URL:</strong> ${escapeHtml(url)}</p>` +
          `<p><strong>Pages scanned:</strong> ${pages}</p>` +
          `<p><strong>Issues found:</strong> ${issues}</p>` +
          `<p><strong>Time:</strong> ${escapeHtml(event.timestamp)}</p>`,
        ),
      };
    }
    case 'scan.failed': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const error = (data.error as string) ?? 'Unknown error';
      return {
        subject: `Scan Failed: ${url}`,
        html: buildNotificationHtml(
          'Scan Failed',
          `<p><strong>URL:</strong> ${escapeHtml(url)}</p>` +
          `<p><strong>Error:</strong> ${escapeHtml(error)}</p>`,
        ),
      };
    }
    case 'violation.found': {
      const criterion = (data.wcagCriterion as string) ?? 'Unknown';
      const count = (data.count as number) ?? 1;
      return {
        subject: `Violation Found: ${criterion} (${count} occurrences)`,
        html: buildNotificationHtml(
          'Violation Found',
          `<p><strong>Criterion:</strong> ${escapeHtml(criterion)}</p>` +
          `<p><strong>Count:</strong> ${count}</p>`,
        ),
      };
    }
    case 'regulation.changed': {
      const regulation = (data.regulationName as string) ?? 'Unknown';
      const change = (data.summary as string) ?? 'Details unavailable';
      return {
        subject: `Regulation Changed: ${regulation}`,
        html: buildNotificationHtml(
          'Regulation Changed',
          `<p><strong>Regulation:</strong> ${escapeHtml(regulation)}</p>` +
          `<p><strong>Change:</strong> ${escapeHtml(change)}</p>`,
        ),
      };
    }
  }
}

function buildNotificationHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f5f6fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
  <div style="background: #0056b3; color: #ffffff; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700;">${escapeHtml(title)}</h1>
  </div>
  <div style="padding: 24px; font-size: 14px; color: #333;">
    ${body}
  </div>
  <div style="background: #f5f6fa; padding: 16px; text-align: center; font-size: 12px; color: #6b6b6b; border-top: 1px solid #e0e0e0;">
    Sent by Luqen — Email Notifications Plugin
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
