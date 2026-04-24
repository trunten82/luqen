/**
 * Phase 34-01 Task 3 — Ollama tokenizer tests (A–F).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  configureOllamaTokenizer,
  warm,
  countText,
  _resetOllamaCacheForTest,
  LARGE_VOCAB_THRESHOLD,
} from '../../../src/agent/tokenizer/ollama-tokenizer.js';

const BASE_URL = 'http://ollama.test';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function notOkResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

describe('ollama-tokenizer', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetOllamaCacheForTest();
    configureOllamaTokenizer({ baseUrl: BASE_URL });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Test A: warm() calls /api/show once and populates cache', async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ details: { tokenizer: 'llama' }, model_info: { 'llama.vocab_size': 128000 } }),
    );
    await warm('llama3.1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE_URL}/api/show`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'llama3.1' }),
      }),
    );
    // Cache now has an entry — sync read returns a positive integer.
    const n = countText('llama3.1', 'hello world');
    expect(n).toBeGreaterThan(0);
  });

  it('Test A.large-vocab: avgCharsPerToken tighter when vocab > threshold', async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ details: { tokenizer: 'llama' }, model_info: { 'llama.vocab_size': LARGE_VOCAB_THRESHOLD + 1 } }),
    );
    await warm('llama3.1');
    const n = countText('llama3.1', 'a'.repeat(320));
    // 320 / 3.2 = 100
    expect(n).toBe(100);
  });

  it('Test B: warm() returns silently on 404; cache miss → countText undefined', async () => {
    fetchSpy.mockResolvedValueOnce(notOkResponse(404));
    await expect(warm('llama3.1')).resolves.toBeUndefined();
    expect(countText('llama3.1', 'hello')).toBeUndefined();
  });

  it('Test C: warm() returns silently on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(warm('llama3.1')).resolves.toBeUndefined();
    expect(countText('llama3.1', 'hello')).toBeUndefined();
  });

  it('Test D: sync countText before warm returns undefined; no fetch triggered', () => {
    const n = countText('llama3.1', 'hello');
    expect(n).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Test E: sync countText after warm returns positive integer', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ details: { tokenizer: 'llama' }, model_info: {} }));
    await warm('llama3.1');
    const short = countText('llama3.1', 'hello')!;
    const longer = countText('llama3.1', 'hello world hello world')!;
    expect(short).toBeGreaterThan(0);
    expect(longer).toBeGreaterThan(short);
    expect(countText('llama3.1', '')).toBe(0);
  });

  it('Test F: SSRF guard — model name goes in JSON body, URL is fixed baseUrl', async () => {
    fetchSpy.mockResolvedValue(okResponse({ details: {}, model_info: {} }));
    await warm('../etc/passwd');
    await warm('http://evil.com/x');
    // Both calls target the fixed baseUrl + /api/show; model name is in body only.
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toBe(`${BASE_URL}/api/show`);
      expect(call[1].method).toBe('POST');
    }
    expect(fetchSpy.mock.calls[0][1].body).toBe(JSON.stringify({ name: '../etc/passwd' }));
    expect(fetchSpy.mock.calls[1][1].body).toBe(JSON.stringify({ name: 'http://evil.com/x' }));
  });

  it('Test F.in-flight dedup: concurrent warm() calls share a single fetch', async () => {
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const p1 = warm('llama3.1');
    const p2 = warm('llama3.1');
    const p3 = warm('llama3.1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch(okResponse({ details: {}, model_info: {} }));
    await Promise.all([p1, p2, p3]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Cache LRU-lite cap at 32 entries: oldest evicted on overflow', async () => {
    fetchSpy.mockResolvedValue(okResponse({ details: {}, model_info: {} }));
    for (let i = 0; i < 35; i += 1) {
      await warm(`model-${i}`);
    }
    // model-0 through model-2 should have been evicted; model-3 still present.
    expect(countText('model-0', 'hello')).toBeUndefined();
    expect(countText('model-1', 'hello')).toBeUndefined();
    expect(countText('model-2', 'hello')).toBeUndefined();
    expect(countText('model-3', 'hello')).toBeDefined();
    expect(countText('model-34', 'hello')).toBeDefined();
  });
});
