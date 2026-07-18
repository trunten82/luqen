import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAdapter } from '../../src/providers/gemini.js';
import type { StreamFrame } from '../../src/providers/types.js';
import { ProviderHttpError } from '../../src/providers/types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    adapter = new GeminiAdapter();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await adapter.connect({ baseUrl: BASE_URL, apiKey: 'test-key' });
  });

  it('has type gemini', () => {
    expect(adapter.type).toBe('gemini');
  });

  it('connect defaults baseUrl to the generativelanguage endpoint when empty', async () => {
    const a = new GeminiAdapter();
    await a.connect({ baseUrl: '', apiKey: 'k' });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) });
    await a.healthCheck();
    expect(mockFetch.mock.calls[0][0]).toContain(BASE_URL);
  });

  it('healthCheck returns true when response is ok and passes key as query param', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) });
    const result = await adapter.healthCheck();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/models?key=test-key`);
    // never log/leak key in a header
    const init = mockFetch.mock.calls[0][1];
    expect(init).toBeUndefined();
  });

  it('healthCheck returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    expect(await adapter.healthCheck()).toBe(false);
  });

  it('listModels maps models[] to RemoteModel, stripping the "models/" prefix and filtering by generateContent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
          {
            name: 'models/embedding-001',
            displayName: 'Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      }),
    });
    const models = await adapter.listModels();
    expect(models).toEqual([
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ]);
  });

  it('complete sends correct generateContent format and folds systemPrompt into systemInstruction', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
      }),
    });

    const result = await adapter.complete('Say hello', {
      model: 'gemini-2.5-flash',
      maxTokens: 200,
      temperature: 0.5,
      systemPrompt: 'You are a compliance expert',
    });

    expect(result.text).toBe('Hello from Gemini');
    expect(result.usage.inputTokens).toBe(15);
    expect(result.usage.outputTokens).toBe(25);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/models/gemini-2.5-flash:generateContent?key=test-key`);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('Say hello');
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are a compliance expert' }] });
    expect(body.generationConfig.maxOutputTokens).toBe(200);
    expect(body.generationConfig.temperature).toBe(0.5);
  });

  it('complete() throws ProviderHttpError (not a silently-empty result) on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '{"error":"overloaded"}',
    });

    let caught: unknown;
    try {
      await adapter.complete('Say hello', { model: 'gemini-2.5-flash' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProviderHttpError);
    expect((caught as ProviderHttpError).retryable).toBe(true);
  });

  it('complete concatenates all candidate parts and tolerates missing usage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'foo' }, { text: 'bar' }] } }],
      }),
    });
    const result = await adapter.complete('hi', { model: 'gemini-2.5-flash' });
    expect(result.text).toBe('foobar');
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('complete attaches inline_data parts when options.images present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'a styled div, not an h2' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 12 },
      }),
    });

    await adapter.complete('Is this a real heading?', {
      model: 'gemini-2.5-flash',
      images: [{ mediaType: 'image/png', data: 'PNGDATA' }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ text: 'Is this a real heading?' });
    const imgPart = parts.find((p: { inline_data?: unknown }) => p.inline_data);
    expect(imgPart.inline_data).toEqual({ mime_type: 'image/png', data: 'PNGDATA' });
  });

  // ========================================================================
  // Streaming tests (D-11 contract)
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

  it('completeStream hits streamGenerateContent with alt=sse and key query params', async () => {
    const body = sseStream(['data: {"candidates":[{"finishReason":"STOP"}]}\n\n']);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hi' }],
        { model: 'gemini-2.5-flash', maxTokens: 16 },
      ),
    );

    expect(mockFetch.mock.calls[0][0]).toBe(
      `${BASE_URL}/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=test-key`,
    );
  });

  it('Test 1: completeStream streams text parts as token frames then a done frame with usage', async () => {
    const body = sseStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}\n\n',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    expect(adapter.completeStream).toBeDefined();

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gemini-2.5-flash', maxTokens: 256 },
      ),
    );

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: 'token', text: 'Hi' });
    expect(tokens[1]).toEqual({ type: 'token', text: ' there' });

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it('Test 1b: completeStream parses CRLF-delimited SSE frames (real Gemini wire format)', async () => {
    // The live Gemini API separates SSE frames with \r\n\r\n, not \n\n. The
    // second frame's delimiter is split across two chunks to cover a CR/LF
    // pair straddling a network read boundary.
    const body = sseStream([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}\r\n',
      '\r\ndata: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\r\n\r\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gemini-2.5-flash', maxTokens: 256 },
      ),
    );

    const tokens = frames.filter((f) => f.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: 'token', text: 'Hi' });
    expect(tokens[1]).toEqual({ type: 'token', text: ' there' });
    expect(frames.find((f) => f.type === 'done')).toMatchObject({
      type: 'done',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it('Test 2: completeStream emits ONE tool_calls frame for functionCall parts (after tokens)', async () => {
    const body = sseStream([
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"scan_site","args":{"url":"https://example.com"}}}]}}]}\n\n',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}\n\n',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'Scan example.com' }],
        {
          model: 'gemini-2.5-flash',
          maxTokens: 256,
          tools: [
            {
              name: 'scan_site',
              description: 'start a scan',
              inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
            },
          ],
        },
      ),
    );

    // No token frames for tool calls
    expect(frames.filter((f) => f.type === 'token')).toHaveLength(0);

    const toolCallsFrames = frames.filter((f) => f.type === 'tool_calls');
    expect(toolCallsFrames).toHaveLength(1);
    const tc = toolCallsFrames[0] as Extract<StreamFrame, { type: 'tool_calls' }>;
    expect(tc.calls).toHaveLength(1);
    expect(tc.calls[0]).toEqual({
      id: 'call_0',
      name: 'scan_site',
      args: { url: 'https://example.com' },
    });

    const done = frames.find((f) => f.type === 'done');
    expect(done).toMatchObject({ type: 'done', finishReason: 'tool_calls' });

    // tool declarations were sent in the request body
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.tools[0].functionDeclarations[0]).toMatchObject({ name: 'scan_site' });
  });

  it('Test 3: completeStream emits error frame when fetch returns 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gemini-2.5-flash' },
      ),
    );

    const errFrame = frames.find((f) => f.type === 'error');
    expect(errFrame).toBeDefined();
    expect(errFrame).toMatchObject({ type: 'error', code: 'provider_failed', retryable: true });
  });

  it('Test 4: completeStream yields error when signal is already aborted, with no network call', async () => {
    const controller = new AbortController();
    controller.abort();

    const frames = await collect(
      adapter.completeStream!(
        [{ role: 'user', content: 'hello' }],
        { model: 'gemini-2.5-flash' },
        controller.signal,
      ),
    );

    expect(frames.find((f) => f.type === 'error')).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('completeStream maps assistant role to "model" and folds system into systemInstruction', async () => {
    const body = sseStream(['data: {"candidates":[{"finishReason":"STOP"}]}\n\n']);
    mockFetch.mockResolvedValueOnce({ ok: true, body });

    await collect(
      adapter.completeStream!(
        [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'bye' },
        ],
        { model: 'gemini-2.5-flash' },
      ),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
    expect(sentBody.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });
});
