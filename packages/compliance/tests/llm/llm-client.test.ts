import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMClient, createLLMClient } from '../../src/llm/llm-client.js';

describe('LLMClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['COMPLIANCE_LLM_URL'];
    delete process.env['COMPLIANCE_LLM_API_KEY'];
  });

  describe('createLLMClient', () => {
    it('returns undefined when no config provided', () => {
      const client = createLLMClient();
      expect(client).toBeUndefined();
    });

    it('returns undefined when only url provided', () => {
      const client = createLLMClient({ llmUrl: 'http://localhost:4200' });
      expect(client).toBeUndefined();
    });

    it('returns undefined when only apiKey provided', () => {
      const client = createLLMClient({ llmApiKey: 'test-key' });
      expect(client).toBeUndefined();
    });

    it('returns LLMClient when both url and apiKey provided', () => {
      const client = createLLMClient({ llmUrl: 'http://localhost:4200', llmApiKey: 'test-key' });
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('strips trailing slash from url', () => {
      const client = createLLMClient({ llmUrl: 'http://localhost:4200/', llmApiKey: 'test-key' });
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('reads from environment variables', () => {
      process.env['COMPLIANCE_LLM_URL'] = 'http://localhost:4200';
      process.env['COMPLIANCE_LLM_API_KEY'] = 'env-key';
      const client = createLLMClient();
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('config overrides environment variables', () => {
      process.env['COMPLIANCE_LLM_URL'] = 'http://env-host:4200';
      process.env['COMPLIANCE_LLM_API_KEY'] = 'env-key';
      const client = createLLMClient({ llmUrl: 'http://config-host:4200', llmApiKey: 'config-key' });
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe('healthCheck', () => {
    it('returns true when health endpoint responds ok', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const client = new LLMClient('http://localhost:4200', 'test-key');
      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4200/api/v1/health',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it('returns false when health endpoint returns non-ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));

      const client = new LLMClient('http://localhost:4200', 'test-key');
      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')));

      const client = new LLMClient('http://localhost:4200', 'test-key');
      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('extractRequirements', () => {
    it('calls correct endpoint with correct headers', async () => {
      const mockResponse = {
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        criteria: [{ criterion: '1.1.1', obligation: 'mandatory' as const, notes: 'Alt text' }],
        confidence: 0.95,
        model: 'test-model',
        provider: 'test-provider',
      };

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new LLMClient('http://localhost:4200', 'secret-key');
      const result = await client.extractRequirements({
        content: 'regulation text',
        regulationId: 'reg-1',
        regulationName: 'Test Reg',
        jurisdictionId: 'US',
      });

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4200/api/v1/extract-requirements',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer secret-key',
          }),
        }),
      );
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad Gateway'),
      }));

      const client = new LLMClient('http://localhost:4200', 'test-key');
      await expect(client.extractRequirements({
        content: 'text',
        regulationId: 'reg-1',
        regulationName: 'Test',
      })).rejects.toThrow('LLM service error 502');
    });
  });
});
