/**
 * Phase 34-02 Task 1 — token-budget.ts delegation layer tests.
 *
 * Verifies estimateTokens:
 *   - Backward compat: sync char/4 fallback when no model supplied.
 *   - Model-aware: delegates to the precise tokenizer when a known model is passed.
 *   - Excludes system messages entirely (D-10).
 *   - Includes tool-call JSON envelopes in the count (D-09).
 *   - Monotonic under unknown model.
 * And shouldCompact: preserves the pre-phase boundary behaviour exactly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { estimateTokens, shouldCompact } from '../../src/agent/token-budget.js';
import { _resetWarnedForTest, PER_MESSAGE_OVERHEAD_TOKENS } from '../../src/agent/tokenizer/index.js';
import type { AgentChatMessage } from '../../src/agent/agent-service.js';

describe('token-budget.estimateTokens — tokenizer delegation', () => {
  beforeEach(() => {
    _resetWarnedForTest();
  });

  it('A: backward compat (no model) — positive integer via char/4 fallback', () => {
    const msgs: AgentChatMessage[] = [{ role: 'user', content: 'hello world' }];
    const n = estimateTokens(msgs);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
    // "hello world" = 11 chars; ceil(11/4) = 3; + PER_MESSAGE_OVERHEAD_TOKENS (4) = 7
    expect(n).toBe(Math.ceil(11 / 4) + PER_MESSAGE_OVERHEAD_TOKENS);
  });

  it('B: model-aware OpenAI — js-tiktoken count differs from char/4', () => {
    const msgs: AgentChatMessage[] = [{ role: 'user', content: 'hello world' }];
    const precise = estimateTokens(msgs, 'gpt-4o');
    const fallback = estimateTokens(msgs);
    expect(precise).toBeGreaterThan(0);
    // tiktoken counts "hello world" as 2 tokens; fallback is 3. Plus overhead
    // either way. Must differ.
    expect(precise).not.toBe(fallback);
  });

  it('C: D-10 — system messages excluded entirely (content AND per-message tax)', () => {
    const long = 'LONG system prompt '.repeat(40);
    const withSystem = estimateTokens(
      [
        { role: 'system', content: long },
        { role: 'user', content: 'hi' },
      ],
      'gpt-4o',
    );
    const withoutSystem = estimateTokens(
      [{ role: 'user', content: 'hi' }],
      'gpt-4o',
    );
    expect(withSystem).toBe(withoutSystem);
  });

  it('D: D-09 — tool-call JSON envelopes included in count', () => {
    const big = 'b'.repeat(200);
    const withToolCall: AgentChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'x', args: { a: big } }],
      },
    ];
    const bare: AgentChatMessage[] = [{ role: 'assistant', content: '' }];
    const nTool = estimateTokens(withToolCall, 'gpt-4o');
    const nBare = estimateTokens(bare, 'gpt-4o');
    expect(nTool).toBeGreaterThan(nBare);
    // Tool-call JSON is ~220+ chars; ~50+ tokens via tiktoken. Ensure the
    // delta is meaningful (not just the overhead).
    expect(nTool - nBare).toBeGreaterThan(20);
  });

  it('E: monotonicity under unknown model — adding chars never decreases count', () => {
    const a = estimateTokens([{ role: 'user', content: 'abc' }], undefined);
    const b = estimateTokens([{ role: 'user', content: 'abcdef' }], undefined);
    expect(b).toBeGreaterThan(a);
  });

  it('F: shouldCompact boundary is floor(max * 0.85) — unchanged from pre-phase', () => {
    expect(shouldCompact(8000, 8192)).toBe(true);
    expect(shouldCompact(6900, 8192)).toBe(false);
    // floor(8192 * 0.85) = 6963 → 6963 does not trigger, 6964 does.
    expect(shouldCompact(6963, 8192)).toBe(false);
    expect(shouldCompact(6964, 8192)).toBe(true);
  });
});
