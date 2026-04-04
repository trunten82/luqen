import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMClient, createLLMClient } from '../../src/llm/llm-client.js';

describe('LLMClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['COMPLIANCE_LLM_URL'];
    delete process.env['COMPLIANCE_LLM_CLIENT_ID'];
    delete process.env['COMPLIANCE_LLM_CLIENT_SECRET'];
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

    it('returns undefined when only clientId provided', () => {
      const client = createLLMClient({ llmClientId: 'test-id' });
      expect(client).toBeUndefined();
    });

    it('returns undefined when clientSecret missing', () => {
      const client = createLLMClient({ llmUrl: 'http://localhost:4200', llmClientId: 'test-id' });
      expect(client).toBeUndefined();
    });

    it('returns LLMClient when url, clientId, and clientSecret provided', () => {
      const client = createLLMClient({
        llmUrl: 'http://localhost:4200',
        llmClientId: 'test-id',
        llmClientSecret: 'test-secret',
      });
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('strips trailing slash from url', () => {
      const client = createLLMClient({
        llmUrl: 'http://localhost:4200/',
        llmClientId: 'test-id',
        llmClientSecret: 'test-secret',
      });
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('reads from environment variables', () => {
      process.env['COMPLIANCE_LLM_URL'] = 'http://localhost:4200';
      process.env['COMPLIANCE_LLM_CLIENT_ID'] = 'env-id';
      process.env['COMPLIANCE_LLM_CLIENT_SECRET'] = 'env-secret';
      const client = createLLMClient();
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('config overrides environment variables', () => {
      process.env['COMPLIANCE_LLM_URL'] = 'http://env-host:4200';
      process.env['COMPLIANCE_LLM_CLIENT_ID'] = 'env-id';
      process.env['COMPLIANCE_LLM_CLIENT_SECRET'] = 'env-secret';
      const client = createLLMClient({
        llmUrl: 'http://config-host:4200',
        llmClientId: 'config-id',
        llmClientSecret: 'config-secret',
      });
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe('healthCheck', () => {
    it('returns true when health endpoint responds ok', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const client = new LLMClient('http://localhost:4200', 'test-id', 'test-secret');
      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4200/api/v1/health',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    it('returns false when health endpoint returns non-ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }));

      const client = new LLMClient('http://localhost:4200', 'test-id', 'test-secret');
      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')));

      const client = new LLMClient('http://localhost:4200', 'test-id', 'test-secret');
      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('extractRequirements', () => {
    it('obtains OAuth2 token then calls endpoint', async () => {
      const mockTokenResponse = {
        ok: true,
        json: () => Promise.resolve({ access_token: 'oauth-token-123', expires_in: 3600 }),
      };
      const mockExtractResponse = {
        ok: true,
        json: () => Promise.resolve({
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          criteria: [{ criterion: '1.1.1', obligation: 'mandatory' as const, notes: 'Alt text' }],
          confidence: 0.95,
          model: 'test-model',
          provider: 'test-provider',
        }),
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(mockTokenResponse)
        .mockResolvedValueOnce(mockExtractResponse);
      vi.stubGlobal('fetch', fetchMock);

      const client = new LLMClient('http://localhost:4200', 'client-id', 'client-secret');
      const result = await client.extractRequirements({
        content: 'regulation text',
        regulationId: 'reg-1',
        regulationName: 'Test Reg',
        jurisdictionId: 'US',
      });

      expect(result.wcagVersion).toBe('2.1');
      expect(result.confidence).toBe(0.95);

      // First call: token request
      expect(fetchMock).toHaveBeenNthCalledWith(1,
        'http://localhost:4200/api/v1/oauth/token',
        expect.objectContaining({ method: 'POST' }),
      );

      // Second call: extract requirements with Bearer token
      expect(fetchMock).toHaveBeenNthCalledWith(2,
        'http://localhost:4200/api/v1/extract-requirements',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer oauth-token-123',
          }),
        }),
      );
    });

    it('throws on non-ok response', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: () => Promise.resolve('Bad Gateway'),
        });
      vi.stubGlobal('fetch', fetchMock);

      const client = new LLMClient('http://localhost:4200', 'test-id', 'test-secret');
      await expect(client.extractRequirements({
        content: 'text',
        regulationId: 'reg-1',
        regulationName: 'Test',
      })).rejects.toThrow('LLM service error 502');
    });

    it('throws on OAuth token failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }));

      const client = new LLMClient('http://localhost:4200', 'bad-id', 'bad-secret');
      await expect(client.extractRequirements({
        content: 'text',
        regulationId: 'reg-1',
        regulationName: 'Test',
      })).rejects.toThrow('LLM OAuth token error 401');
    });
  });
});
