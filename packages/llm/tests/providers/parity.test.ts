import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamFrame, ChatMessage } from '../../src/providers/types.js';

// Mock @anthropic-ai/sdk so registering the Anthropic adapter and exercising
// completeStream() doesn't issue real network calls.
const messagesCreateSpy = vi.fn();
const messagesStreamSpy = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: messagesCreateSpy, stream: messagesStreamSpy };
    constructor(_cfg: unknown) {
      // no-op
    }
  }
  return { default: MockAnthropic };
});

const { OpenAIAdapter } = await import('../../src/providers/openai.js');
const { OllamaAdapter } = await import('../../src/providers/ollama.js');
const { AnthropicAdapter } = await import('../../src/providers/anthropic.js');

/**
 * Normalise a frame stream for parity comparison:
 *  - drop usage (varies per provider).
 *  - drop id on tool_calls.calls[] (provider-specific).
 *  - drop message field on error frames (wording varies).
 */
function normalise(frames: readonly StreamFrame[]): Array<Record<string, unknown>> {
  return frames.map((f) => {
    if (f.type === 'token') return { type: 'token', text: f.text };
    if (f.type === 'tool_calls') {
      return {
        type: 'tool_calls',
        calls: f.calls.map((c) => ({ name: c.name, args: c.args })),
      };
    }
    if (f.type === 'done') return { type: 'done', finishReason: f.finishReason };
    return { type: 'error', code: f.code, retryable: f.retryable };
  });
}

async function collect(iter: AsyncIterable<StreamFrame>): Promise<StreamFrame[]> {
  const frames: StreamFrame[] = [];
  for await (const f of iter) frames.push(f);
  return frames;
}

// ---------------------------------------------------------------------------
// Provider-specific stub helpers — each produces a Response-like body for the
// three providers given a high-level intent ('plain-text', 'tool-call', etc.).
// ---------------------------------------------------------------------------

function sseBody(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function ndjsonBody(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function fakeAnthropicStream(
  events: readonly unknown[],
  finalMessage: {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;
    usage?: { input_tokens: number; output_tokens: number };
  },
): AsyncIterable<unknown> & { finalMessage: () => Promise<typeof finalMessage>; abort: () => void } {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => i < events.length
          ? { value: events[i++], done: false }
          : { value: undefined, done: true },
      };
    },
    finalMessage: async () => finalMessage,
    abort: () => undefined,
  };
}

// ---------------------------------------------------------------------------

const BASELINE_PATH = join(__dirname, 'parity-baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as {
  'parity-plain-text': { frames: Array<Record<string, unknown>> };
  'parity-single-tool-call': { frames: Array<Record<string, unknown>> };
  'parity-invalid-json-tool-args': {
    accepted_outcomes: Array<{ kind: string; frame: Record<string, unknown> }>;
  };
};

