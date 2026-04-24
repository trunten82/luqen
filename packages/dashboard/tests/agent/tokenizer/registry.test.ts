/**
 * Phase 34-01 Task 1 — Registry tests (A–E).
 *
 * Exercises model resolution, warn-once dedup, per-message tax, monotonicity,
 * and the no-model-no-warn path. Backend dispatch tests land in Task 3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  countMessageTokens,
  resolve,
  PER_MESSAGE_OVERHEAD_TOKENS,
  _resetWarnedForTest,
} from '../../../src/agent/tokenizer/registry.js';
import type { TokenizerMessage } from '../../../src/agent/tokenizer/types.js';

function fakeLogger() {
  return { warn: vi.fn() };
}

describe('tokenizer registry', () => {
  beforeEach(() => {
    _resetWarnedForTest();
  });

  it('Test A: resolves known OpenAI/Anthropic/Ollama models; unknown → undefined', () => {
    expect(resolve('gpt-4o')).toEqual({ provider: 'openai', encoding: 'o200k_base' });
    expect(resolve('gpt-4-turbo')).toEqual({ provider: 'openai', encoding: 'cl100k_base' });
    expect(resolve('claude-3-5-sonnet-20241022')).toEqual({ provider: 'anthropic' });
    expect(resolve('llama3.1')).toEqual({ provider: 'ollama' });
    expect(resolve('some-unknown-model')).toBeUndefined();
    // Ollama :tag stripping
    expect(resolve('llama3.1:8b')).toEqual({ provider: 'ollama' });
  });

  it('Test A guard: prototype keys do not resolve', () => {
    expect(resolve('__proto__')).toBeUndefined();
    expect(resolve('constructor')).toBeUndefined();
    expect(resolve('toString')).toBeUndefined();
  });

  it('Test B: unknown model → positive char/4 count + warn exactly ONCE per model', () => {
    const logger = fakeLogger();
    const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];

    const n1 = countMessageTokens(msgs, 'unknown-model', logger);
    const n2 = countMessageTokens(msgs, 'unknown-model', logger);
    const n3 = countMessageTokens(msgs, 'unknown-model', logger);
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(n1);
    expect(n3).toBe(n1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown-model'));

    // A different unknown model triggers a second warn.
    countMessageTokens(msgs, 'other-unknown', logger);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('other-unknown'));
  });

  it('Test C: no-model → char/4 fallback, NO warning emitted', () => {
    const logger = fakeLogger();
    const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
    const n = countMessageTokens(msgs, undefined, logger);
    expect(n).toBeGreaterThan(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('Test D: per-message envelope tax adds PER_MESSAGE_OVERHEAD_TOKENS * N', () => {
    const msgs: TokenizerMessage[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '' },
    ];
    const n = countMessageTokens(msgs, undefined);
    expect(PER_MESSAGE_OVERHEAD_TOKENS).toBe(4);
    expect(n).toBeGreaterThanOrEqual(3 * 3);
    expect(n).toBe(PER_MESSAGE_OVERHEAD_TOKENS * 3);
  });

  it('Test E: monotonicity — adding a character never decreases count', () => {
    const shorter: TokenizerMessage[] = [{ role: 'user', content: 'hello' }];
    const longer: TokenizerMessage[] = [{ role: 'user', content: 'hello!' }];
    expect(countMessageTokens(shorter, undefined)).toBeLessThanOrEqual(
      countMessageTokens(longer, undefined),
    );
    // And strictly less once we cross a char/4 boundary.
    const much: TokenizerMessage[] = [{ role: 'user', content: 'hello world!!!' }];
    expect(countMessageTokens(shorter, undefined)).toBeLessThan(
      countMessageTokens(much, undefined),
    );
  });
});
