import type { IComplianceLLMProvider, ExtractedRequirements } from '../types.js';
import { buildExtractionPrompt } from './prompt.js';
import { parseExtractedRequirements } from './parse-response.js';

export class AnthropicProvider implements IComplianceLLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'claude-sonnet-4-20250514',
  ) {}

  async extractRequirements(pageContent: string, context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  }): Promise<ExtractedRequirements> {
    const prompt = buildExtractionPrompt(pageContent, context);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content.find(c => c.type === 'text')?.text ?? '';
    return parseExtractedRequirements(text);
  }
}
