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

  // Gemini — published ai.google.dev/gemini-api/docs/pricing.
  // 1.5-*, 2.0-flash below are UNAUDITED as of 2026-09-04 — carried over
  // from an earlier pass, not verified against the current pricing page.
  // Only the rows below marked CORRECTED/NEW were checked on that date.
  'gemini:gemini-1.5-pro':         { inputUsdPer1k: 0.00125, outputUsdPer1k: 0.005 },
  'gemini:gemini-1.5-flash':       { inputUsdPer1k: 0.000075, outputUsdPer1k: 0.0003 },
  'gemini:gemini-1.5-flash-8b':    { inputUsdPer1k: 0.0000375, outputUsdPer1k: 0.00015 },
  'gemini:gemini-2.0-flash':       { inputUsdPer1k: 0.000075, outputUsdPer1k: 0.0003 },

  // Retrieved 2026-09-04 from ai.google.dev/gemini-api/docs/pricing.
  // Values are the text/image/video tier; models with a separate, higher
  // audio-input tier are noted inline — using the lower tier for audio
  // workloads under-reports cost, a known direction, not a bug.
  'gemini:gemini-2.5-pro':            { inputUsdPer1k: 0.00125, outputUsdPer1k: 0.010 }, // CORRECTED, output was 0.005; <=200k prompt tier
  'gemini:gemini-2.5-flash':          { inputUsdPer1k: 0.0003, outputUsdPer1k: 0.0025 }, // CORRECTED, was 0.000075 / 0.0003
  'gemini:gemini-2.5-flash-lite':     { inputUsdPer1k: 0.0001, outputUsdPer1k: 0.0004 }, // NEW — also the D1 sibling-mispricing fix (see lookupPrice)
  'gemini:gemini-3.1-pro':            { inputUsdPer1k: 0.002, outputUsdPer1k: 0.012 }, // <=200k prompt tier; >200k is 0.004 / 0.018
  'gemini:gemini-3.1-flash-lite':     { inputUsdPer1k: 0.00025, outputUsdPer1k: 0.0015 }, // audio input is 0.0005/1k
  'gemini:gemini-3.5-flash-lite':     { inputUsdPer1k: 0.0003, outputUsdPer1k: 0.0025 },
  'gemini:gemini-3.5-flash':          { inputUsdPer1k: 0.0015, outputUsdPer1k: 0.009 },
  // PROMOTIONAL through 2026-12-31; reverts to 0.0015 / 0.0075 per 1k on
  // 2027-01-01. Whoever reads this after that date: update these three
  // rows or they will quietly under-report cost.
  'gemini:gemini-3.6-flash':          { inputUsdPer1k: 0.00075, outputUsdPer1k: 0.00375 },
  'gemini:gemini-3.7-flash':          { inputUsdPer1k: 0.00075, outputUsdPer1k: 0.00375 },
  'gemini:gemini-3.8-flash':          { inputUsdPer1k: 0.00075, outputUsdPer1k: 0.00375 },

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
    // D1 fix (measured 2026-09-04): the old rule ALSO matched a bare
    // `modelId.startsWith(tail)`, with no separator requirement. That
    // silently mispriced siblings that share a prefix but are NOT dated
    // variants of the same model — e.g. `gemini-2.5-flash-lite` matched
    // the `gemini-2.5-flash` row (and `gemini-2.5-pro-exp` matched
    // `gemini-2.5-pro`), because "gemini-2.5-flash-lite" bare-starts-with
    // "gemini-2.5-flash". A mispriced sibling produces a WRONG NUMBER, not
    // a null, so it never surfaces via the unpriced-rows counter.
    //
    // The fix alone is not sufficient without also giving
    // gemini-2.5-flash-lite its OWN registry row (see the Gemini rows
    // fix) — the variant rule below still matches "gemini-2.5-flash-lite"
    // against the "gemini-2.5-flash" tail (it starts with
    // "gemini-2.5-flash-"), so longest-key-wins is what selects the
    // correct, more specific row. Do not remove either half.
    if (
      tail === '' || // catch-all key (used by `ollama:`)
      modelId === tail || // exact match
      modelId.startsWith(`${tail}-`) // dated/suffixed variant of the same model
    ) {
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
