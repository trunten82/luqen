import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIAdapter } from '../../src/providers/openai.js';

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
});
