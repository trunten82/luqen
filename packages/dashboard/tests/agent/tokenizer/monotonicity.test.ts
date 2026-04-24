/**
 * Phase 34-03 Task 2 — Monotonicity property test across every backend.
 *
 * "Adding characters never decreases the count." Checked at lengths
 * 0, 1, 10, 100, 1000, 10000 for:
 *   - char/4 fallback (model=undefined)
 *   - gpt-4o (js-tiktoken o200k)
 *   - claude-3-5-sonnet (anthropic wasm)
 *   - llama3.1 cold (char/4 fallback via ollama backend)
 *   - llama3.1 warm (metadata ratio via stubbed /api/show)
 *
 * No real network: the warm case stubs `fetch` globally.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { estimateTokens } from '../../../src/agent/token-budget.js';
import { prewarmTokenizer } from '../../../src/agent/tokenizer/index.js';
import {
  configureOllamaTokenizer,
  _resetOllamaCacheForTest,
} from '../../../src/agent/tokenizer/ollama-tokenizer.js';
import type { AgentChatMessage } from '../../../src/agent/agent-service.js';

function ladder(model: string | undefined): readonly number[] {
  return [0, 1, 10, 100, 1000, 10000].map((n) =>
    estimateTokens(
      [{ role: 'user', content: 'a'.repeat(n) } as AgentChatMessage],
      model,
    ),
  );
}

function isNonDecreasing(xs: readonly number[]): boolean {
  for (let i = 1; i < xs.length; i++) if (xs[i]! < xs[i - 1]!) return false;
  return true;
}

// BPE encoders (js-tiktoken, @anthropic-ai/tokenizer) are O(n log n) with a
// large constant when the input is 10 000 identical characters (many merge
// candidates). 30 s gives headroom on slow CI without masking real regressions.
const LONG_TEST_TIMEOUT_MS = 30_000;

describe('tokenizer monotonicity across backends', () => {
  beforeEach(() => {
    _resetOllamaCacheForTest();
    vi.restoreAllMocks();
  });

  it('char/4 fallback monotonic', () => {
    expect(isNonDecreasing(ladder(undefined))).toBe(true);
  });

  it('gpt-4o monotonic', () => {
    expect(isNonDecreasing(ladder('gpt-4o'))).toBe(true);
  }, LONG_TEST_TIMEOUT_MS);

  it('claude-3-5-sonnet monotonic', () => {
    expect(isNonDecreasing(ladder('claude-3-5-sonnet-20241022'))).toBe(true);
  }, LONG_TEST_TIMEOUT_MS);

  it('llama3.1 cold monotonic', () => {
    expect(isNonDecreasing(ladder('llama3.1'))).toBe(true);
  });

  it('llama3.1 warm monotonic', async () => {
    configureOllamaTokenizer({ baseUrl: 'http://ollama.test' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          details: { tokenizer: 'llama' },
          model_info: { 'llama.vocab_size': 128256 },
        }),
      }),
    );
    await prewarmTokenizer('llama3.1');
    expect(isNonDecreasing(ladder('llama3.1'))).toBe(true);
  });
});