describe('Provider parity (tool-use, Dimension 6)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    messagesCreateSpy.mockReset();
    messagesStreamSpy.mockReset();
  });

  it('parity-plain-text — same prompt yields identical frame shape across ollama/openai/anthropic', async () => {
    const messages: readonly ChatMessage[] = [{ role: 'user', content: 'Reply with the word OK.' }];
    const opts = { model: 'm', maxTokens: 128 };

    // --- OpenAI stub ---
    const openai = new OpenAIAdapter();
    await openai.connect({ baseUrl: 'https://api.openai.com', apiKey: 'sk-x' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    const openAiFrames = normalise(await collect(openai.completeStream!(messages, opts)));

    // --- Ollama stub ---
    const ollama = new OllamaAdapter();
    await ollama.connect({ baseUrl: 'http://localhost:11434' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: ndjsonBody([
        '{"message":{"content":"OK"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ]),
    });
    const ollamaFrames = normalise(await collect(ollama.completeStream!(messages, opts)));

    // --- Anthropic stub ---
    const anthropic = new AnthropicAdapter();
    await anthropic.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-x' });
    messagesStreamSpy.mockReturnValueOnce(
      fakeAnthropicStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } }],
        { content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 1, output_tokens: 1 } },
      ),
    );
    const anthFrames = normalise(await collect(anthropic.completeStream!(messages, opts)));

    // All three must match the baseline shape.
    const expected = baseline['parity-plain-text'].frames;
    expect(openAiFrames).toEqual(expected);
    expect(ollamaFrames).toEqual(expected);
    expect(anthFrames).toEqual(expected);
  });

  it('parity-single-tool-call — same prompt + tool manifest yields identical tool_calls frame', async () => {
    const messages: readonly ChatMessage[] = [{ role: 'user', content: 'Scan example.com' }];
    const opts = {
      model: 'm',
      maxTokens: 128,
      tools: [
        {
          name: 'scan_site',
          description: 'start a scan',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
      ] as const,
    };

    // --- OpenAI stub: one tool_call for scan_site({url:'https://example.com'}) ---
    const openai = new OpenAIAdapter();
    await openai.connect({ baseUrl: 'https://api.openai.com', apiKey: 'sk-x' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"scan_site","arguments":"{\\"url\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"https://example.com\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    const openAiFrames = normalise(await collect(openai.completeStream!(messages, opts)));

    // --- Ollama stub ---
    const ollama = new OllamaAdapter();
    await ollama.connect({ baseUrl: 'http://localhost:11434' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: ndjsonBody([
        '{"message":{"content":""},"done":false}\n',
        '{"message":{"content":"","tool_calls":[{"function":{"name":"scan_site","arguments":{"url":"https://example.com"}}}]},"done":true}\n',
      ]),
    });
    const ollamaFrames = normalise(await collect(ollama.completeStream!(messages, opts)));

    // --- Anthropic stub ---
    const anthropic = new AnthropicAdapter();
    await anthropic.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-x' });
    messagesStreamSpy.mockReturnValueOnce(
      fakeAnthropicStream(
        [
          { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"url":' } },
          { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"https://example.com"}' } },
          { type: 'content_block_stop' },
        ],
        {
          content: [
            { type: 'tool_use', id: 'toolu_01', name: 'scan_site', input: { url: 'https://example.com' } },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ),
    );
    const anthFrames = normalise(await collect(anthropic.completeStream!(messages, opts)));

    const expected = baseline['parity-single-tool-call'].frames;
    expect(openAiFrames).toEqual(expected);
    expect(ollamaFrames).toEqual(expected);
    expect(anthFrames).toEqual(expected);
  });

  it('parity-invalid-json-tool-args — each adapter lands on one of the accepted baseline outcomes', async () => {
    const messages: readonly ChatMessage[] = [{ role: 'user', content: 'Scan example.com' }];
    const opts = {
      model: 'm',
      maxTokens: 128,
      tools: [
        {
          name: 'scan_site',
          description: 'start a scan',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url'],
          },
        },
      ] as const,
    };

    // --- OpenAI: truncated JSON for the tool_call args (no closing brace). ---
    const openai = new OpenAIAdapter();
    await openai.connect({ baseUrl: 'https://api.openai.com', apiKey: 'sk-x' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"scan_site","arguments":"{\\"url\\":\\"http"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    const openAiFrames = normalise(await collect(openai.completeStream!(messages, opts)));

    // --- Ollama: args is a string (bad JSON) — adapter falls back to {}. ---
    const ollama = new OllamaAdapter();
    await ollama.connect({ baseUrl: 'http://localhost:11434' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: ndjsonBody([
        '{"message":{"content":"","tool_calls":[{"function":{"name":"scan_site","arguments":"{\\"url\\":\\"http"}}]},"done":true}\n',
      ]),
    });
    const ollamaFrames = normalise(await collect(ollama.completeStream!(messages, opts)));

    // --- Anthropic: SDK's finalMessage() delivers the assembled tool_use object.
    // If the provider sends malformed partial_json, the SDK's own parser would
    // throw; we simulate the "best-effort-parse" baseline by having finalMessage
    // deliver an empty-input tool_use. ---
    const anthropic = new AnthropicAdapter();
    await anthropic.connect({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-x' });
    messagesStreamSpy.mockReturnValueOnce(
      fakeAnthropicStream(
        [
          { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"url":"http' } },
          { type: 'content_block_stop' },
        ],
        {
          content: [{ type: 'tool_use', id: 'toolu_01', name: 'scan_site', input: {} }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ),
    );
    const anthFrames = normalise(await collect(anthropic.completeStream!(messages, opts)));

    const accepted = baseline['parity-invalid-json-tool-args'].accepted_outcomes;
    // Each adapter's final non-done frame must match one of the accepted outcomes.
    for (const [label, frames] of [
      ['openai', openAiFrames],
      ['ollama', ollamaFrames],
      ['anthropic', anthFrames],
    ] as const) {
      const critical = frames.find((f) => f.type === 'error' || f.type === 'tool_calls');
      expect(critical, `${label} must emit at least one error OR tool_calls frame`).toBeDefined();
      const matches = accepted.some((outcome) => {
        if (outcome.kind === 'error_frame') {
          return critical!.type === 'error'
            && (critical as { code?: unknown }).code === outcome.frame.code
            && (critical as { retryable?: unknown }).retryable === outcome.frame.retryable;
        }
        // best_effort_parse — tool_calls with best-effort-parsed args (name matches, args may be {} or parsed)
        if (outcome.kind === 'best_effort_parse') {
          if (critical!.type !== 'tool_calls') return false;
          const calls = (critical as { calls: Array<{ name: string; args: unknown }> }).calls;
          return calls.some((c) => c.name === 'scan_site');
        }
        return false;
      });
      expect(matches, `${label} must match an accepted parity outcome`).toBe(true);
    }
  });
});
