import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { CAPABILITY_NAMES } from '../../src/types.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError } from '../../src/capabilities/types.js';
import { executeAgentConversation } from '../../src/capabilities/agent-conversation.js';
import { buildAgentSystemPrompt } from '../../src/prompts/agent-system.js';
import type { ChatMessage, LLMProviderAdapter, StreamFrame, ToolDef } from '../../src/providers/types.js';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'llm-agent-conv-test-'));
const TEST_DB = join(TEST_DIR, 'test.db');

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

interface CaptureHook {
  messages?: readonly ChatMessage[];
  options?: Record<string, unknown>;
}

function makeStreamingAdapter(
  frames: ReadonlyArray<StreamFrame> | Error,
  capture?: CaptureHook,
): LLMProviderAdapter {
  return {
    type: 'mock',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(),
    completeStream: async function* (
      messages: readonly ChatMessage[],
      options: Record<string, unknown>,
    ): AsyncIterable<StreamFrame> {
      if (capture) {
        capture.messages = messages;
        capture.options = options;
      }
      if (frames instanceof Error) {
        throw frames;
      }
      for (const frame of frames) {
        yield frame;
      }
    },
  };
}

async function collect(iter: AsyncIterable<StreamFrame>): Promise<StreamFrame[]> {
  const out: StreamFrame[] = [];
  for await (const f of iter) {
    out.push(f);
  }
  return out;
}

describe('CAPABILITY_NAMES includes agent-conversation', () => {
  // Test 1
  it("includes 'agent-conversation' in the CAPABILITY_NAMES array", () => {
    expect((CAPABILITY_NAMES as readonly string[]).includes('agent-conversation')).toBe(true);
  });

  // REFACTOR smoke — capability-discovery: the capability is surfaced via
  // CAPABILITY_NAMES which GET /api/v1/capabilities iterates (see
  // api/routes/capabilities.ts), so admins see 'agent-conversation' as a
  // valid assignment target without new admin UI work (AI-SPEC §4c.1 #1).
  it('is the EXPECTED trailing entry (array order preserved, append-only)', () => {
    const names = [...CAPABILITY_NAMES];
    expect(names[names.length - 1]).toBe('agent-conversation');
  });
});

describe('buildAgentSystemPrompt', () => {
  // Test 2
  it('output contains all three LOCKED fence markers (open + close)', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('<!-- LOCKED:rbac -->');
    expect(prompt).toContain('<!-- /LOCKED:rbac -->');
    expect(prompt).toContain('<!-- LOCKED:confirmation -->');
    expect(prompt).toContain('<!-- /LOCKED:confirmation -->');
    expect(prompt).toContain('<!-- LOCKED:honesty -->');
    expect(prompt).toContain('<!-- /LOCKED:honesty -->');
  });

  // Test 3
  it('output contains the {agentDisplayName} placeholder', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('{agentDisplayName}');
  });

  // Test 4 — verbatim AI-SPEC §4b.3 copy
  it('locked fence content matches AI-SPEC §4b.3 verbatim', () => {
    const prompt = buildAgentSystemPrompt();

    // RBAC fence (4 lines of body)
    expect(prompt).toContain(
      "You have access ONLY to the tools listed in this turn's tool manifest.",
    );
    expect(prompt).toContain('Never claim a capability that is not in the manifest.');
    expect(prompt).toContain('ask how they');

    // CONFIRMATION fence (4 lines)
    expect(prompt).toContain('Tools marked destructive will be paused for user confirmation before');
    expect(prompt).toContain('running. Call the tool normally');
    expect(prompt).toContain('creates a double-confirmation experience.');

    // HONESTY fence (3 lines)
    expect(prompt).toContain('If a tool returns an error, do not invent results.');
    expect(prompt).toContain('plainly and offer to try a different approach.');
  });
});

