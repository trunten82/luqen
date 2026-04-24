/**
 * Phase 34-01 Task 1 — Tokenizer registry skeleton.
 *
 * Resolves model-strings to { provider, encoding } entries (D-06), falls back
 * to a char/4 heuristic with warn-once dedup when unknown (D-07, D-08).
 *
 * Backend dispatch for known models lands in Task 3; for now all paths fall
 * through to char/4 so monotonicity + per-message-tax behaviour is locked in
 * first.
 */

import type {
  TokenizerLogger,
  TokenizerMessage,
  TokenizerRegistryEntry,
} from './types.js';

/** Fixed per-message overhead (role markers + separators), D-11. */
export const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Registry of model-string -> { provider, encoding? }.
 *
 * Frozen to mitigate T-34-01 (tampering). All lookups MUST go through
 * `resolve()` which uses `hasOwnProperty.call` to mitigate T-34-02
 * (prototype-pollution via `__proto__`/`constructor` keys).
 */
const MODEL_REGISTRY: Readonly<Record<string, TokenizerRegistryEntry>> = Object.freeze({
  'gpt-4o': { provider: 'openai', encoding: 'o200k_base' },
  'gpt-4o-mini': { provider: 'openai', encoding: 'o200k_base' },
  'gpt-4-turbo': { provider: 'openai', encoding: 'cl100k_base' },
  'gpt-4': { provider: 'openai', encoding: 'cl100k_base' },
  'gpt-3.5-turbo': { provider: 'openai', encoding: 'cl100k_base' },
  'claude-3-5-sonnet-20241022': { provider: 'anthropic' },
  'claude-3-5-sonnet-latest': { provider: 'anthropic' },
  'claude-3-5-haiku-20241022': { provider: 'anthropic' },
  'claude-3-opus-20240229': { provider: 'anthropic' },
  'claude-sonnet-4-5': { provider: 'anthropic' },
  'claude-opus-4-5': { provider: 'anthropic' },
  'llama3.1': { provider: 'ollama' },
  'llama3.2': { provider: 'ollama' },
  'llama3.3': { provider: 'ollama' },
  'qwen2.5': { provider: 'ollama' },
  'mistral': { provider: 'ollama' },
});

const warnedModels = new Set<string>();

function warnUnknownModelOnce(model: string, logger: TokenizerLogger): void {
  if (warnedModels.has(model)) return;
  warnedModels.add(model);
  logger.warn(`[token-budget] Unknown model "${model}" — falling back to char/4 heuristic.`);
}

/** Test-only — reset warn-once state between tests. Underscore-prefixed; do not call elsewhere. */
export function _resetWarnedForTest(): void {
  warnedModels.clear();
}

export function resolve(model: string): TokenizerRegistryEntry | undefined {
  // hasOwnProperty.call (never `model in MODEL_REGISTRY`) — mitigates T-34-02.
  if (Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, model)) {
    return MODEL_REGISTRY[model];
  }
  // Ollama tags: 'llama3.1:8b' -> 'llama3.1'.
  const colonIdx = model.indexOf(':');
  if (colonIdx > 0) {
    const base = model.slice(0, colonIdx);
    if (Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, base)) {
      return MODEL_REGISTRY[base];
    }
  }
  return undefined;
}

/**
 * Char/4 heuristic — includes message.content length plus tool-call JSON
 * envelope length (D-09). Monotonic: adding any character strictly cannot
 * decrease the count.
 */
function charOver4ForMessage(m: TokenizerMessage): number {
  let chars = m.content?.length ?? 0;
  if (m.toolCalls && m.toolCalls.length > 0) {
    chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Sync token count. D-04: never returns a Promise. D-10: system messages are
 * excluded from the count entirely (handled in Task 3 once backend dispatch
 * lands). For now, all paths fall through to char/4 so the behavioural
 * invariants (monotonicity, per-message tax) are locked in.
 *
 * SECURITY: `logger` receives only the model string, never message content
 * (T-34-05).
 */
export function countMessageTokens(
  messages: ReadonlyArray<TokenizerMessage>,
  model: string | undefined,
  logger?: TokenizerLogger,
): number {
  if (model !== undefined) {
    const entry = resolve(model);
    if (entry === undefined) {
      warnUnknownModelOnce(model, logger ?? console);
    }
    // Task 1: known-model path intentionally falls through to char/4 below.
    // Backend dispatch lands in Task 3.
  }

  let total = 0;
  for (const m of messages) {
    total += charOver4ForMessage(m);
  }
  total += PER_MESSAGE_OVERHEAD_TOKENS * messages.length;
  return total;
}
