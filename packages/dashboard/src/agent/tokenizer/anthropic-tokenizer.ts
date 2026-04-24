/**
 * Phase 34-01 Task 2 — Anthropic tokenizer backend (D-02).
 *
 * Uses `@anthropic-ai/tokenizer` (wasm via tiktoken/lite). Acknowledged
 * imperfect for Claude 3/4 but the closest offline option without per-call
 * API round-trips. Singleton cached for the process lifetime.
 *
 * SECURITY: Pure wasm, no native binaries. No network calls. Input is a
 * string — no length-based DoS beyond upstream message caps (T-34-06).
 */

// @anthropic-ai/tokenizer ships CJS-only; the default `countTokens` function
// constructs + frees a tokenizer per call. For the hot path we instead use
// `getTokenizer()` to hold a long-lived encoder and reuse it — avoids wasm
// instance churn on every message.
import { getTokenizer } from '@anthropic-ai/tokenizer';

export interface AnthropicEncoder {
  countText(s: string): number;
}

let singleton: AnthropicEncoder | null = null;

export function getAnthropicEncoder(): AnthropicEncoder {
  if (singleton) return singleton;

  // getTokenizer() returns a `Tiktoken` from the native `tiktoken/lite` (wasm)
  // — it exposes `encode(text, allowedSpecial)`. We pre-normalise to NFKC to
  // match the package's `countTokens` behaviour exactly.
  const tok = getTokenizer();
  singleton = {
    countText(s: string): number {
      if (s.length === 0) return 0;
      const encoded = tok.encode(s.normalize('NFKC'), 'all');
      return encoded.length;
    },
  };
  return singleton;
}

/** Test-only — clear the singleton between tests. */
export function _resetAnthropicCacheForTest(): void {
  singleton = null;
}
