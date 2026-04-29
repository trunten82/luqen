import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { NotificationDispatcher } from '../../src/notifications/dispatcher.js';
import { renderTemplate } from '../../src/notifications/render.js';
import { seedSystemNotificationTemplates } from '../../src/notifications/seed-templates.js';
import type { LuqenEvent, PluginInstance } from '../../src/plugins/types.js';
import type { PluginManager } from '../../src/plugins/manager.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakePlugin {
  id: string;
  packageName: string;
  channel: 'email' | 'slack' | 'teams';
  instance: PluginInstance;
  received: LuqenEvent[];
}

function makeFakePlugin(
  channel: 'email' | 'slack' | 'teams',
  opts: { throws?: boolean } = {},
): FakePlugin {
  const received: LuqenEvent[] = [];
  const instance = {
    manifest: {
      name: `notify-${channel}`,
      displayName: `Notify ${channel}`,
      type: 'notification' as const,
      version: '1.0.0',
      description: '',
      configSchema: [],
    },
    activate: async () => {},
    deactivate: async () => {},
    healthCheck: async () => true,
    send: async (event: LuqenEvent) => {
      if (opts.throws) throw new Error('boom');
      received.push(event);
    },
  } as unknown as PluginInstance;
  return {
    id: `plugin-${channel}-${randomUUID().slice(0, 6)}`,
    packageName: `@luqen/plugin-notify-${channel}`,
    channel,
    instance,
    received,
  };
}

function makeFakePluginManager(plugins: FakePlugin[]): PluginManager {
  return {
    getActiveNotificationPlugins: () =>
      plugins.map((p) => ({
        id: p.id,
        packageName: p.packageName,
        channel: p.channel,
        instance: p.instance,
      })),
  } as unknown as PluginManager;
}

