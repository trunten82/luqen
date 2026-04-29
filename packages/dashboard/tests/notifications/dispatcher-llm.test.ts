import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import {
  NotificationDispatcher,
  type DispatcherLLMClient,
  type DispatchAuditWriter,
} from '../../src/notifications/dispatcher.js';
import { seedSystemNotificationTemplates } from '../../src/notifications/seed-templates.js';
import type { LuqenEvent, PluginInstance } from '../../src/plugins/types.js';
import type { PluginManager } from '../../src/plugins/manager.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

interface FakePlugin {
  id: string;
  channel: 'email' | 'slack' | 'teams';
  instance: PluginInstance;
  received: LuqenEvent[];
}

function makeFakePlugin(channel: 'email' | 'slack' | 'teams'): FakePlugin {
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
      received.push(event);
    },
  } as unknown as PluginInstance;
  return {
    id: `plugin-${channel}-${randomUUID().slice(0, 6)}`,
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
        packageName: `@luqen/plugin-notify-${p.channel}`,
        channel: p.channel,
        instance: p.instance,
      })),
  } as unknown as PluginManager;
}

const NOOP_LOGGER = { warn: () => {} };

let storage: SqliteStorageAdapter;
let dbPath: string;
let templateId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `disp-llm-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  await seedSystemNotificationTemplates(storage.notificationTemplates);
  // pick the email scan.complete system template and flip llmEnabled
  const all = await storage.notificationTemplates.list({
    eventType: 'scan.complete',
    channel: 'email',
  });
  const tpl = all[0]!;
  templateId = tpl.id;
  await storage.notificationTemplates.update(
    tpl.id,
    { llmEnabled: true },
    'test',
  );
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

const SAMPLE_EVENT: LuqenEvent = {
  type: 'scan.complete',
  timestamp: new Date().toISOString(),
  data: { site: 'example.com', score: 78, issueCount: 12 },
};

describe('NotificationDispatcher — LLM integration (Phase 50-02)', () => {
  it('uses LLM-generated content when llmEnabled=true and LLM succeeds', async () => {
    const llmClient: DispatcherLLMClient = {
      generateNotificationContent: vi.fn().mockResolvedValue({
        subject: 'LLM SUBJ',
        body: 'LLM BODY',
        model: 'Llama 3.2',
        provider: 'Ollama',
        latencyMs: 42,
        tokensIn: 10,
        tokensOut: 20,
      }),
    };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
      { llmClient },
    );

    const results = await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('sent');
    expect(results[0].llmUsed).toBe(true);
    expect(results[0].llmModel).toBe('Llama 3.2');
    expect(results[0].llmLatencyMs).toBe(42);
    expect(plugin.received).toHaveLength(1);
    expect(plugin.received[0].data.renderedSubject).toBe('LLM SUBJ');
    expect(plugin.received[0].data.renderedBody).toBe('LLM BODY');
  });

  it('falls back to deterministic when LLM returns null', async () => {
    const llmClient: DispatcherLLMClient = {
      generateNotificationContent: vi.fn().mockResolvedValue(null),
    };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
      { llmClient },
    );

    const results = await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');
    expect(results[0].status).toBe('sent');
    expect(results[0].llmUsed).toBe(false);
    expect(results[0].llmModel).toBeUndefined();
    expect(plugin.received[0].data.renderedSubject).not.toBe('LLM SUBJ');
  });

  it('falls back to deterministic when LLM throws', async () => {
    const llmClient: DispatcherLLMClient = {
      generateNotificationContent: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const warnSpy = vi.fn();
    const logger = { warn: warnSpy };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      logger,
      { llmClient },
    );

    const results = await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');
    expect(results[0].status).toBe('sent');
    expect(results[0].llmUsed).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does NOT call LLM when llmEnabled=false', async () => {
    // disable on the seeded template
    await storage.notificationTemplates.update(
      templateId,
      { llmEnabled: false },
      'test',
    );

    const generateSpy = vi.fn();
    const llmClient: DispatcherLLMClient = {
      generateNotificationContent: generateSpy,
    };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
      { llmClient },
    );

    const results = await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');
    expect(results[0].status).toBe('sent');
    expect(results[0].llmUsed).toBe(false);
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('writes audit log entry per dispatch when audit writer provided', async () => {
    const llmClient: DispatcherLLMClient = {
      generateNotificationContent: vi.fn().mockResolvedValue({
        subject: 'LLM SUBJ',
        body: 'LLM BODY',
        model: 'Llama 3.2',
        provider: 'Ollama',
        latencyMs: 50,
        tokensIn: 5,
        tokensOut: 5,
      }),
    };
    const auditEntries: Array<{ action: string; details: Record<string, unknown> }> = [];
    const audit: DispatchAuditWriter = {
      log: (entry) => {
        auditEntries.push({ action: entry.action, details: entry.details });
      },
    };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
      { llmClient, audit },
    );

    await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe('notification.dispatch');
    expect(auditEntries[0].details.llmUsed).toBe(true);
    expect(auditEntries[0].details.llmModel).toBe('Llama 3.2');
    expect(auditEntries[0].details.status).toBe('sent');
  });

  it('preserves backwards-compat: enrichedEvent still has renderedSubject/renderedBody', async () => {
    // No LLM client provided
    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
    );

    const results = await dispatcher.dispatch(SAMPLE_EVENT, 'org-1');
    expect(results[0].status).toBe('sent');
    expect(plugin.received[0].data.renderedSubject).toBeDefined();
    expect(plugin.received[0].data.renderedBody).toBeDefined();
    // llmUsed is always set on send/error results; without a client it stays false.
    expect(results[0].llmUsed).toBe(false);
  });

  it('uses orgNameLookup for brandContext.name when supplied', async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      subject: 'X', body: 'Y', model: 'M', provider: 'P', latencyMs: 1, tokensIn: 1, tokensOut: 1,
    });
    const llmClient: DispatcherLLMClient = { generateNotificationContent: generateSpy };

    const plugin = makeFakePlugin('email');
    const dispatcher = new NotificationDispatcher(
      storage.notificationTemplates,
      makeFakePluginManager([plugin]),
      NOOP_LOGGER,
      {
        llmClient,
        orgNameLookup: async (orgId) => `Acme (${orgId})`,
      },
    );

    await dispatcher.dispatch(SAMPLE_EVENT, 'org-42');
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const arg = generateSpy.mock.calls[0][0];
    expect(arg.brandContext.name).toBe('Acme (org-42)');
  });
});
