import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import type { ExtractedRequirements } from '../types.js';
import { buildExtractionPrompt } from '../prompts/extract-requirements.js';
import { parseExtractedRequirements } from './parse-extract-response.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError, type CapabilityResult } from './types.js';

export interface ExtractRequirementsInput {
  readonly content: string;
  readonly regulationId: string;
  readonly regulationName: string;
  readonly jurisdictionId?: string;
  readonly orgId?: string;
}

export interface RetryOptions {
  readonly maxRetries?: number;    // per model, default 2
  readonly retryDelayMs?: number;  // initial delay, default 5000
}

function applyPromptTemplate(
  template: string,
  input: ExtractRequirementsInput,
): string {
  return template
    .replace(/\{content\}/g, input.content)
    .replace(/\{regulationId\}/g, input.regulationId)
    .replace(/\{regulationName\}/g, input.regulationName)
    .replace(/\{jurisdictionId\}/g, input.jurisdictionId ?? '');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeExtractRequirements(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: ExtractRequirementsInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<ExtractedRequirements>> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 5000;

  const models = await db.getModelsForCapability('extract-requirements', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('extract-requirements');
  }

  const promptOverride = await db.getPromptOverride('extract-requirements', input.orgId);

  let totalAttempts = 0;
  let lastError: Error | undefined;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) {
      continue;
    }

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
          : buildExtractionPrompt(input.content, {
              regulationId: input.regulationId,
              regulationName: input.regulationName,
            });

        const result = await adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0.1,
          timeout: provider.timeout,
        });

        const data = parseExtractedRequirements(result.text);

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

  throw new CapabilityExhaustedError('extract-requirements', totalAttempts, lastError);
}
