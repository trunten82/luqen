import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamFrame, ChatMessage } from '../../src/providers/types.js';

// Capture captured constructor calls / mocked instance so tests can inspect them.
const anthropicCtorSpy = vi.fn();
const messagesCreateSpy = vi.fn();
const messagesStreamSpy = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  // Use a regular function so `new Anthropic(cfg)` works. Arrow functions
  // (produced by vi.fn().mockImplementation(...)) can't be used as constructors.
  class MockAnthropic {
    messages = { create: messagesCreateSpy, stream: messagesStreamSpy };
    constructor(cfg: unknown) {
      anthropicCtorSpy(cfg);
    }
  }
  return { default: MockAnthropic };
});

// Import after mock registration.
const { AnthropicAdapter } = await import('../../src/providers/anthropic.js');

/**
 * Build a fake Anthropic stream object with both async-iterator AND .finalMessage().
 * Mirrors the dual interface exposed by `client.messages.stream({...})`.
 */
function fakeStream(
  events: readonly unknown[],
  finalMessage: {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
    usage?: { input_tokens: number; output_tokens: number };
  },
): AsyncIterable<unknown> & { finalMessage: () => Promise<typeof finalMessage>; abort: () => void } {
  const iter: AsyncIterable<unknown> & { finalMessage: () => Promise<typeof finalMessage>; abort: () => void } = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => {
          if (i < events.length) {
            return { value: events[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
    finalMessage: async () => finalMessage,
    abort: () => undefined,
  };
  return iter;
}

describe('AnthropicAdapter', () => {
  let adapter: InstanceType<typeof AnthropicAdapter>;

  beforeEach(async () => {
    anthropicCtorSpy.mockClear();
    messagesCreateSpy.mockReset();
    messagesStreamSpy.mockReset();
    adapter = new AnthropicAdapter();
  });

  it('has type anthropic', () => {
    expect(adapter.type).toBe('anthropic');
  });

  it('Test 9: connect initialises Anthropic client with apiKey', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });
    expect(anthropicCtorSpy).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-test' }));
  });

  it('Test 10: healthCheck returns true when connected', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });
    const ok = await adapter.healthCheck();
    expect(ok).toBe(true);
  });

  it('Test 10b: healthCheck returns false when not connected', async () => {
    const ok = await adapter.healthCheck();
    expect(ok).toBe(false);
  });

  it('Test 11: listModels returns claude-sonnet-4-6 and claude-haiku-4-5-20251001', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });
    const models = await adapter.listModels();
    const ids = models.map((m) => m.id);
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });

  it('Test 12: complete maps systemPrompt to top-level system param (not a message)', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });
    messagesCreateSpy.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'hello-from-claude' }],
      usage: { input_tokens: 5, output_tokens: 10 },
    });

    const result = await adapter.complete('Say hi', {
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a helpful accessibility expert.',
      maxTokens: 2048,
    });

    expect(result.text).toBe('hello-from-claude');

    const callArgs = messagesCreateSpy.mock.calls[0][0];
    // system goes as TOP-LEVEL param, NOT in messages array
    expect(callArgs.system).toBe('You are a helpful accessibility expert.');
    expect(callArgs.model).toBe('claude-sonnet-4-6');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Say hi' }]);
    // Ensure no system message was shoved into messages array
    expect(callArgs.messages.find((m: { role: string }) => m.role === 'system')).toBeUndefined();
  });

  it('Test 13: completeStream emits token frames + done frame for plain text', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });

    const stream = fakeStream(
      [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: ' there' } },
      ],
      {
        content: [{ type: 'text', text: 'Hi there' }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    );
    messagesStreamSpy.mockReturnValueOnce(stream);

    const frames: StreamFrame[] = [];
    const messages: readonly ChatMessage[] = [{ role: 'user', content: 'hello' }];
    for await (const f of adapter.completeStream!(messages, { model: 'claude-sonnet-4-6', maxTokens: 1024 })) {
      frames.push(f);
    }

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: 'token', text: 'Hi' });
    expect(tokens[1]).toEqual({ type: 'token', text: ' there' });

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('Test 14: tool_use — all tokens emit BEFORE the single tool_calls frame (ordering invariant)', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });

    const stream = fakeStream(
      [
        // Text delta arrives first
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Running scan...' } },
        // Tool-use partial JSON fragments (adapter must ignore these — .finalMessage() has the assembled object)
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '1}' } },
        { type: 'content_block_stop' },
      ],
      {
        content: [
          { type: 'text', text: 'Running scan...' },
          { type: 'tool_use', id: 'toolu_1', name: 'foo', input: { a: 1 } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    );
    messagesStreamSpy.mockReturnValueOnce(stream);

    const frames: StreamFrame[] = [];
    const messages: readonly ChatMessage[] = [{ role: 'user', content: 'scan' }];
    for await (const f of adapter.completeStream!(messages, { model: 'claude-sonnet-4-6', maxTokens: 1024 })) {
      frames.push(f);
    }

    const tokenFrames = frames.filter((f) => f.type === 'token');
    const toolCallsFrames = frames.filter((f) => f.type === 'tool_calls');

    expect(tokenFrames).toHaveLength(1);
    expect(tokenFrames[0]).toEqual({ type: 'token', text: 'Running scan...' });

    expect(toolCallsFrames).toHaveLength(1);
    const tc = toolCallsFrames[0] as Extract<StreamFrame, { type: 'tool_calls' }>;
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0]).toEqual({ id: 'toolu_1', name: 'foo', args: { a: 1 } });

    // ORDERING INVARIANT: every token frame's index < the single tool_calls frame's index
    const toolCallsIdx = frames.findIndex((f) => f.type === 'tool_calls');
    const tokenIndices = frames
      .map((f, i) => (f.type === 'token' ? i : -1))
      .filter((i) => i >= 0);
    for (const ti of tokenIndices) {
      expect(ti).toBeLessThan(toolCallsIdx);
    }

    // done frame should be last and report tool_calls finishReason
    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('Test 15: tool_result message converted to {role:"user", content:[{type:"tool_result", tool_use_id, content}]}', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });

    const stream = fakeStream(
      [],
      { content: [{ type: 'text', text: '' }], usage: { input_tokens: 1, output_tokens: 1 } },
    );
    messagesStreamSpy.mockReturnValueOnce(stream);

    const messages: readonly ChatMessage[] = [
      { role: 'user', content: 'Run it' },
      {
        role: 'tool',
        content: '{"status":"ok"}',
        toolCallId: 'toolu_abc',
        toolName: 'foo',
      },
    ];

    for await (const _ of adapter.completeStream!(messages, { model: 'claude-sonnet-4-6', maxTokens: 1024 })) {
      void _;
    }

    const callArgs = messagesStreamSpy.mock.calls[0][0];
    const anthropicMessages = callArgs.messages as Array<{ role: string; content: unknown }>;
    // Find the tool_result message (comes in as role='user' per Anthropic shape)
    const toolResultMsg = anthropicMessages.find(
      (m) => Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.role).toBe('user');
    const blocks = toolResultMsg!.content as Array<{ type: string; tool_use_id?: string; content?: string }>;
    const trBlock = blocks.find((b) => b.type === 'tool_result')!;
    expect(trBlock.tool_use_id).toBe('toolu_abc');
    expect(trBlock.content).toBe('{"status":"ok"}');
  });

  it('Test 16: AbortSignal — aborted signal before stream prevents network call', async () => {
    await adapter.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test' });

    const controller = new AbortController();
    controller.abort();

    const frames: StreamFrame[] = [];
    for await (const f of adapter.completeStream!(
      [{ role: 'user', content: 'hi' }],
      { model: 'claude-sonnet-4-6', maxTokens: 1024 },
      controller.signal,
    )) {
      frames.push(f);
    }

    const errFrame = frames.find((f) => f.type === 'error');
    expect(errFrame).toBeDefined();
    // No stream() call on mocked client
    expect(messagesStreamSpy).not.toHaveBeenCalled();
  });
});
