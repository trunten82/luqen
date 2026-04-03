import type { IComplianceLLMProvider, ExtractedRequirements } from '../types.js';

/**
 * LLM provider that bridges to the dashboard's active LLM plugin via HTTP.
 *
 * The compliance service doesn't load LLM plugins directly — instead it
 * calls POST /api/v1/llm/extract on the dashboard, which routes the
 * request to whichever LLM plugin (Ollama, OpenAI, etc.) is active.
 */
export class DashboardLLMBridge implements IComplianceLLMProvider {
  constructor(
    private readonly dashboardUrl: string,
    private readonly apiKey: string,
  ) {}

  async extractRequirements(
    pageContent: string,
    context: {
      readonly regulationId: string;
      readonly regulationName: string;
      readonly currentWcagVersion?: string;
      readonly currentWcagLevel?: string;
    },
  ): Promise<ExtractedRequirements> {
    const response = await fetch(`${this.dashboardUrl}/api/v1/llm/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ pageContent, context }),
      signal: AbortSignal.timeout(120_000), // LLM calls can be slow
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Dashboard LLM bridge error ${response.status}: ${body.slice(0, 300)}`);
    }

    return response.json() as Promise<ExtractedRequirements>;
  }
}

/**
 * Create an LLM bridge if dashboard URL and API key are available.
 * Returns undefined if env vars are not set.
 */
export function createLLMBridge(): IComplianceLLMProvider | undefined {
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? process.env['COMPLIANCE_DASHBOARD_URL'];
  const apiKey = process.env['DASHBOARD_API_KEY'] ?? process.env['COMPLIANCE_DASHBOARD_API_KEY'];

  if (!dashboardUrl || !apiKey) {
    return undefined;
  }

  return new DashboardLLMBridge(dashboardUrl.replace(/\/$/, ''), apiKey);
}