const NOOP_LOGGER = { warn: () => {} };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `disp-test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await seedSystemNotificationTemplates(storage.notificationTemplates);
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Renderer tests
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('replaces known tokens', () => {
    const out = renderTemplate('Hello {{name}}, you have {{count}} issues', {
      name: 'World',
      count: 7,
    });
    expect(out).toBe('Hello World, you have 7 issues');
  });

  it('preserves unknown tokens for visibility', () => {
    const out = renderTemplate('{{a}} and {{missing}}', { a: 'hi' });
    expect(out).toBe('hi and {{missing}}');
  });

  it('renders null/undefined as empty string', () => {
    const out = renderTemplate('[{{x}}][{{y}}]', { x: null, y: undefined });
    expect(out).toBe('[][]');
  });

  it('JSON-encodes object values', () => {
    const out = renderTemplate('val={{obj}}', { obj: { a: 1 } });
    expect(out).toBe('val={"a":1}');
  });
});

// ---------------------------------------------------------------------------
// Dispatcher tests
// ---------------------------------------------------------------------------

describe('NotificationDispatcher', () => {
  it('renders + delivers to every active notification plugin', async () => {
    const plugins = [
      makeFakePlugin('email'),
      makeFakePlugin('slack'),
      makeFakePlugin('teams'),
    ];
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager(plugins),
      NOOP_LOGGER,
    );

    const event: LuqenEvent = {
      type: 'scan.complete',
      timestamp: new Date().toISOString(),
      data: { siteUrl: 'https://example.com', issueCount: 4, reportUrl: 'https://r/1' },
    };

    const results = await dispatcher.dispatch(event, 'org-1');
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'sent')).toBe(true);

    // Each plugin received an enriched event
    for (const p of plugins) {
      expect(p.received).toHaveLength(1);
      const e = p.received[0];
      expect(e.type).toBe('scan.complete');
      expect(e.data.siteUrl).toBe('https://example.com');
      expect(typeof e.data.renderedSubject).toBe('string');
      expect(typeof e.data.renderedBody).toBe('string');
      expect(e.data.templateScope).toBe('system');
      expect(typeof e.data.templateId).toBe('string');
      expect(e.data.templateVersion).toBe(1);
    }

    const emailEvent = plugins[0].received[0];
    expect(emailEvent.data.renderedSubject).toBe('Scan complete: https://example.com');
    expect(emailEvent.data.renderedBody).toContain('found 4 issues');
  });

  it('preserves the original event shape — new fields are additive', async () => {
    const plugins = [makeFakePlugin('email')];
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager(plugins),
      NOOP_LOGGER,
    );

    const event: LuqenEvent = {
      type: 'scan.failed',
      timestamp: '2026-04-28T10:00:00.000Z',
      data: { siteUrl: 'x.com', error: 'timeout', scanId: 'abc' },
    };

    await dispatcher.dispatch(event, 'org-1');
    const received = plugins[0].received[0];
    // Original fields untouched
    expect(received.type).toBe('scan.failed');
    expect(received.timestamp).toBe('2026-04-28T10:00:00.000Z');
    expect(received.data.siteUrl).toBe('x.com');
    expect(received.data.error).toBe('timeout');
    expect(received.data.scanId).toBe('abc');
    // Plus the new dispatcher fields
    expect(received.data.renderedSubject).toBe('Scan failed: x.com');
  });

  it('reports no-template when no row matches and skips plugin send', async () => {
    // Wipe the system slack row only
    const slackTpl = await storage.notificationTemplates.list({
      eventType: 'scan.complete',
      channel: 'slack',
      scope: 'system',
    });
    // Use raw delete bypass: drop via direct repository (system delete throws)
    // — instead, replace by re-creating a fresh DB without seeding slack.
    // Easiest path: forge a missing combination by using a non-seeded event.
    // Here we directly delete via SQL on the underlying DB.
    const raw = (storage as SqliteStorageAdapter).getRawDatabase();
    raw.prepare('DELETE FROM notification_templates WHERE id = ?').run(slackTpl[0].id);

    const plugins = [makeFakePlugin('email'), makeFakePlugin('slack'), makeFakePlugin('teams')];
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager(plugins),
      NOOP_LOGGER,
    );

    const results = await dispatcher.dispatch(
      {
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: { siteUrl: 'x', issueCount: 0 },
      },
      'org-1',
    );

    expect(results).toHaveLength(3);
    const slack = results.find((r) => r.channel === 'slack');
    expect(slack?.status).toBe('no-template');
    expect(plugins[1].received).toHaveLength(0); // Slack plugin never called
    expect(plugins[0].received).toHaveLength(1); // Email still works
    expect(plugins[2].received).toHaveLength(1); // Teams still works
  });

  it('org template wins over system template', async () => {
    await storage.notificationTemplates.create({
      eventType: 'scan.complete',
      channel: 'slack',
      scope: 'org',
      orgId: 'org-1',
      subjectTemplate: '',
      bodyTemplate: 'ORG-OVERRIDE: {{siteUrl}}',
    });

    const plugins = [makeFakePlugin('slack')];
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager(plugins),
      NOOP_LOGGER,
    );

    await dispatcher.dispatch(
      {
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: { siteUrl: 'site.test' },
      },
      'org-1',
    );

    const received = plugins[0].received[0];
    expect(received.data.renderedBody).toBe('ORG-OVERRIDE: site.test');
    expect(received.data.templateScope).toBe('org');
  });

  it('captures plugin errors and continues dispatching to other plugins', async () => {
    const plugins = [
      makeFakePlugin('email', { throws: true }),
      makeFakePlugin('slack'),
    ];
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager(plugins),
      NOOP_LOGGER,
    );

    const results = await dispatcher.dispatch(
      {
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: { siteUrl: 'x' },
      },
      'org-1',
    );

    expect(results).toHaveLength(2);
    const email = results.find((r) => r.channel === 'email');
    const slack = results.find((r) => r.channel === 'slack');
    expect(email?.status).toBe('error');
    expect(email?.error).toBe('boom');
    expect(slack?.status).toBe('sent');
    expect(plugins[1].received).toHaveLength(1);
  });

  it('returns empty array when no notification plugins are active', async () => {
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([]),
      NOOP_LOGGER,
    );
    const results = await dispatcher.dispatch(
      {
        type: 'scan.complete',
        timestamp: new Date().toISOString(),
        data: {},
      },
      'org-1',
    );
    expect(results).toEqual([]);
  });
});
