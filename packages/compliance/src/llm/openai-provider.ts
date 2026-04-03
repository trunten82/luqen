import type { IComplianceLLMProvider, ExtractedRequirements } from '../types.js';
import { buildExtractionPrompt } from './prompt.js';
import { parseExtractedRequirements } from './parse-response.js';

export class OpenAIProvider implements IComplianceLLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gpt-4o',
    private readonly baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async extractRequirements(pageContent: string, context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  }): Promise<ExtractedRequirements> {
    const prompt = buildExtractionPrompt(pageContent, context);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are an accessibility regulation analyst. Respond only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices[0]?.message?.content ?? '';
    return parseExtractedRequirements(text);
  }
}
