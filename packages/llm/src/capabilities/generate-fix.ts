import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import { buildGenerateFixPrompt } from '../prompts/generate-fix.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError, type CapabilityResult } from './types.js';

export interface GenerateFixInput {
  readonly wcagCriterion: string;
  readonly issueMessage: string;
  readonly htmlContext: string;
  readonly cssContext?: string;
  readonly orgId?: string;
}

export interface GenerateFixResult {
  readonly fixedHtml: string;
  readonly explanation: string;
  readonly effort: 'low' | 'medium' | 'high';
}

export function parseGenerateFixResponse(text: string): GenerateFixResult {
  try {
    // Strip markdown fences (```json ... ```) that LLMs often add despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    // Try to extract JSON object if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const effort = parsed['effort'];
    return {
      fixedHtml: typeof parsed['fixedHtml'] === 'string' ? parsed['fixedHtml'] : '',
      explanation: typeof parsed['explanation'] === 'string' ? parsed['explanation'] : '',
      effort: effort === 'low' || effort === 'high' ? effort : 'medium',
    };
  } catch {
    return { fixedHtml: '', explanation: '', effort: 'medium' };
  }
}

function applyPromptTemplate(template: string, input: GenerateFixInput): string {
  return template
    .replace(/\{\{wcagCriterion\}\}/g, input.wcagCriterion)
    .replace(/\{\{issueMessage\}\}/g, input.issueMessage)
    .replace(/\{\{htmlContext\}\}/g, input.htmlContext)
    .replace(/\{\{cssContext\}\}/g, input.cssContext ?? '');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

export async function executeGenerateFix(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: GenerateFixInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<GenerateFixResult>> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 5000;

  const models = await db.getModelsForCapability('generate-fix', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('generate-fix');
  }

  const promptOverride = await db.getPromptOverride('generate-fix', input.orgId);
  let totalAttempts = 0;
  let lastError: Error | undefined;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      totalAttempts += 1;

      if (attempt > 0 && retryDelayMs > 0) {
        const delay = retryDelayMs * Math.pow(3, attempt - 1);
        await sleep(delay);
      }

      try {
        const adapter = adapterFactory(provider.type);
        await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });

        const prompt = promptOverride != null
          ? applyPromptTemplate(promptOverride.template, input)
          : buildGenerateFixPrompt(input);

        const result = await adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0.2,
          timeout: provider.timeout,
        });

        const data = parseGenerateFixResponse(result.text);

        return {
          data,
          model: model.displayName,
          provider: provider.name,
          attempts: totalAttempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw new CapabilityExhaustedError('generate-fix', totalAttempts, lastError);
}
