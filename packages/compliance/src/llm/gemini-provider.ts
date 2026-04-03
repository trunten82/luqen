import type { IComplianceLLMProvider, ExtractedRequirements } from '../types.js';
import { buildExtractionPrompt } from './prompt.js';
import { parseExtractedRequirements } from './parse-response.js';

export class GeminiProvider implements IComplianceLLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gemini-2.0-flash',
  ) {}

  async extractRequirements(pageContent: string, context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  }): Promise<ExtractedRequirements> {
    const prompt = buildExtractionPrompt(pageContent, context);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const text = data.candidates[0]?.content?.parts[0]?.text ?? '';
    return parseExtractedRequirements(text);
  }
}
