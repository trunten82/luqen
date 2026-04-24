/**
 * Phase 34 — Precise token budget.
 *
 * estimateTokens delegates to the tokenizer module (Phase 34-01); shouldCompact
 * surface is unchanged. The function remains sync (D-04) — the tokenizer
 * module's cold-cache path silently falls back and fires a background warm so
 * the NEXT call can be precise.
 *
 * Public surface preserved from Phase 33-03:
 *   - DEFAULT_MODEL_MAX_TOKENS, COMPACTION_THRESHOLD, MIN_KEEP_TURNS
 *   - estimateTokens(messages, model?)
 *   - shouldCompact(tokens, max?)
 */
import type { AgentChatMessage } from './agent-service.js';
import { countMessageTokens, type TokenizerMessage } from './tokenizer/index.js';

/** Default assumed token cap when the provider does not advertise its own. */
export const DEFAULT_MODEL_MAX_TOKENS = 8192;

/** Trigger compaction when the estimated prompt exceeds this fraction of the max. */
export const COMPACTION_THRESHOLD = 0.85;

/** Minimum number of user-initiated turns to keep verbatim at the tail. */
export const MIN_KEEP_TURNS = 6;

/**
 * Precise token count for the rolling message window.
 *   - model undefined or unknown → char/4 fallback (+ warn-once inside tokenizer module)
 *   - model known → provider-specific BPE/tiktoken count
 *   - system messages excluded (D-10); tool-call JSON envelopes included (D-09)
 *   - per-message envelope tax applied for non-system messages (D-11)
 *   - monotonic in character additions (tests depend on this)
 */
export function estimateTokens(
  messages: readonly AgentChatMessage[],
  model?: string,
): number {
  return countMessageTokens(messages as readonly TokenizerMessage[], model);
}

export function shouldCompact(
  tokens: number,
  max: number = DEFAULT_MODEL_MAX_TOKENS,
): boolean {
  return tokens > Math.floor(max * COMPACTION_THRESHOLD);
}
