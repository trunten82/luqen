import type { ExtractedRequirements } from '../types.js';

export class LLMClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async extractRequirements(input: {
    readonly content: string;
    readonly regulationId: string;
    readonly regulationName: string;
    readonly jurisdictionId?: string;
  }): Promise<ExtractedRequirements & { model?: string; provider?: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/extract-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
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

export function createLLMClient(config?: { llmUrl?: string; llmApiKey?: string }): LLMClient | undefined {
  const url = config?.llmUrl ?? process.env['COMPLIANCE_LLM_URL'];
  const key = config?.llmApiKey ?? process.env['COMPLIANCE_LLM_API_KEY'];
  if (!url || !key) return undefined;
  return new LLMClient(url.replace(/\/$/, ''), key);
}
