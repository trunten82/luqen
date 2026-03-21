import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SlackClient, type SlackMessage } from './slack-client.js';

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

// ── Manifest ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const manifestPath = resolve(__dirname, '..', 'manifest.json');
const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
export const manifest: PluginManifest = Object.freeze(rawManifest);

// ── State ───────────────────────────────────────────────────────────────────

let client: SlackClient | null = null;
let enabledEvents: Set<string> = new Set();

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function activate(config: Readonly<Record<string, unknown>>): Promise<void> {
  const webhookUrl = config.webhookUrl as string | undefined;
  if (webhookUrl == null || webhookUrl === '') {
    throw new Error('Slack webhookUrl is required');
  }

  const channel = (config.channel as string | undefined) ?? '#accessibility';
  const username = (config.username as string | undefined) ?? 'Luqen Agent';
  const events = (config.events as string | undefined) ?? 'scan.complete,scan.failed,violation.found,regulation.changed';

  client = new SlackClient(webhookUrl, channel, username);
  enabledEvents = new Set(events.split(',').map((e) => e.trim()));
}

export async function deactivate(): Promise<void> {
  client = null;
  enabledEvents = new Set();
}

export async function healthCheck(): Promise<boolean> {
  if (client === null) return false;
  return client.testConnection();
}

// ── Notification ────────────────────────────────────────────────────────────

export async function send(event: LuqenEvent): Promise<void> {
  if (client === null) {
    throw new Error('Slack plugin is not activated');
  }

  if (!enabledEvents.has(event.type)) {
    return; // Event type not enabled, skip silently
  }

  const message = formatEvent(event);
  await client.send(message);
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatEvent(event: LuqenEvent): SlackMessage {
  const data = event.data;

  switch (event.type) {
    case 'scan.complete': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const issues = (data.totalIssues as number) ?? 0;
      const pages = (data.pagesScanned as number) ?? 0;
      return {
        text: `Scan complete: ${url} — ${issues} issues found across ${pages} pages`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Scan Complete' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*URL:* ${url}` },
              { type: 'mrkdwn', text: `*Pages:* ${pages}` },
              { type: 'mrkdwn', text: `*Issues:* ${issues}` },
              { type: 'mrkdwn', text: `*Time:* ${event.timestamp}` },
            ],
          },
        ],
      };
    }
    case 'scan.failed': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const error = (data.error as string) ?? 'Unknown error';
      return {
        text: `Scan failed: ${url} — ${error}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Scan Failed' } },
          { type: 'section', text: { type: 'mrkdwn', text: `*URL:* ${url}\n*Error:* ${error}` } },
        ],
      };
    }
    case 'violation.found': {
      const criterion = (data.wcagCriterion as string) ?? 'Unknown';
      const count = (data.count as number) ?? 1;
      return {
        text: `Violation found: ${criterion} (${count} occurrences)`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Violation Found' } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Criterion:* ${criterion}\n*Count:* ${count}` } },
        ],
      };
    }
    case 'regulation.changed': {
      const regulation = (data.regulationName as string) ?? 'Unknown';
      const change = (data.summary as string) ?? 'Details unavailable';
      return {
        text: `Regulation changed: ${regulation} — ${change}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Regulation Changed' } },
          { type: 'section', text: { type: 'mrkdwn', text: `*Regulation:* ${regulation}\n*Change:* ${change}` } },
        ],
      };
    }
  }
}
