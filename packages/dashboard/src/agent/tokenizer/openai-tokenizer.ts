/**
 * Phase 34-01 Task 2 — OpenAI tokenizer backend (D-01).
 *
 * Pure JS via `js-tiktoken/lite` + per-encoding ranks. Singleton cached per
 * encoding for the process lifetime; TOK-02 (no native, <5 MB bundled).
 *
 * SECURITY: `getOpenAiEncoder` validates the encoding name against the
 * constrained `SupportedEncoding` union — the registry only passes values it
 * wrote, but the throw-on-unknown path is defence-in-depth (T-34-02).
 */

import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import o200k from 'js-tiktoken/ranks/o200k_base';

export type SupportedEncoding = 'cl100k_base' | 'o200k_base';

/**
 * BPE rank tables keyed by encoding. `Tiktoken`'s runtime schema is
 * `TiktokenBPE` but js-tiktoken publishes the ranks as opaque defaults — the
 * `as never` cast bridges the declared-type and shipped-shape gap.
 */
const RANKS: Readonly<Record<SupportedEncoding, unknown>> = Object.freeze({
  cl100k_base: cl100k,
  o200k_base: o200k,
});

export interface OpenAiEncoder {
  countText(s: string): number;
}

const cache = new Map<SupportedEncoding, OpenAiEncoder>();

export function getOpenAiEncoder(encoding: SupportedEncoding): OpenAiEncoder {
  const cached = cache.get(encoding);
  if (cached) return cached;

  if (!Object.prototype.hasOwnProperty.call(RANKS, encoding)) {
    throw new Error(`Unknown OpenAI encoding: ${encoding}`);
  }
  const ranks = RANKS[encoding];

  // js-tiktoken/lite Tiktoken expects a TiktokenBPE; ranks imports ship the
  // same shape but typed as `unknown` in the .d.ts — cast is safe because
  // the ranks come from the same package.
  const enc = new Tiktoken(ranks as never);
  const wrapper: OpenAiEncoder = {
    countText(s: string): number {
      if (s.length === 0) return 0;
      return enc.encode(s).length;
    },
  };
  cache.set(encoding, wrapper);
  return wrapper;
}

/** Test-only — clear cached encoders between tests. */
export function _resetOpenAiCacheForTest(): void {
  cache.clear();
}
