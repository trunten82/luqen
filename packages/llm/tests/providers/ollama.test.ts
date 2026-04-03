import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaAdapter } from '../../src/providers/ollama.js';

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

  it('complete returns CompletionResult', async () => {
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
});
