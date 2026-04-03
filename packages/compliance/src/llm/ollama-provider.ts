import type { IComplianceLLMProvider, ExtractedRequirements } from '../types.js';
import { buildExtractionPrompt } from './prompt.js';
import { parseExtractedRequirements } from './parse-response.js';

export class OllamaProvider implements IComplianceLLMProvider {
  constructor(
    private readonly baseUrl: string = 'http://localhost:11434',
    private readonly model: string = 'llama3.1',
  ) {}

  async extractRequirements(pageContent: string, context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  }): Promise<ExtractedRequirements> {
    const prompt = buildExtractionPrompt(pageContent, context);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as { response: string };
    return parseExtractedRequirements(data.response);
  }
}
