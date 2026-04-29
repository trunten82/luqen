import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import {
  executeGenerateNotificationContent,
  parseNotificationResponse,
} from '../../src/capabilities/generate-notification-content.js';
import { buildNotificationPrompt } from '../../src/prompts/generate-notification-content.js';
import type { LLMProviderAdapter } from '../../src/providers/types.js';

const TEST_DB = '/tmp/llm-gen-notif-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

const VALID_RESPONSE = JSON.stringify({
  subject: 'Scan complete: example.com scored 78',
  body: 'Hello,\n\nYour latest scan finished. 12 issues found.\n\nThanks.',
});

function makeAdapter(behaviour: { text?: string; throw?: Error; hangMs?: number }): LLMProviderAdapter {
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(async () => {
      if (behaviour.throw) throw behaviour.throw;
      if (behaviour.hangMs) {
        await new Promise((r) => setTimeout(r, behaviour.hangMs));
      }
      return {
        text: behaviour.text ?? VALID_RESPONSE,
        usage: { inputTokens: 12, outputTokens: 80 },
      };
    }),
  };
}

describe('executeGenerateNotificationContent', () => {
  let db: SqliteAdapter;
  let modelId: string;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    await db.initialize();

    const provider = await db.createProvider({
      name: 'Test Ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      timeout: 30,
    });
    const model = await db.createModel({
      providerId: provider.id,
      modelId: 'llama3.2',
      displayName: 'Llama 3.2',
      capabilities: ['generate-notification-content'],
    });
    modelId = model.id;
    await db.assignCapability({ capability: 'generate-notification-content', modelId, priority: 1 });
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  it('returns null when no model is assigned for the org', async () => {
    const emptyDb = new SqliteAdapter('/tmp/llm-gen-notif-empty.db');
    await emptyDb.initialize();

    const result = await executeGenerateNotificationContent(
      emptyDb,
      vi.fn(),
      {
        template: { subject: 'S', body: 'B' },
        eventData: {},
        channel: 'email',
        outputFormat: 'both',
        orgId: 'no-such-org',
      },
    );
    expect(result).toBeNull();

    await emptyDb.close();
    if (existsSync('/tmp/llm-gen-notif-empty.db')) unlinkSync('/tmp/llm-gen-notif-empty.db');
  });

  it('returns parsed subject/body + telemetry on happy path', async () => {
    const adapter = makeAdapter({ text: VALID_RESPONSE });
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeGenerateNotificationContent(
      db,
      factory,
      {
        template: { subject: 'Scan complete', body: 'Default body' },
        voice: 'friendly',
        eventData: { site: 'example.com', score: 78 },
        channel: 'email',
        outputFormat: 'both',
      },
    );

    expect(result).not.toBeNull();
    expect(result!.subject).toBe('Scan complete: example.com scored 78');
    expect(result!.body).toContain('12 issues');
    expect(result!.model).toBe('Llama 3.2');
    expect(result!.provider).toBe('Test Ollama');
    expect(result!.tokensIn).toBe(12);
    expect(result!.tokensOut).toBe(80);
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns null when LLM hangs past timeoutMs', async () => {
    const adapter = makeAdapter({ hangMs: 500 });
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeGenerateNotificationContent(
      db,
      factory,
      {
        template: { subject: 'S', body: 'B' },
        eventData: {},
        channel: 'email',
        outputFormat: 'both',
      },
      { timeoutMs: 50 },
    );
    expect(result).toBeNull();
  });

  it('returns null when LLM returns non-JSON', async () => {
    const adapter = makeAdapter({ text: 'sorry, I cannot comply.' });
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeGenerateNotificationContent(
      db,
      factory,
      {
        template: { subject: 'S', body: 'B' },
        eventData: {},
        channel: 'slack',
        outputFormat: 'both',
      },
    );
    expect(result).toBeNull();
  });

  it('returns null when adapter throws', async () => {
    const adapter = makeAdapter({ throw: new Error('provider down') });
    const factory = vi.fn().mockReturnValue(adapter);

    const result = await executeGenerateNotificationContent(
      db,
      factory,
      {
        template: { subject: 'S', body: 'B' },
        eventData: {},
        channel: 'teams',
        outputFormat: 'both',
      },
    );
    expect(result).toBeNull();
  });
});

describe('parseNotificationResponse', () => {
  it('returns object for valid JSON', () => {
    const r = parseNotificationResponse(VALID_RESPONSE);
    expect(r).not.toBeNull();
    expect(r!.subject).toContain('example.com');
  });

  it('returns null for malformed JSON', () => {
    expect(parseNotificationResponse('not json {{{')).toBeNull();
  });

  it('strips markdown fences', () => {
    const text = '```json\n' + VALID_RESPONSE + '\n```';
    const r = parseNotificationResponse(text);
    expect(r).not.toBeNull();
  });

  it('returns null when subject and body are both empty', () => {
    const r = parseNotificationResponse(JSON.stringify({ subject: '', body: '' }));
    expect(r).toBeNull();
  });

  it('returns null when fields are wrong types', () => {
    const r = parseNotificationResponse(JSON.stringify({ subject: 1, body: true }));
    expect(r).toBeNull();
  });
});

describe('buildNotificationPrompt', () => {
  it('includes voice, brand, channel, event JSON, output-format fence', () => {
    const prompt = buildNotificationPrompt({
      templateSubject: 'Scan complete',
      templateBody: 'Body text',
      voice: 'cheerful',
      brandName: 'AcmeCorp',
      brandVoice: 'professional',
      eventData: { site: 'example.com' },
      channel: 'slack',
      outputFormat: 'both',
    });
    expect(prompt).toContain('cheerful');
    expect(prompt).toContain('AcmeCorp');
    expect(prompt).toContain('slack');
    expect(prompt).toContain('"site": "example.com"');
    expect(prompt).toContain('<!-- LOCKED:output-format -->');
  });
});