describe('executeAgentConversation', () => {
  let db: SqliteAdapter;
  let providerId: string;
  let modelId: string;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    await db.initialize();

    const provider = await db.createProvider({
      name: 'Test Mock',
      type: 'ollama', // use 'ollama' which is a known type; adapter factory returns our mock
      baseUrl: 'http://localhost:11434',
      timeout: 30,
    });
    providerId = provider.id;

    const model = await db.createModel({
      providerId,
      modelId: 'mock-agent-model',
      displayName: 'Mock Agent Model',
      capabilities: ['agent-conversation'],
    });
    modelId = model.id;
  });

  afterAll(async () => {
    await db.close();
    cleanup();
  });

  // Test 5
  it('happy path — yields streamed frames in order', async () => {
    const seedOrgId = 'happy-org';
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId,
      priority: 1,
      orgId: seedOrgId,
    });

    const frames: StreamFrame[] = [
      { type: 'token', text: 'Hi' },
      { type: 'done', finishReason: 'stop' },
    ];
    const adapter = makeStreamingAdapter(frames);
    const factory = vi.fn().mockReturnValue(adapter);

    const out = await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [],
        agentDisplayName: 'Luna',
      }),
    );

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'token', text: 'Hi' });
    expect(out[1]).toEqual({ type: 'done', finishReason: 'stop' });
  });

  // Test 6 — system prompt injection + user separation
  it('passes a system message as FIRST message with interpolated display name and three LOCKED fences; user message stays role=user', async () => {
    const seedOrgId = 'system-prompt-org';
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId,
      priority: 1,
      orgId: seedOrgId,
    });

    const capture: CaptureHook = {};
    const adapter = makeStreamingAdapter(
      [{ type: 'done', finishReason: 'stop' }],
      capture,
    );
    const factory = vi.fn().mockReturnValue(adapter);

    await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'please scan my site' }],
        tools: [],
        agentDisplayName: 'Luna',
      }),
    );

    const sent = capture.messages ?? [];
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent[0]?.role).toBe('system');
    const sysContent = sent[0]?.content ?? '';
    expect(sysContent).toContain('<!-- LOCKED:rbac -->');
    expect(sysContent).toContain('<!-- LOCKED:confirmation -->');
    expect(sysContent).toContain('<!-- LOCKED:honesty -->');
    expect(sysContent).toContain('Luna');
    // Must not carry the un-interpolated placeholder
    expect(sysContent).not.toContain('{agentDisplayName}');

    // User message is separate — NOT merged into system
    expect(sent[1]?.role).toBe('user');
    expect(sent[1]?.content).toBe('please scan my site');
    // No system message must embed the user's text
    expect(sysContent).not.toContain('please scan my site');
  });

  // Test 7 — tool manifest forwarded
  it('forwards the tools array unchanged to adapter.completeStream', async () => {
    const seedOrgId = 'tools-org';
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId,
      priority: 1,
      orgId: seedOrgId,
    });

    const tools: ToolDef[] = [
      {
        name: 'scan_site',
        description: 'Scan a site for WCAG issues',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
    ];

    const capture: CaptureHook = {};
    const adapter = makeStreamingAdapter(
      [{ type: 'done', finishReason: 'stop' }],
      capture,
    );
    const factory = vi.fn().mockReturnValue(adapter);

    await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'hi' }],
        tools,
        agentDisplayName: 'Luna',
      }),
    );

    expect(capture.options?.tools).toEqual(tools);
  });

  // Test 8 — per-org override is read
  it('per-org override of agent-system is honoured on the read path', async () => {
    const seedOrgId = 'override-read-org';
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId,
      priority: 1,
      orgId: seedOrgId,
    });
    // Direct DB seed — simulates an override row that might exist from earlier
    // write (or an OOB admin edit). Route-level PUT blocking is tested in the
    // prompts-agent.test.ts file.
    await db.setPromptOverride(
      'agent-system' as unknown as Parameters<typeof db.setPromptOverride>[0],
      'OVERRIDE TEMPLATE {agentDisplayName}',
      seedOrgId,
    );

    const capture: CaptureHook = {};
    const adapter = makeStreamingAdapter(
      [{ type: 'done', finishReason: 'stop' }],
      capture,
    );
    const factory = vi.fn().mockReturnValue(adapter);

    await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'ok' }],
        tools: [],
        agentDisplayName: 'Luna',
      }),
    );

    const sysContent = capture.messages?.[0]?.content ?? '';
    expect(sysContent).toContain('OVERRIDE TEMPLATE');
    expect(sysContent).toContain('Luna');
  });

  // Test 9 — provider fallback on stream-open failure
  it('falls through to next priority provider when first one errors on stream open', async () => {
    const seedOrgId = 'fallback-org';

    // Create second provider/model
    const provider2 = await db.createProvider({
      name: 'Secondary Mock',
      type: 'openai',
      baseUrl: 'http://localhost:11435',
      timeout: 30,
    });
    const model2 = await db.createModel({
      providerId: provider2.id,
      modelId: 'mock-agent-model-2',
      displayName: 'Mock Agent Model 2',
      capabilities: ['agent-conversation'],
    });

    await db.assignCapability({
      capability: 'agent-conversation',
      modelId,
      priority: 1,
      orgId: seedOrgId,
    });
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: model2.id,
      priority: 2,
      orgId: seedOrgId,
    });

    let call = 0;
    const factory = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return makeStreamingAdapter(new Error('primary stream open failed'));
      }
      return makeStreamingAdapter([
        { type: 'token', text: 'fallback' },
        { type: 'done', finishReason: 'stop' },
      ]);
    });

    const out = await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        agentDisplayName: 'Luna',
      }),
    );

    expect(out).toEqual([
      { type: 'token', text: 'fallback' },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  // Test 9b — both providers fail at stream-open → CapabilityExhaustedError
  it('throws CapabilityExhaustedError when ALL providers fail at stream open', async () => {
    const seedOrgId = 'all-fail-org';

    const providerA = await db.createProvider({
      name: 'Fail A',
      type: 'ollama',
      baseUrl: 'http://a',
      timeout: 30,
    });
    const modelA = await db.createModel({
      providerId: providerA.id,
      modelId: 'fail-a',
      displayName: 'Fail A',
      capabilities: ['agent-conversation'],
    });
    const providerB = await db.createProvider({
      name: 'Fail B',
      type: 'openai',
      baseUrl: 'http://b',
      timeout: 30,
    });
    const modelB = await db.createModel({
      providerId: providerB.id,
      modelId: 'fail-b',
      displayName: 'Fail B',
      capabilities: ['agent-conversation'],
    });

    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: modelA.id,
      priority: 1,
      orgId: seedOrgId,
    });
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: modelB.id,
      priority: 2,
      orgId: seedOrgId,
    });

    const factory = vi.fn().mockImplementation(() =>
      makeStreamingAdapter(new Error('boom')),
    );

    await expect(
      collect(
        executeAgentConversation(db, factory, {
          orgId: seedOrgId,
          userId: 'user-1',
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          agentDisplayName: 'Luna',
        }),
      ),
    ).rejects.toThrow(CapabilityExhaustedError);
  });

  // Test 10 — mid-stream error is forwarded; NO retry to next provider
  it('forwards mid-stream error frame and terminates without retrying next provider (D-23)', async () => {
    const seedOrgId = 'mid-stream-err-org';

    const p1 = await db.createProvider({
      name: 'Mid A',
      type: 'ollama',
      baseUrl: 'http://a',
      timeout: 30,
    });
    const m1 = await db.createModel({
      providerId: p1.id,
      modelId: 'mid-a',
      displayName: 'Mid A',
      capabilities: ['agent-conversation'],
    });
    const p2 = await db.createProvider({
      name: 'Mid B',
      type: 'openai',
      baseUrl: 'http://b',
      timeout: 30,
    });
    const m2 = await db.createModel({
      providerId: p2.id,
      modelId: 'mid-b',
      displayName: 'Mid B',
      capabilities: ['agent-conversation'],
    });

    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: m1.id,
      priority: 1,
      orgId: seedOrgId,
    });
    await db.assignCapability({
      capability: 'agent-conversation',
      modelId: m2.id,
      priority: 2,
      orgId: seedOrgId,
    });

    let call = 0;
    const factory = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return makeStreamingAdapter([
          { type: 'token', text: 'Hi' },
          { type: 'error', code: 'provider_failed', message: 'drop', retryable: false },
        ]);
      }
      // If the capability retried wrongly, this would get used
      return makeStreamingAdapter([
        { type: 'token', text: 'SHOULD NOT APPEAR' },
        { type: 'done', finishReason: 'stop' },
      ]);
    });

    const out = await collect(
      executeAgentConversation(db, factory, {
        orgId: seedOrgId,
        userId: 'user-1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
        agentDisplayName: 'Luna',
      }),
    );

    expect(out).toEqual([
      { type: 'token', text: 'Hi' },
      { type: 'error', code: 'provider_failed', message: 'drop', retryable: false },
    ]);
    expect(call).toBe(1); // second provider never invoked
  });

  it('throws CapabilityNotConfiguredError when no model assigned to agent-conversation for the org', async () => {
    const factory = vi.fn();
    await expect(
      collect(
        executeAgentConversation(db, factory, {
          orgId: 'no-such-org-at-all',
          userId: 'user-1',
          messages: [{ role: 'user', content: 'hi' }],
          tools: [],
          agentDisplayName: 'Luna',
        }),
      ),
    ).rejects.toThrow(CapabilityNotConfiguredError);
  });
});
