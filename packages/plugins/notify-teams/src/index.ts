import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TeamsClient, type TeamsMessageCard } from './teams-client.js';

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

// ── Theme Colors ────────────────────────────────────────────────────────────

const THEME_COLORS: Record<string, string> = {
  'scan.complete': '00C851',
  'scan.failed': 'FF4444',
  'violation.found': 'FF8800',
  'regulation.changed': '0078D7',
};

// ── Manifest ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const manifestPath = resolve(__dirname, '..', 'manifest.json');
const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
export const manifest: PluginManifest = Object.freeze(rawManifest);

// ── State ───────────────────────────────────────────────────────────────────

let client: TeamsClient | null = null;
let enabledEvents: Set<string> = new Set();

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function activate(config: Readonly<Record<string, unknown>>): Promise<void> {
  const webhookUrl = config.webhookUrl as string | undefined;
  if (webhookUrl == null || webhookUrl === '') {
    throw new Error('Teams webhookUrl is required');
  }

  const events = (config.events as string | undefined) ?? 'scan.complete,scan.failed,violation.found,regulation.changed';

  client = new TeamsClient(webhookUrl);
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
    throw new Error('Teams plugin is not activated');
  }

  if (!enabledEvents.has(event.type)) {
    return; // Event type not enabled, skip silently
  }

  const card = formatEvent(event);
  await client.send(card);
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatEvent(event: LuqenEvent): TeamsMessageCard {
  const data = event.data;
  const themeColor = THEME_COLORS[event.type] ?? '0078D7';

  switch (event.type) {
    case 'scan.complete': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const issues = (data.totalIssues as number) ?? 0;
      const pages = (data.pagesScanned as number) ?? 0;
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: `Scan complete: ${url} — ${issues} issues found across ${pages} pages`,
        themeColor,
        title: 'Scan Complete',
        sections: [
          {
            activityTitle: 'Scan Results',
            facts: [
              { name: 'URL', value: url },
              { name: 'Pages', value: String(pages) },
              { name: 'Issues', value: String(issues) },
              { name: 'Time', value: event.timestamp },
            ],
          },
        ],
      };
    }
    case 'scan.failed': {
      const url = (data.siteUrl as string) ?? 'Unknown URL';
      const error = (data.error as string) ?? 'Unknown error';
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: `Scan failed: ${url} — ${error}`,
        themeColor,
        title: 'Scan Failed',
        sections: [
          {
            activityTitle: 'Failure Details',
            facts: [
              { name: 'URL', value: url },
              { name: 'Error', value: error },
            ],
          },
        ],
      };
    }
    case 'violation.found': {
      const criterion = (data.wcagCriterion as string) ?? 'Unknown';
      const count = (data.count as number) ?? 1;
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: `Violation found: ${criterion} (${count} occurrences)`,
        themeColor,
        title: 'Violation Found',
        sections: [
          {
            activityTitle: 'Violation Details',
            facts: [
              { name: 'Criterion', value: criterion },
              { name: 'Count', value: String(count) },
            ],
          },
        ],
      };
    }
    case 'regulation.changed': {
      const regulation = (data.regulationName as string) ?? 'Unknown';
      const change = (data.summary as string) ?? 'Details unavailable';
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: `Regulation changed: ${regulation} — ${change}`,
        themeColor,
        title: 'Regulation Changed',
        sections: [
          {
            activityTitle: 'Regulation Update',
            facts: [
              { name: 'Regulation', value: regulation },
              { name: 'Change', value: change },
            ],
          },
        ],
      };
    }
  }
}
