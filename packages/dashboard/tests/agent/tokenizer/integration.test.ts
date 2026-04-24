/**
 * Phase 34-03 Task 1 — End-to-end integration tests for estimateTokens.
 *
 * No vi.mock of the tokenizer module; uses the real encoders for OpenAI
 * (js-tiktoken) and Anthropic (@anthropic-ai/tokenizer). Ollama cases stub
 * `fetch` globally (no real network egress).
 *
 * Covers TOK-01, TOK-03, TOK-05 plus the warn-once contract (D-08), the
 * tool-call inclusion rule (D-09), and the system-exclusion rule (D-10).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import o200k from 'js-tiktoken/ranks/o200k_base';

import { estimateTokens } from '../../../src/agent/token-budget.js';
import { prewarmTokenizer } from '../../../src/agent/tokenizer/index.js';
import { _resetWarnedForTest } from '../../../src/agent/tokenizer/registry.js';
import { _resetOpenAiCacheForTest } from '../../../src/agent/tokenizer/openai-tokenizer.js';
import { _resetAnthropicCacheForTest } from '../../../src/agent/tokenizer/anthropic-tokenizer.js';
import {
  _resetOllamaCacheForTest,
  configureOllamaTokenizer,
} from '../../../src/agent/tokenizer/ollama-tokenizer.js';
import { PER_MESSAGE_OVERHEAD_TOKENS } from '../../../src/agent/tokenizer/registry.js';
import type { AgentChatMessage } from '../../../src/agent/agent-service.js';

describe('tokenizer integration (estimateTokens end-to-end)', () => {
  beforeEach(() => {
    _resetWarnedForTest();
    _resetOpenAiCacheForTest();
    _resetAnthropicCacheForTest();
    _resetOllamaCacheForTest();
    vi.restoreAllMocks();
  });

  it('Test A: OpenAI gpt-4o parity with js-tiktoken o200k_base', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const msgs: AgentChatMessage[] = [{ role: 'user', content: text }];
    const enc = new Tiktoken(o200k as never);
    const expected = enc.encode(text).length + PER_MESSAGE_OVERHEAD_TOKENS;
    expect(estimateTokens(msgs, 'gpt-4o')).toBe(expected);
  });

  it('Test B: OpenAI gpt-4-turbo parity with js-tiktoken cl100k_base', () => {
    const text =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.';
    const msgs: AgentChatMessage[] = [{ role: 'user', content: text }];
    const enc = new Tiktoken(cl100k as never);
    const expected = enc.encode(text).length + PER_MESSAGE_OVERHEAD_TOKENS;
    expect(estimateTokens(msgs, 'gpt-4-turbo')).toBe(expected);
  });

  it('Test C: Anthropic claude-3-5-sonnet returns positive count within sanity band', () => {
    const text = 'Hello, world. This is a test.';
    const msgs: AgentChatMessage[] = [{ role: 'user', content: text }];
    const n = estimateTokens(msgs, 'claude-3-5-sonnet-20241022');
    // Subtract the per-message overhead to compare to raw content bounds.
    const contentTokens = n - PER_MESSAGE_OVERHEAD_TOKENS;
    expect(Number.isInteger(contentTokens)).toBe(true);
    expect(contentTokens).toBeGreaterThan(Math.ceil(text.length / 5));
    expect(contentTokens).toBeLessThan(text.length);
  });

  it('Test D: Ollama cold cache falls back to char/4 with no warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = 'hello world'; // 11 chars → Math.ceil(11/4) = 3
    const msgs: AgentChatMessage[] = [{ role: 'user', content: text }];
    const n = estimateTokens(msgs, 'llama3.1');
    expect(n).toBe(Math.ceil(text.length / 4) + PER_MESSAGE_OVERHEAD_TOKENS);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('Test E: Ollama warm cache uses metadata-driven ratio', async () => {
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
    const text = 'hello world'; // 11 chars → Math.ceil(11/3.2) = 4
    const msgs: AgentChatMessage[] = [{ role: 'user', content: text }];
    expect(estimateTokens(msgs, 'llama3.1')).toBe(
      Math.ceil(text.length / 3.2) + PER_MESSAGE_OVERHEAD_TOKENS,
    );
  });

  it('Test F: unknown model warns exactly once per process per model', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msgs: AgentChatMessage[] = [{ role: 'user', content: 'ping' }];
    estimateTokens(msgs, 'definitely-not-a-model');
    estimateTokens(msgs, 'definitely-not-a-model');
    estimateTokens(msgs, 'definitely-not-a-model');
    expect(warnSpy.mock.calls.length).toBe(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('definitely-not-a-model');
  });

  it('Test G: tool-call JSON envelope is included in the count (D-09)', () => {
    const base: AgentChatMessage[] = [{ role: 'assistant', content: '' }];
    const withToolCall: AgentChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ name: 'big', args: { payload: 'A'.repeat(400) } }],
      },
    ];
    const baseCount = estimateTokens(base, 'gpt-4o');
    const toolCount = estimateTokens(withToolCall, 'gpt-4o');
    // 400 'A' chars collapse heavily but still add well over a handful of tokens
    // via JSON.stringify envelope. Proportional margin guard:
    expect(toolCount).toBeGreaterThan(baseCount + 10);
  });

  it('Test H: system messages are excluded from the count (D-10)', () => {
    const withSystem: AgentChatMessage[] = [
      { role: 'system', content: 'X'.repeat(1000) },
      { role: 'user', content: 'hi' },
    ];
    const justUser: AgentChatMessage[] = [{ role: 'user', content: 'hi' }];
    const withSys = estimateTokens(withSystem, 'gpt-4o');
    const userOnly = estimateTokens(justUser, 'gpt-4o');
    expect(withSys).toBeLessThanOrEqual(userOnly + 3);
  });
});
