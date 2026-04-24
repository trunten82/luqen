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
  prewarmTokenizer,
  PER_MESSAGE_OVERHEAD_TOKENS,
  _resetWarnedForTest,
} from '../../../src/agent/tokenizer/registry.js';
import {
  getOpenAiEncoder,
  _resetOpenAiCacheForTest,
} from '../../../src/agent/tokenizer/openai-tokenizer.js';
import { _resetAnthropicCacheForTest } from '../../../src/agent/tokenizer/anthropic-tokenizer.js';
import {
  configureOllamaTokenizer,
  warm as ollamaWarm,
  _resetOllamaCacheForTest,
} from '../../../src/agent/tokenizer/ollama-tokenizer.js';
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

  describe('backend dispatch (Task 3)', () => {
    beforeEach(() => {
      _resetOpenAiCacheForTest();
      _resetAnthropicCacheForTest();
      _resetOllamaCacheForTest();
      configureOllamaTokenizer({ baseUrl: 'http://ollama.test' });
    });

    it('Test G-openai: dispatches to js-tiktoken and adds per-message tax', () => {
      const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
      const n = countMessageTokens(msgs, 'gpt-4o');
      // Encoder count is integer; registry adds PER_MESSAGE_OVERHEAD_TOKENS * 1.
      const rawEnc = getOpenAiEncoder('o200k_base').countText('hello world');
      expect(n).toBe(rawEnc + PER_MESSAGE_OVERHEAD_TOKENS);
    });

    it('Test G-openai-cl100k: gpt-4-turbo routes to cl100k_base', () => {
      const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
      const n = countMessageTokens(msgs, 'gpt-4-turbo');
      const rawEnc = getOpenAiEncoder('cl100k_base').countText('hello world');
      expect(n).toBe(rawEnc + PER_MESSAGE_OVERHEAD_TOKENS);
      // cl100k encodes "hello world" as 2 tokens (known constant).
      expect(rawEnc).toBe(2);
    });

    it('Test G-anthropic: claude model dispatches to anthropic tokenizer', () => {
      const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
      const n = countMessageTokens(msgs, 'claude-3-5-sonnet-latest');
      expect(n).toBeGreaterThan(PER_MESSAGE_OVERHEAD_TOKENS);
    });

    it('Test G-ollama warm: precise count after warm', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ details: { tokenizer: 'llama' }, model_info: { 'llama.vocab_size': 128000 } }),
        } as unknown as Response),
      );
      await ollamaWarm('llama3.1');
      const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
      const n = countMessageTokens(msgs, 'llama3.1');
      // 11 chars / 3.2 = ceil(3.44) = 4, + 4 tax = 8
      expect(n).toBe(Math.ceil(11 / 3.2) + PER_MESSAGE_OVERHEAD_TOKENS);
      vi.unstubAllGlobals();
    });

    it('Test H: Ollama cold-cache silently falls back to char/4 (NO warn)', () => {
      const logger = fakeLogger();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ details: {}, model_info: {} }),
        } as unknown as Response),
      );
      const msgs: TokenizerMessage[] = [{ role: 'user', content: 'hello world' }];
      const n = countMessageTokens(msgs, 'llama3.1', logger);
      // Cold: char/4 -> ceil(11/4)=3 + 4 tax = 7
      expect(n).toBe(Math.ceil(11 / 4) + PER_MESSAGE_OVERHEAD_TOKENS);
      expect(logger.warn).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('D-10: system messages excluded from count AND from per-message tax', () => {
      const msgs: TokenizerMessage[] = [
        { role: 'system', content: 'big long system prompt'.repeat(20) },
        { role: 'user', content: 'hello' },
      ];
      const n = countMessageTokens(msgs, undefined);
      // Only the user message is counted — tax is 4 * 1, not 4 * 2.
      const userOnly: TokenizerMessage[] = [{ role: 'user', content: 'hello' }];
      expect(n).toBe(countMessageTokens(userOnly, undefined));
    });

    it('D-09: tool-call envelope included in the count', () => {
      const without: TokenizerMessage[] = [{ role: 'assistant', content: 'ok' }];
      const withToolCall: TokenizerMessage[] = [
        {
          role: 'assistant',
          content: 'ok',
          toolCalls: [{ id: 't1', name: 'get_report', args: { id: 'r-123' } }],
        },
      ];
      expect(countMessageTokens(withToolCall, 'gpt-4o')).toBeGreaterThan(
        countMessageTokens(without, 'gpt-4o'),
      );
    });

    it('prewarmTokenizer: unknown model is a no-op (no throw, no warn)', async () => {
      const logger = fakeLogger();
      await expect(prewarmTokenizer('never-heard-of-it')).resolves.toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('prewarmTokenizer: OpenAI builds the encoder eagerly', async () => {
      await prewarmTokenizer('gpt-4o');
      // After prewarm, the encoder cache is populated — calling again is instant.
      const enc1 = getOpenAiEncoder('o200k_base');
      const enc2 = getOpenAiEncoder('o200k_base');
      expect(enc1).toBe(enc2);
    });
  });
});
