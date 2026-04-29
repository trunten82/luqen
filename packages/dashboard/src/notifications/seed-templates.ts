import type { NotificationTemplateRepository } from '../db/interfaces/notification-template-repository.js';
import type {
  NotificationChannel,
  NotificationEventType,
  CreateTemplateInput,
} from '../db/types.js';

// ---------------------------------------------------------------------------
// System notification template definitions
//
// Phase 47 shipped 12 plain-token placeholder rows. Phase 49-02 replaces
// those bodies with channel-appropriate shapes the renderers (49-01) can
// turn into HTML / Block Kit / Adaptive Card payloads.
//
//   - Email bodies are HTML (renderer wraps in scaffold + brand CTA).
//   - Slack bodies are Slack mrkdwn (renderer slices into Block Kit blocks).
//   - Teams bodies are JSON `{"text": "..."}` (renderer extracts + wraps in
//     an Adaptive Card with TextBlock + actions).
//
// The seeder is idempotent: on first run it inserts all 12 rows; on
// subsequent runs it skips by (eventType, channel) key. When a system row
// exists with a body that exactly matches the Phase 47 placeholder, it is
// upgraded in place (creating a v2 history row via repo.update). Rows
// that already have a non-placeholder body — including admin edits — are
// left untouched.
// ---------------------------------------------------------------------------

interface SystemTemplateDef {
  readonly eventType: NotificationEventType;
  readonly channel: NotificationChannel;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
}

// ---------------------------------------------------------------------------
// Phase 47 originals — used to detect which rows are safe to upgrade.
// ---------------------------------------------------------------------------

const PHASE_47_BODIES: ReadonlyMap<string, string> = new Map([
  ['scan.complete::email', 'Your scan of {{siteUrl}} found {{issueCount}} issues. View the report at {{reportUrl}}.'],
  ['scan.complete::slack', '*Scan complete* — {{siteUrl}} ({{issueCount}} issues). <{{reportUrl}}|View report>'],
  ['scan.complete::teams', '{"text":"Scan complete: {{siteUrl}} — {{issueCount}} issues."}'],
  ['scan.failed::email', 'The scan of {{siteUrl}} failed: {{error}}. Scan ID: {{scanId}}.'],
  ['scan.failed::slack', ':warning: *Scan failed* — {{siteUrl}}: {{error}} (scan {{scanId}})'],
  ['scan.failed::teams', '{"text":"Scan failed: {{siteUrl}} — {{error}}"}'],
  ['violation.found::email', 'A new {{severity}} violation ({{ruleId}}) was found on {{siteUrl}}: {{description}}'],
  ['violation.found::slack', ':rotating_light: *New {{severity}} violation* on {{siteUrl}}: {{ruleId}} — {{description}}'],
  ['violation.found::teams', '{"text":"New {{severity}} violation on {{siteUrl}}: {{ruleId}}"}'],
  ['regulation.changed::email', 'The regulation "{{regulationName}}" ({{jurisdiction}}) was updated. Review the changes at {{regulationUrl}}.'],
  ['regulation.changed::slack', ':books: *Regulation updated* — {{regulationName}} ({{jurisdiction}}). <{{regulationUrl}}|Review>'],
  ['regulation.changed::teams', '{"text":"Regulation updated: {{regulationName}} ({{jurisdiction}})"}'],
]);

// ---------------------------------------------------------------------------
// Phase 49 channel-appropriate definitions.
// ---------------------------------------------------------------------------

