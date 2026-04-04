import type { ExtractedRequirements } from '../types.js';

export class LLMClient {
  private readonly baseUrl: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Ensure we have a valid OAuth2 token, refreshing if needed. */
  private async ensureToken(): Promise<string> {
    if (this.token !== null && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const response = await fetch(`${this.baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.token = null;
      throw new Error(`LLM OAuth token error ${response.status}: ${body.slice(0, 200)}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    if (typeof raw['access_token'] !== 'string' || typeof raw['expires_in'] !== 'number' || raw['expires_in'] <= 0) {
      this.token = null;
      throw new Error('Malformed token response from LLM service');
    }

    this.token = raw['access_token'];
    this.tokenExpiresAt = Date.now() + (raw['expires_in'] as number) * 1000;
    return this.token;
  }

  async extractRequirements(input: {
    readonly content: string;
    readonly regulationId: string;
    readonly regulationName: string;
    readonly jurisdictionId?: string;
  }): Promise<ExtractedRequirements & { model?: string; provider?: string }> {
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/api/v1/extract-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000), // 3min outer timeout
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM service error ${res.status}: ${body.slice(0, 300)}`);
    }

    return res.json() as Promise<ExtractedRequirements & { model?: string; provider?: string }>;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export function createLLMClient(config?: { llmUrl?: string; llmClientId?: string; llmClientSecret?: string }): LLMClient | undefined {
  const url = config?.llmUrl ?? process.env['COMPLIANCE_LLM_URL'];
  const clientId = config?.llmClientId ?? process.env['COMPLIANCE_LLM_CLIENT_ID'];
  const clientSecret = config?.llmClientSecret ?? process.env['COMPLIANCE_LLM_CLIENT_SECRET'];
  if (!url || !clientId || !clientSecret) return undefined;
  return new LLMClient(url.replace(/\/$/, ''), clientId, clientSecret);
}
