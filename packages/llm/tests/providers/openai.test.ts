import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from '../../src/providers/openai.js';
import type { StreamFrame } from '../../src/providers/types.js';

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    adapter = new OpenAIAdapter();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await adapter.connect({ baseUrl: 'https://api.openai.com', apiKey: 'sk-test-key' });
  });

  it('has type openai', () => {
    expect(adapter.type).toBe('openai');
  });

  it('healthCheck returns true when response is ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-key' }),
      }),
    );
  });

  it('listModels maps data array to RemoteModel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' },
        ],
      }),
    });
    const models = await adapter.listModels();
    expect(models).toEqual([
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
    ]);
  });

  it('complete sends correct format and auth header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from OpenAI' } }],
        usage: { prompt_tokens: 15, completion_tokens: 25 },
      }),
    });

    const result = await adapter.complete('Say hello', {
      model: 'gpt-4o',
      maxTokens: 200,
      temperature: 0.5,
    });

    expect(result.text).toBe('Hello from OpenAI');
    expect(result.usage.inputTokens).toBe(15);
    expect(result.usage.outputTokens).toBe(25);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers['Authorization']).toBe('Bearer sk-test-key');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(200);
    expect(body.temperature).toBe(0.5);
  });

  it('complete includes system prompt as first message when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 8, completion_tokens: 12 },
      }),
    });

    await adapter.complete('User message', {
      model: 'gpt-4o',
      systemPrompt: 'You are a compliance expert',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a compliance expert' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'User message' });
  });

  // ========================================================================
  // Phase 32-01 streaming tests (D-11, D-12)
  // ========================================================================

  function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
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

  it('Test 1: completeStream streams plain text deltas as token frames', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    expect(adapter.completeStream).toBeDefined();

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gpt-4o-mini', maxTokens: 256 },
      ),
    );

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: 'token', text: 'Hi' });
    expect(tokens[1]).toEqual({ type: 'token', text: ' there' });

    const done = frames.find((f) => f.type === 'done');
    expect(done).toBeDefined();
    expect(done).toMatchObject({ type: 'done', finishReason: 'stop' });
  });

  it('Test 2: completeStream buffers tool_call arguments and emits ONE tool_calls frame', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"foo","arguments":"{\\"a\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'call foo' }],
        { model: 'gpt-4o-mini', maxTokens: 256 },
      ),
    );

    // No token frames should be emitted for tool-call argument JSON
    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens).toHaveLength(0);

    // Exactly one tool_calls frame
    const toolCallsFrames = frames.filter((f) => f.type === 'tool_calls');
    expect(toolCallsFrames).toHaveLength(1);
    const tc = toolCallsFrames[0] as Extract<StreamFrame, { type: 'tool_calls' }>;
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0]).toEqual({ id: 'call_1', name: 'foo', args: { a: 1 } });

    // done frame should follow with finishReason='tool_calls'
    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('Test 3: completeStream emits error frame when fetch returns 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gpt-4o-mini' },
      ),
    );

    const errFrame = frames.find((f) => f.type === 'error');
    expect(errFrame).toBeDefined();
    expect(errFrame).toMatchObject({
      type: 'error',
      code: 'provider_failed',
      retryable: true,
    });
  });

  it('Test 4: completeStream yields error when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gpt-4o-mini' },
        controller.signal,
      ),
    );

    const errFrame = frames.find((f) => f.type === 'error');
    expect(errFrame).toBeDefined();
    // No network call should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('completeStream body has stream:true and stream_options.include_usage', async () => {
    const body = sseStream(['data: [DONE]\n\n']);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hi' }],
        { model: 'gpt-4o-mini', maxTokens: 16 },
      ),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
  });
});