const SYSTEM_TEMPLATES: readonly SystemTemplateDef[] = [
  // ── scan.complete ───────────────────────────────────────────────────────
  {
    eventType: 'scan.complete',
    channel: 'email',
    subjectTemplate: 'Scan complete: {{siteUrl}}',
    bodyTemplate:
      '<p>Your scan of <strong>{{siteUrl}}</strong> finished — <strong>{{issueCount}}</strong> accessibility issues found.</p>' +
      '<p><a class="luqen-cta" href="{{reportUrl}}">View report</a></p>',
  },
  {
    eventType: 'scan.complete',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      '*Scan complete* — `{{siteUrl}}` finished with *{{issueCount}}* issues.\n<{{reportUrl}}|View the full report>',
  },
  {
    eventType: 'scan.complete',
    channel: 'teams',
    subjectTemplate: 'Scan complete: {{siteUrl}}',
    bodyTemplate:
      '{"text":"Scan complete for {{siteUrl}} — {{issueCount}} issues found."}',
  },

  // ── scan.failed ─────────────────────────────────────────────────────────
  {
    eventType: 'scan.failed',
    channel: 'email',
    subjectTemplate: 'Scan failed: {{siteUrl}}',
    bodyTemplate:
      '<p>The scan of <strong>{{siteUrl}}</strong> failed.</p>' +
      '<p><strong>Error:</strong> {{error}}<br/><strong>Scan ID:</strong> {{scanId}}</p>' +
      '<p><a class="luqen-cta" href="{{scanUrl}}">Retry scan</a></p>',
  },
  {
    eventType: 'scan.failed',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':warning: *Scan failed* — `{{siteUrl}}`\n>{{error}}\n_Scan ID:_ `{{scanId}}`',
  },
  {
    eventType: 'scan.failed',
    channel: 'teams',
    subjectTemplate: 'Scan failed: {{siteUrl}}',
    bodyTemplate:
      '{"text":"Scan failed for {{siteUrl}}: {{error}} (scan {{scanId}})."}',
  },

  // ── violation.found ─────────────────────────────────────────────────────
  {
    eventType: 'violation.found',
    channel: 'email',
    subjectTemplate: 'New WCAG violation in {{siteUrl}}',
    bodyTemplate:
      '<p>A new <strong>{{severity}}</strong> violation was detected.</p>' +
      '<ul>' +
      '<li><strong>Site:</strong> {{siteUrl}}</li>' +
      '<li><strong>Rule:</strong> {{ruleId}}</li>' +
      '<li><strong>Detail:</strong> {{description}}</li>' +
      '</ul>' +
      '<p><a class="luqen-cta" href="{{reportUrl}}">View report</a></p>',
  },
  {
    eventType: 'violation.found',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':rotating_light: *New {{severity}} violation* on `{{siteUrl}}`\n• Rule: `{{ruleId}}`\n• {{description}}',
  },
  {
    eventType: 'violation.found',
    channel: 'teams',
    subjectTemplate: 'New {{severity}} violation on {{siteUrl}}',
    bodyTemplate:
      '{"text":"New {{severity}} violation on {{siteUrl}} — {{ruleId}}: {{description}}"}',
  },

  // ── regulation.changed ──────────────────────────────────────────────────
  {
    eventType: 'regulation.changed',
    channel: 'email',
    subjectTemplate: 'Regulation update: {{regulationName}}',
    bodyTemplate:
      '<p>The regulation <strong>{{regulationName}}</strong> ({{jurisdiction}}) has been updated.</p>' +
      '<p>{{summary}}</p>' +
      '<p><a class="luqen-cta" href="{{regulationUrl}}">Review changes</a></p>',
  },
  {
    eventType: 'regulation.changed',
    channel: 'slack',
    subjectTemplate: '',
    bodyTemplate:
      ':books: *Regulation updated* — *{{regulationName}}* ({{jurisdiction}}).\n<{{regulationUrl}}|Review the changes>',
  },
  {
    eventType: 'regulation.changed',
    channel: 'teams',
    subjectTemplate: 'Regulation update: {{regulationName}}',
    bodyTemplate:
      '{"text":"Regulation {{regulationName}} ({{jurisdiction}}) was updated."}',
  },
];

// ---------------------------------------------------------------------------
// Idempotent seed: insert + version-aware upgrade. Returns counts so callers
// (CLI, server bootstrap) can log a clean summary.
// ---------------------------------------------------------------------------

export interface SeedResult {
  readonly inserted: number;
  readonly upgraded: number;
  readonly preserved: number;
}

const SEEDER_USER = 'system-seed';

export async function seedSystemNotificationTemplatesDetailed(
  repo: NotificationTemplateRepository,
): Promise<SeedResult> {
  const existing = await repo.list({ scope: 'system' });
  const existingByKey = new Map(
    existing.map((t) => [`${t.eventType}::${t.channel}`, t]),
  );

  let inserted = 0;
  let upgraded = 0;
  let preserved = 0;

  for (const def of SYSTEM_TEMPLATES) {
    const key = `${def.eventType}::${def.channel}`;
    const current = existingByKey.get(key);

    if (current === undefined) {
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
      continue;
    }

    const phase47Body = PHASE_47_BODIES.get(key);
    const isUntouchedPhase47 =
      phase47Body !== undefined && current.bodyTemplate === phase47Body;

    // Already on the new template? Skip.
    if (current.bodyTemplate === def.bodyTemplate) {
      preserved += 1;
      continue;
    }

    if (isUntouchedPhase47) {
      // Upgrade — repo.update writes a v2 history row before replacing.
      await repo.update(
        current.id,
        {
          subjectTemplate: def.subjectTemplate,
          bodyTemplate: def.bodyTemplate,
        },
        SEEDER_USER,
      );
      upgraded += 1;
    } else {
      // Admin-edited or otherwise diverged — preserve.
      preserved += 1;
    }
  }

  return { inserted, upgraded, preserved };
}

/**
 * Backwards-compatible wrapper preserved for Phase 47 callers that expected
 * a single integer return (count of *new* rows inserted). Phase 48 and
 * later code paths should prefer `seedSystemNotificationTemplatesDetailed`
 * to log/inspect upgrades and preserves.
 */
export async function seedSystemNotificationTemplates(
  repo: NotificationTemplateRepository,
): Promise<number> {
  const result = await seedSystemNotificationTemplatesDetailed(repo);
  return result.inserted;
}

export const SYSTEM_TEMPLATE_COUNT = SYSTEM_TEMPLATES.length;

// Test helpers — exposed so the upgrade-path test can fabricate a Phase 47 row
// and prove the seeder bumps it to v2.
export function _phase47BodyFor(key: string): string | undefined {
  return PHASE_47_BODIES.get(key);
}

export function _phase49BodyFor(
  eventType: NotificationEventType,
  channel: NotificationChannel,
): string | undefined {
  return SYSTEM_TEMPLATES.find(
    (t) => t.eventType === eventType && t.channel === channel,
  )?.bodyTemplate;
}
