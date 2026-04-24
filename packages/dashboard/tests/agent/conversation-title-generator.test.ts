/**
 * Phase 35 Plan 02 — conversation-title-generator (RED-GREEN-REFACTOR).
 *
 * Covers the contract from 35-02-PLAN.md:
 *   1. Happy path: LLM returns clean title → returned verbatim.
 *   2. Trim path: whitespace around title is stripped.
 *   3. Sanitise path: "Title: …" prefix + trailing punctuation removed.
 *   4. Empty response: "" → fallback to truncated user message.
 *   5. Throw path: LLM rejects → fallback, no retry (stub called once).
 *   6. Fallback truncation: fallbackTitle hard-caps at 50 chars.
 *   7. Fallback whitespace collapse: internal whitespace → single spaces, trimmed.
 *
 * The `TitleGeneratorLLM` stub uses a single `vi.fn()` so call count is
 * asserted directly (mirrors tests/agent/agent-service.test.ts stub style).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  generateConversationTitle,
  fallbackTitle,
  type TitleGeneratorLLM,
} from '../../src/agent/conversation-title-generator.js';

interface StubLlm {
  readonly llm: TitleGeneratorLLM;
  readonly fn: ReturnType<typeof vi.fn>;
}

function makeResolvingLlm(text: string): StubLlm {
  const fn = vi.fn().mockResolvedValue({ text, toolCalls: [] });
  return {
    fn,
    llm: { streamAgentConversation: fn as TitleGeneratorLLM['streamAgentConversation'] },
  };
}

function makeRejectingLlm(err: Error): StubLlm {
  const fn = vi.fn().mockRejectedValue(err);
  return {
    fn,
    llm: { streamAgentConversation: fn as TitleGeneratorLLM['streamAgentConversation'] },
  };
}

const BASE_ARGS = {
  orgId: 'org-1',
  userId: 'user-1',
  agentDisplayName: 'Lux',
  userMessage: 'Why is my WCAG report flagging link contrast?',
  assistantReply: 'That rule checks text-to-background ratio below 4.5:1.',
};

describe('generateConversationTitle', () => {
  it('returns the LLM output verbatim on the happy path', async () => {
    const { llm, fn } = makeResolvingLlm('WCAG remediation question');
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe('WCAG remediation question');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('trims surrounding whitespace from the LLM output', async () => {
    const { llm } = makeResolvingLlm('  Report bug  \n');
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe('Report bug');
  });

  it('strips "Title:" prefix and trailing punctuation', async () => {
    const { llm } = makeResolvingLlm('Title: WCAG question.');
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe('WCAG question');
    expect(title).not.toMatch(/^title:/i);
    expect(title).not.toMatch(/\.$/);
  });

  it('strips "Subject:" prefix case-insensitively', async () => {
    const { llm } = makeResolvingLlm('subject: Brand discovery flow');
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe('Brand discovery flow');
  });

  it('falls back to truncated user message on empty LLM response', async () => {
    const { llm } = makeResolvingLlm('');
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe(fallbackTitle(BASE_ARGS.userMessage));
  });

  it('falls back on thrown error without retrying', async () => {
    const { llm, fn } = makeRejectingLlm(new Error('timeout'));
    const title = await generateConversationTitle({ ...BASE_ARGS, llm });
    expect(title).toBe(fallbackTitle(BASE_ARGS.userMessage));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('fallbackTitle', () => {
  it('truncates to exactly 50 characters', () => {
    const result = fallbackTitle('x'.repeat(100));
    expect(result).toHaveLength(50);
    expect(result).toBe('x'.repeat(50));
  });

  it('collapses internal whitespace and trims', () => {
    expect(fallbackTitle('hello\n\nworld   foo')).toBe('hello world foo');
  });

  it('returns short messages untouched (after whitespace normalisation)', () => {
    expect(fallbackTitle('  short message  ')).toBe('short message');
  });
});
