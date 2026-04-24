/**
 * Phase 34-01 Task 3 — Tokenizer registry with provider dispatch.
 *
 * Resolves model-strings to { provider, encoding } entries (D-06) and
 * dispatches to per-provider backends:
 *   - OpenAI → js-tiktoken (precise)
 *   - Anthropic → @anthropic-ai/tokenizer (precise)
 *   - Ollama → /api/show-cached metadata (precise when warm, char/4 when cold)
 *
 * Unknown models fall back to char/4 with warn-once dedup (D-07, D-08).
 * System messages are excluded entirely from the count (D-10). Tool-call
 * envelopes are included via the same precise encoder (D-09).
 */

import type {
  TokenizerLogger,
  TokenizerMessage,
  TokenizerRegistryEntry,
} from './types.js';
import { getOpenAiEncoder, type SupportedEncoding } from './openai-tokenizer.js';
import { getAnthropicEncoder } from './anthropic-tokenizer.js';
import * as ollama from './ollama-tokenizer.js';

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
  logger.warn(
    `[token-budget] Unknown model "${model}" — falling back to char/4 heuristic.`,
  );
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

/** Char/4 fallback for a single text chunk — Math.ceil(len/4). */
function charOver4(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/** Compose the text payload for a message: content + tool-call JSON envelope (D-09). */
function messagePayloadText(m: TokenizerMessage): string {
  const parts: string[] = [];
  if (m.content) parts.push(m.content);
  if (m.toolCalls && m.toolCalls.length > 0) {
    parts.push(JSON.stringify(m.toolCalls));
  }
  return parts.join('');
}

/**
 * Count tokens for a message via the provider-appropriate encoder. Ollama
 * cold-cache silently falls back to char/4 and fires a background warm so
 * the NEXT call can be precise. No warn here — the model IS known.
 */
function countMessagePrecise(
  m: TokenizerMessage,
  model: string,
  entry: TokenizerRegistryEntry,
): number {
  const text = messagePayloadText(m);
  if (text.length === 0) return 0;

  switch (entry.provider) {
    case 'openai': {
      const enc = getOpenAiEncoder(entry.encoding as SupportedEncoding);
      return enc.countText(text);
    }
    case 'anthropic': {
      return getAnthropicEncoder().countText(text);
    }
    case 'ollama': {
      const n = ollama.countText(model, text);
      if (n !== undefined) return n;
      // Cold cache — trigger background warm for next call, fall back now.
      void ollama.warm(model);
      return charOver4(text);
    }
  }
}

/**
 * Sync token count. D-04: never returns a Promise.
 * - model undefined → char/4, no warn (C-test).
 * - unknown model → char/4 + warn-once.
 * - known model → dispatch to backend; Ollama cold-cache silently falls back.
 * - system messages excluded entirely (D-10).
 *
 * SECURITY: logger receives only the model string, never message content
 * (T-34-05).
 */
export function countMessageTokens(
  messages: ReadonlyArray<TokenizerMessage>,
  model: string | undefined,
  logger?: TokenizerLogger,
): number {
  const entry = model === undefined ? undefined : resolve(model);

  if (model !== undefined && entry === undefined) {
    warnUnknownModelOnce(model, logger ?? console);
  }

  let total = 0;
  let countedMessages = 0;
  for (const m of messages) {
    if (m.role === 'system') continue; // D-10
    countedMessages += 1;
    if (entry !== undefined && model !== undefined) {
      total += countMessagePrecise(m, model, entry);
    } else {
      total += charOver4(messagePayloadText(m));
    }
  }
  total += PER_MESSAGE_OVERHEAD_TOKENS * countedMessages;
  return total;
}

/**
 * Pre-warm the encoder for `model` so the first real call is hot (D-05).
 * - OpenAI/Anthropic: force encoder construction.
 * - Ollama: await the /api/show fetch (fire-and-forget is fine for callers
 *   that don't care about completion).
 * - Unknown model: no-op; warn happens on first count.
 */
export async function prewarmTokenizer(model: string): Promise<void> {
  const entry = resolve(model);
  if (!entry) return;
  switch (entry.provider) {
    case 'openai':
      getOpenAiEncoder(entry.encoding as SupportedEncoding).countText('');
      return;
    case 'anthropic':
      getAnthropicEncoder().countText('');
      return;
    case 'ollama':
      await ollama.warm(model);
      return;
  }
}
