/**
 * Phase 33-03 — Token budget + compaction (AGENT-05).
 *
 * A char/4 heuristic is accurate enough to drive the 85%-of-max threshold —
 * tokenizer accuracy matters at the boundary, not here. When the prompt
 * crosses the threshold, AgentService summarises the older turns into a
 * single [summary] assistant row and flips the summarised rows out of the
 * rolling window.
 */
import type { AgentChatMessage } from './agent-service.js';

/** Default assumed token cap when the provider does not advertise its own. */
export const DEFAULT_MODEL_MAX_TOKENS = 8192;

/** Trigger compaction when the estimated prompt exceeds this fraction of the max. */
export const COMPACTION_THRESHOLD = 0.85;

/** Minimum number of user-initiated turns to keep verbatim at the tail. */
export const MIN_KEEP_TURNS = 6;

/**
 * Rough token count. Approximates with a chars/4 heuristic plus a bit of
 * overhead for the JSON wrapping of tool_calls. Monotonic (adding any char
 * increases the count) — tests depend on this property.
 */
export function estimateTokens(messages: readonly AgentChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content?.length ?? 0);
    if (m.toolCalls && m.toolCalls.length > 0) {
      chars += JSON.stringify(m.toolCalls).length;
    }
  }
  return Math.ceil(chars / 4);
}

export function shouldCompact(
  tokens: number,
  max: number = DEFAULT_MODEL_MAX_TOKENS,
): boolean {
  return tokens > Math.floor(max * COMPACTION_THRESHOLD);
}
