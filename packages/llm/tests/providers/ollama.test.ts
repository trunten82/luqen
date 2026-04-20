import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from '../../src/providers/ollama.js';
import type { StreamFrame } from '../../src/providers/types.js';

describe('OllamaAdapter', () => {
  let adapter: OllamaAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    adapter = new OllamaAdapter();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await adapter.connect({ baseUrl: 'http://localhost:11434/' });
  });

  it('has type ollama', () => {
    expect(adapter.type).toBe('ollama');
  });

  it('connect strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) });
    await adapter.listModels();
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
  });

  it('healthCheck returns true when response is ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
  });

  it('healthCheck returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await adapter.healthCheck();
    expect(result).toBe(false);
  });

  it('listModels maps models array to RemoteModel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3.2' },
          { name: 'mistral' },
        ],
      }),
    });
    const models = await adapter.listModels();
    expect(models).toEqual([
      { id: 'llama3.2', name: 'llama3.2' },
      { id: 'mistral', name: 'mistral' },
    ]);
  });

  it('complete returns CompletionResult (Test 7 — regression-free)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Hello from Ollama' },
        prompt_eval_count: 10,
        eval_count: 20,
      }),
    });

    const result = await adapter.complete('Say hello', { model: 'llama3.2', temperature: 0.7, maxTokens: 100 });

    expect(result.text).toBe('Hello from Ollama');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(20);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0.7);
    expect(body.options.num_predict).toBe(100);
  });

  it('complete aborts on timeout', async () => {
    await adapter.connect({ baseUrl: 'http://localhost:11434' });
    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }
        // Never resolves — simulates a slow server
      })
    );
    await expect(adapter.complete('test', { model: 'x', timeout: 0.01 })).rejects.toThrow();
  }, 10000);

  it('complete includes system prompt as first message when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Response' },
        prompt_eval_count: 5,
        eval_count: 10,
      }),
    });

    await adapter.complete('User message', {
      model: 'llama3.2',
      systemPrompt: 'You are a helpful assistant',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'User message' });
  });

  // ========================================================================
  // Phase 32-01 streaming tests (D-11)
  // ========================================================================

  function ndjsonStream(lines: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      },
    });
  }

  async function collect(iter: AsyncIterable<StreamFrame>): Promise<StreamFrame[]> {
    const frames: StreamFrame[] = [];
    for await (const f of iter) frames.push(f);
    return frames;
  }

  it('Test 5: completeStream plain text — yields token frames + done frame', async () => {
    const body = ndjsonStream([
      '{"message":{"role":"assistant","content":"Hi"},"done":false}\n',
      '{"message":{"role":"assistant","content":" there"},"done":true}\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    expect(adapter.completeStream).toBeDefined();

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'llama3.2', maxTokens: 256 },
      ),
    );

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    // Ollama emits content for done=true chunks too — accept either 1 or 2 token frames
    // but assert the concatenation equals "Hi there"
    const concatenated = tokens.map((f) => (f as Extract<StreamFrame, { type: 'token' }>).text).join('');
    expect(concatenated).toBe('Hi there');

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('Test 6: completeStream tool_calls (D-11 end-of-turn batch) — ZERO token frames + ONE tool_calls + ONE done', async () => {
    const body = ndjsonStream([
      '{"message":{"role":"assistant","content":""},"done":false}\n',
      '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"foo","arguments":{"a":1}}}]},"done":true}\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'call foo' }],
        { model: 'llama3.2', maxTokens: 256 },
      ),
    );

    const tokens = frames.filter((f) => f.type === 'token');
    // D-11 contract: ZERO token frames for empty content
    // Empty content strings should NOT be emitted as token frames
    expect(tokens).toHaveLength(0);

    const toolCallsFrames = frames.filter((f) => f.type === 'tool_calls');
    expect(toolCallsFrames).toHaveLength(1);
    const tc = toolCallsFrames[0] as Extract<StreamFrame, { type: 'tool_calls' }>;
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0].name).toBe('foo');
    expect(tc.calls[0].args).toEqual({ a: 1 });
    expect(tc.calls[0].id).toBeTypeOf('string');
    expect(tc.calls[0].id.length).toBeGreaterThan(0);

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('Test 8: completeStream body has stream:true (no stream:false)', async () => {
    const body = ndjsonStream(['{"message":{"content":"x"},"done":true}\n']);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'llama3.2', maxTokens: 16 },
      ),
    );

    const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sent.stream).toBe(true);
    expect(sent.stream).not.toBe(false);
  });
});
