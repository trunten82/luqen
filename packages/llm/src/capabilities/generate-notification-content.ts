import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import { buildNotificationPrompt } from '../prompts/generate-notification-content.js';

/**
 * Phase 50-01 — generate-notification-content capability.
 *
 * Unlike the other capabilities, this one NEVER throws on LLM failure: the
 * caller (dispatcher) must always be free to fall back to the deterministic
 * template. We return null on:
 *   - no model assigned for the capability
 *   - timeout (AbortController-driven, defaults to 5000ms)
 *   - provider error
 *   - non-JSON or schema-invalid LLM response
 */

export interface GenerateNotificationInput {
  readonly template: { readonly subject: string; readonly body: string };
  readonly voice?: string | null;
  readonly signature?: string | null;
  readonly brandContext?: { readonly name: string; readonly voice?: string | null } | null;
  readonly eventData: Record<string, unknown>;
  readonly channel: 'email' | 'slack' | 'teams';
  readonly outputFormat: 'subject' | 'body' | 'both';
  readonly orgId?: string;
}

export interface GenerateNotificationResult {
  readonly subject: string;
  readonly body: string;
  readonly model: string;
  readonly provider: string;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export interface GenerateNotificationOptions {
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function parseNotificationResponse(text: string): { subject: string; body: string } | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : cleaned;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const subject = parsed['subject'];
    const body = parsed['body'];
    if (typeof subject !== 'string' || typeof body !== 'string') return null;
    if (subject.trim().length === 0 && body.trim().length === 0) return null;
    return { subject, body };
  } catch {
    return null;
  }
}

export async function executeGenerateNotificationContent(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: GenerateNotificationInput,
  options?: GenerateNotificationOptions,
): Promise<GenerateNotificationResult | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const models = await db.getModelsForCapability('generate-notification-content', input.orgId);
  if (models.length === 0) return null;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const adapter = adapterFactory(provider.type);
      await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });

      const prompt = buildNotificationPrompt({
        templateSubject: input.template.subject,
        templateBody: input.template.body,
        voice: input.voice ?? null,
        signature: input.signature ?? null,
        brandName: input.brandContext?.name ?? null,
        brandVoice: input.brandContext?.voice ?? null,
        eventData: input.eventData,
        channel: input.channel,
        outputFormat: input.outputFormat,
      });

      const completion = await Promise.race([
        adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0.4,
          timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
        }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('LLM_TIMEOUT')));
        }),
      ]);

      const parsed = parseNotificationResponse(completion.text);
      if (parsed === null) return null;

      const latencyMs = Date.now() - startedAt;
      return {
        subject: parsed.subject,
        body: parsed.body,
        model: model.displayName,
        provider: provider.name,
        latencyMs,
        tokensIn: completion.usage.inputTokens,
        tokensOut: completion.usage.outputTokens,
      };
    } catch {
      // try next model
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}
