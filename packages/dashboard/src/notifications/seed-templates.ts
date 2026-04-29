import type { NotificationTemplateRepository } from '../db/interfaces/notification-template-repository.js';
import type {
  NotificationChannel,
  NotificationEventType,
  CreateTemplateInput,
} from '../db/types.js';

// ---------------------------------------------------------------------------
// System notification template definitions (Phase 47)
//
// 4 events × 3 channels = 12 system templates. Each uses simple
// {{token}} placeholders that the dispatcher's renderer will fill from
// event.data. Phase 49 replaces these defaults with channel-specific
// formats (Block Kit for Slack, Adaptive Cards for Teams, HTML email).
// ---------------------------------------------------------------------------

interface SystemTemplateDef {
  readonly eventType: NotificationEventType;
  readonly channel: NotificationChannel;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
}

const SYSTEM_TEMPLATES: readonly SystemTemplateDef[] = [
  // ── scan.complete ───────────────────────────────────────────────────────
  {
    eventType: 'scan.complete',
    channel: 'email',
    subjectTemplate: 'Scan complete: {{siteUrl}}',
    bodyTemplate:
      'Your scan of {{siteUrl}} found {{issueCount}} issues. View the report at {{reportUrl}}.',
  },
  {
    eventType: 'scan.complete',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      '*Scan complete* — {{siteUrl}} ({{issueCount}} issues). <{{reportUrl}}|View report>',
  },
  {
    eventType: 'scan.complete',
    channel: 'teams',
    subjectTemplate: '',
    bodyTemplate:
      '{"text":"Scan complete: {{siteUrl}} — {{issueCount}} issues."}',
  },

  // ── scan.failed ─────────────────────────────────────────────────────────
  {
    eventType: 'scan.failed',
    channel: 'email',
    subjectTemplate: 'Scan failed: {{siteUrl}}',
    bodyTemplate:
      'The scan of {{siteUrl}} failed: {{error}}. Scan ID: {{scanId}}.',
  },
  {
    eventType: 'scan.failed',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':warning: *Scan failed* — {{siteUrl}}: {{error}} (scan {{scanId}})',
  },
  {
    eventType: 'scan.failed',
    channel: 'teams',
    subjectTemplate: '',
    bodyTemplate: '{"text":"Scan failed: {{siteUrl}} — {{error}}"}',
  },

  // ── violation.found ─────────────────────────────────────────────────────
  {
    eventType: 'violation.found',
    channel: 'email',
    subjectTemplate: 'New WCAG violation on {{siteUrl}}',
    bodyTemplate:
      'A new {{severity}} violation ({{ruleId}}) was found on {{siteUrl}}: {{description}}',
  },
  {
    eventType: 'violation.found',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':rotating_light: *New {{severity}} violation* on {{siteUrl}}: {{ruleId}} — {{description}}',
  },
  {
    eventType: 'violation.found',
    channel: 'teams',
    subjectTemplate: '',
    bodyTemplate:
      '{"text":"New {{severity}} violation on {{siteUrl}}: {{ruleId}}"}',
  },

  // ── regulation.changed ──────────────────────────────────────────────────
  {
    eventType: 'regulation.changed',
    channel: 'email',
    subjectTemplate: 'Regulation update: {{regulationName}}',
    bodyTemplate:
      'The regulation "{{regulationName}}" ({{jurisdiction}}) was updated. Review the changes at {{regulationUrl}}.',
  },
  {
    eventType: 'regulation.changed',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':books: *Regulation updated* — {{regulationName}} ({{jurisdiction}}). <{{regulationUrl}}|Review>',
  },
  {
    eventType: 'regulation.changed',
    channel: 'teams',
    subjectTemplate: '',
    bodyTemplate:
      '{"text":"Regulation updated: {{regulationName}} ({{jurisdiction}})"}',
  },
];

// ---------------------------------------------------------------------------
// Idempotent seed: insert any system rows that don't already exist.
// Safe to call on every startup. Returns count of rows inserted.
// ---------------------------------------------------------------------------

export async function seedSystemNotificationTemplates(
  repo: NotificationTemplateRepository,
): Promise<number> {
  const existing = await repo.list({ scope: 'system' });
  const existingKeys = new Set(
    existing.map((t) => `${t.eventType}::${t.channel}`),
  );

  let inserted = 0;
  for (const def of SYSTEM_TEMPLATES) {
    const key = `${def.eventType}::${def.channel}`;
    if (existingKeys.has(key)) continue;

    const input: CreateTemplateInput = {
      eventType: def.eventType,
      channel: def.channel,
      scope: 'system',
      orgId: null,
      subjectTemplate: def.subjectTemplate,
      bodyTemplate: def.bodyTemplate,
    };
    await repo.create(input);
    inserted += 1;
  }

  return inserted;
}

export const SYSTEM_TEMPLATE_COUNT = SYSTEM_TEMPLATES.length;
