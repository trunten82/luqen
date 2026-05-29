/**
 * Phase 74 — Hard-coded provider pricing registry.
 *
 * USD per 1k tokens for each known (providerType, modelId) pair.
 * Self-hosted providers (Ollama) are zero-cost. Unknown models map
 * to `undefined` so the caller can decide whether to record a NULL
 * cost or assume zero.
 *
 * Update cadence: bump this file when a provider publishes a price
 * change. Historical rows in `llm_usage` keep the cost they were
 * written with — pricing is volatile, history is not.
 *
 * The matcher is prefix-tolerant: an entry keyed `gpt-4o-mini` will
 * also match `gpt-4o-mini-2024-07-18` (OpenAI dated variants). The
 * longer key wins on tie. See `lookupPrice` for the rule.
 */

import type { ProviderType } from '../types.js';

export interface ModelPrice {
  /** USD per 1,000 input tokens. */
  readonly inputUsdPer1k: number;
  /** USD per 1,000 output tokens. */
  readonly outputUsdPer1k: number;
}

/**
 * Frozen registry. Keys are `<providerType>:<modelId-prefix>`.
 * Costs are USD per 1k tokens (the units providers publish).
 *
 * Source dates marked inline where the price came from a published
 * pricing page; treat any entry without a date as "best-effort from
 * historical context" and verify before relying on for finance.
 */
const REGISTRY: Readonly<Record<string, ModelPrice>> = Object.freeze({
  // OpenAI — published openai.com/api/pricing
  'openai:gpt-4o':              { inputUsdPer1k: 0.0025, outputUsdPer1k: 0.010 },
  'openai:gpt-4o-mini':         { inputUsdPer1k: 0.00015, outputUsdPer1k: 0.0006 },
  'openai:gpt-4-turbo':         { inputUsdPer1k: 0.010, outputUsdPer1k: 0.030 },
  'openai:gpt-4':               { inputUsdPer1k: 0.030, outputUsdPer1k: 0.060 },
  'openai:gpt-3.5-turbo':       { inputUsdPer1k: 0.0005, outputUsdPer1k: 0.0015 },
  'openai:o1-mini':             { inputUsdPer1k: 0.003, outputUsdPer1k: 0.012 },
  'openai:o1':                  { inputUsdPer1k: 0.015, outputUsdPer1k: 0.060 },

  // Anthropic — published anthropic.com/pricing
  'anthropic:claude-3.5-sonnet':   { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015 },
  'anthropic:claude-3.5-haiku':    { inputUsdPer1k: 0.001, outputUsdPer1k: 0.005 },
  'anthropic:claude-3-opus':       { inputUsdPer1k: 0.015, outputUsdPer1k: 0.075 },
  'anthropic:claude-3-sonnet':     { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015 },
  'anthropic:claude-3-haiku':      { inputUsdPer1k: 0.00025, outputUsdPer1k: 0.00125 },
  'anthropic:claude-haiku-4-5':    { inputUsdPer1k: 0.001, outputUsdPer1k: 0.005 },
  'anthropic:claude-sonnet-4':     { inputUsdPer1k: 0.003, outputUsdPer1k: 0.015 },
  'anthropic:claude-opus-4':       { inputUsdPer1k: 0.015, outputUsdPer1k: 0.075 },

  // Gemini — published ai.google.dev/pricing
  'gemini:gemini-1.5-pro':         { inputUsdPer1k: 0.00125, outputUsdPer1k: 0.005 },
  'gemini:gemini-1.5-flash':       { inputUsdPer1k: 0.000075, outputUsdPer1k: 0.0003 },
  'gemini:gemini-1.5-flash-8b':    { inputUsdPer1k: 0.0000375, outputUsdPer1k: 0.00015 },
  'gemini:gemini-2.0-flash':       { inputUsdPer1k: 0.000075, outputUsdPer1k: 0.0003 },
  'gemini:gemini-2.5-pro':         { inputUsdPer1k: 0.00125, outputUsdPer1k: 0.005 },
  'gemini:gemini-2.5-flash':       { inputUsdPer1k: 0.000075, outputUsdPer1k: 0.0003 },

  // Ollama — locally hosted; zero marginal token cost.
  'ollama:': { inputUsdPer1k: 0, outputUsdPer1k: 0 },
});

/**
 * Resolve the price for a given provider/model. Returns `undefined`
 * when no entry matches (caller writes NULL costs). Prefers the
 * longest-matching prefix so e.g. `gpt-4o-mini-2024-07-18` matches
 * `gpt-4o-mini` rather than `gpt-4`.
 */
export function lookupPrice(
  providerType: ProviderType,
  modelId: string,
): ModelPrice | undefined {
  let best: { key: string; price: ModelPrice } | undefined;
  const prefix = `${providerType}:`;
  for (const [key, price] of Object.entries(REGISTRY)) {
    if (!key.startsWith(prefix)) continue;
    const tail = key.slice(prefix.length);
    if (tail === '' || modelId === tail || modelId.startsWith(`${tail}-`) || modelId.startsWith(tail)) {
      if (best === undefined || key.length > best.key.length) {
        best = { key, price };
      }
    }
  }
  return best?.price;
}

/**
 * Compute USD costs from token counts using the lookupPrice table.
 * Returns NaN-free numbers; missing prices coerce to NULL via the
 * caller's optional-handling.
 */
export function computeCost(
  providerType: ProviderType,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): { input: number | null; output: number | null; total: number | null } {
  const price = lookupPrice(providerType, modelId);
  if (price === undefined) {
    return { input: null, output: null, total: null };
  }
  const input = (promptTokens / 1000) * price.inputUsdPer1k;
  const output = (completionTokens / 1000) * price.outputUsdPer1k;
  return { input, output, total: input + output };
}
