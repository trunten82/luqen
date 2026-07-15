import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter, ImageInput } from '../providers/types.js';
import { isNonRetryable } from '../providers/types.js';
import { buildAnalyseVisualPrompt, type VisualCheck } from '../prompts/analyse-visual.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError, type CapabilityResult } from './types.js';
import { recordCompletion } from './record-usage.js';

export type { VisualCheck };

export interface AnalyseVisualInput {
  readonly check: VisualCheck;
  readonly image: ImageInput;
  readonly context: string;
  readonly orgId?: string;
}

export interface VisualFinding {
  readonly description: string;
  readonly wcagCriterion: string;
  readonly confidence: 'low' | 'medium' | 'high';
}

export interface AnalyseVisualResult {
  readonly verdict: 'pass' | 'issue' | 'uncertain';
  readonly findings: readonly VisualFinding[];
  readonly altClassification?: 'decorative' | 'informational';
  readonly suggestedAlt?: string;
}

function asConfidence(v: unknown): 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'high' ? v : 'medium';
}

export function parseAnalyseVisualResponse(text: string, check: VisualCheck): AnalyseVisualResult {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned) as Record<string, unknown>;

    const rawFindings = Array.isArray(parsed['findings']) ? (parsed['findings'] as unknown[]) : [];
    const findings: VisualFinding[] = rawFindings.map((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      return {
        description: typeof o['description'] === 'string' ? o['description'] : '',
        wcagCriterion: typeof o['wcagCriterion'] === 'string' ? o['wcagCriterion'] : (check === 'alt-text' ? '1.1.1' : '1.3.1'),
        confidence: asConfidence(o['confidence']),
      };
    }).filter((f) => f.description.length > 0);

    const verdictRaw = parsed['verdict'];
    const verdict = verdictRaw === 'pass' || verdictRaw === 'issue' || verdictRaw === 'uncertain'
      ? verdictRaw
      : (findings.length > 0 ? 'issue' : 'pass');

    const result: AnalyseVisualResult = { verdict, findings };
    if (check === 'alt-text') {
      const cls = parsed['altClassification'];
      return {
        ...result,
        altClassification: cls === 'decorative' || cls === 'informational' ? cls : 'informational',
        suggestedAlt: typeof parsed['suggestedAlt'] === 'string' ? parsed['suggestedAlt'] : '',
      };
    }
    return result;
  } catch {
    return { verdict: 'uncertain', findings: [] };
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

/**
 * Vision (multimodal) accessibility capability. Sends a screenshot/image plus
 * textual context to a vision-capable model and returns a structured verdict.
 * Backs the Phase 84 behavioral checks (accessibility-tree-vs-visual and
 * contextual alt-text). Degrades via the same model-fallback chain as every
 * other capability; callers treat a thrown error as "Not Evaluated".
 */
export async function executeAnalyseVisual(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: AnalyseVisualInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<AnalyseVisualResult>> {
  const maxRetries = retryOpts?.maxRetries ?? 1;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 3000;

  const models = await db.getModelsForCapability('analyse-visual', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('analyse-visual');
  }

  const promptOverride = await db.getPromptOverride('analyse-visual', input.orgId);
  let totalAttempts = 0;
  let lastError: Error | undefined;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      totalAttempts += 1;
      if (attempt > 0 && retryDelayMs > 0) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }

      try {
        const adapter = adapterFactory(provider.type);
        await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });

        const prompt = promptOverride != null
          ? promptOverride.template.replace(/\{\{context\}\}/g, input.context)
          : buildAnalyseVisualPrompt({ check: input.check, context: input.context });

        const result = await recordCompletion(
          db,
          {
            capability: 'analyse-visual',
            orgId: input.orgId,
            provider: { id: provider.id, type: provider.type },
            model: { id: model.id, displayName: model.displayName },
          },
          () => adapter.complete(prompt, {
            model: model.modelId,
            temperature: 0.1,
            timeout: provider.timeout,
            images: [input.image],
          }),
        );

        return {
          data: parseAnalyseVisualResponse(result.text, input.check),
          model: model.displayName,
          provider: provider.name,
          attempts: totalAttempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (isNonRetryable(lastError)) break;
      }
    }
  }

  throw new CapabilityExhaustedError('analyse-visual', totalAttempts, lastError);
}
