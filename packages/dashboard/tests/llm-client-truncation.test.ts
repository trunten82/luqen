// 2026-09-04 companion-truncation quick task.
//
// Root cause (see .planning/quick/260904-companion-truncation/PLAN.md): the
// Gemini adapter already maps MAX_TOKENS -> finishReason: 'length' on the
// terminal `done` StreamFrame, but nothing between the LLM route and the
// dashboard's LLMClient.streamAgentConversation ever reads that field — so a
// truncated turn and a complete turn are indistinguishable to the caller.
//
// These tests exercise the REAL streamAgentConversation SSE-parsing path
// (mocked `fetch` returning a body with a `getReader()` stream), not a stub
// of the LlmAgentTransport interface — the bug lives inside that parsing
// logic, so a transport-level stub would never see it.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadTranslations, t } from '../src/i18n/index.js';
import { LLMClient } from '../src/llm-client.js';
import type { AgentStreamInput } from '../src/agent/agent-service.js';

/** Encode a sequence of SSE-shaped `StreamFrame`s exactly as the LLM route emits them. */
function makeSseReadableBody(frames: ReadonlyArray<Record<string, unknown>>): {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock: () => void;
  };
} {
  const raw = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  const bytes = new TextEncoder().encode(raw);
  let delivered = false;
  return {
    getReader: () => ({
      read: async () => {
        if (delivered) return { done: true, value: undefined };
        delivered = true;
        return { done: false, value: bytes };
      },
      releaseLock: () => {
        /* no-op */
      },
    }),
  };
}

const baseInput: AgentStreamInput = {
  messages: [{ role: 'user', content: 'give me a prioritised remediation plan' }],
  tools: [],
  orgId: 'org-1',
  userId: 'user-1',
  agentDisplayName: 'Luna',
};

describe('LLMClient.streamAgentConversation — truncation surfacing', () => {
  beforeAll(() => {
    loadTranslations();
  });

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the turn truncated and appends a visible notice when the terminal done frame carries finishReason: 'length'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSseReadableBody([
        { type: 'token', text: 'Sequencing work by legal exposure across EU EN' },
        { type: 'done', finishReason: 'length' },
      ]),
    });

    const client = new LLMClient('http://fake-llm', '', '');
    const frames: unknown[] = [];
    const turn = await client.streamAgentConversation(baseInput, {
      signal: new AbortController().signal,
      onFrame: (f) => frames.push(f),
    });

    expect(turn.finishReason).toBe('length');
    expect(turn.text).toContain('Sequencing work by legal exposure across EU EN');
    // A clearly-marked notice must be appended — using the i18n key, not a
    // duplicated hardcoded string, so a wording change in one place can't
    // desync the assertion from production copy.
    expect(turn.text).toContain(t('agent.error.responseTruncated'));
  });

  it("does NOT mark the turn truncated, and appends NO notice, when the terminal done frame carries finishReason: 'stop'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: makeSseReadableBody([
        { type: 'token', text: 'A short, complete answer.' },
        { type: 'done', finishReason: 'stop' },
      ]),
    });

    const client = new LLMClient('http://fake-llm', '', '');
    const turn = await client.streamAgentConversation(baseInput, {
      signal: new AbortController().signal,
      onFrame: () => {
        /* no-op */
      },
    });

    expect(turn.finishReason).toBe('stop');
    expect(turn.text).toBe('A short, complete answer.');
    expect(turn.text).not.toContain(t('agent.error.responseTruncated'));
  });
});
