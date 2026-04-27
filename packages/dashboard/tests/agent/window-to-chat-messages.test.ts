/**
 * Regression test for the "Unexpected tool call id <X> in tool results"
 * Ollama 400 — see .planning/debug/resolved/ollama-tool-call-id-mismatch.md.
 *
 * Bug: when an assistant(tool_calls) batch row was followed by a tool row
 * whose own toolCallJson referenced an id NOT in the batch (most commonly
 * the destructive-pause `pending_confirmation` flow that persists a tool
 * row alone), `windowToChatMessages` skipped the synthetic
 * assistant(tool_calls) preamble for the orphan tool row. Providers then
 * received N+M tool results against an N-call assistant message and 400'd.
 *
 * Fix: track the set of "covered" tool_call ids from the most recent
 * assistant batch and synthesise a preamble whenever a tool row carries an
 * id outside that set.
 */

import { describe, it, expect } from 'vitest';
import { windowToChatMessages } from '../../src/agent/agent-service.js';
import type { Message } from '../../src/db/interfaces/conversation-repository.js';

function msg(partial: Partial<Message> & Pick<Message, 'role'>): Message {
  return {
    id: partial.id ?? `id-${Math.random().toString(36).slice(2, 10)}`,
    conversationId: 'conv-1',
    role: partial.role,
    content: partial.content ?? null,
    toolCallJson: partial.toolCallJson ?? null,
    toolResultJson: partial.toolResultJson ?? null,
    status: partial.status ?? 'sent',
    createdAt: partial.createdAt ?? '2026-04-27T19:14:50.000Z',
    inWindow: true,
    supersededAt: null,
  };
}

describe('windowToChatMessages', () => {
  it('emits a single assistant(tool_calls) preamble for a batch + N tool results', () => {
    const window: Message[] = [
      msg({ role: 'user', content: 'Hi' }),
      msg({
        role: 'assistant',
        content: '',
        toolCallJson: JSON.stringify([
          { id: 'a1', name: 'tool_a', args: {} },
          { id: 'b2', name: 'tool_b', args: {} },
        ]),
      }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'a1', name: 'tool_a', args: {} }),
        toolResultJson: '"ok-a"',
      }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'b2', name: 'tool_b', args: {} }),
        toolResultJson: '"ok-b"',
      }),
    ];

    const out = windowToChatMessages(window);
    // user, assistant(2 tool_calls), tool, tool — NO synthetic preamble
    // for either tool row, both ids are covered by the batch.
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ role: 'user' });
    expect(out[1]).toMatchObject({ role: 'assistant' });
    expect((out[1] as { toolCalls: unknown[] }).toolCalls).toHaveLength(2);
    expect(out[2]).toMatchObject({ role: 'tool' });
    expect(out[3]).toMatchObject({ role: 'tool' });
  });

  it('synthesises a preamble for an orphan tool row whose id is OUTSIDE the prior batch (regression: Ollama 400)', () => {
    // This is the destructive-pause / pending_confirmation flow: after the
    // initial 2-tool batch (a1,b2) resolves, runTurn streamed a 3rd call
    // (orphan-c3 — dashboard_scan_site, destructive) which is persisted as
    // a tool row with status='pending_confirmation' and toolCallJson set.
    // The user confirmed → next turn replays the window. The orphan tool
    // row needs its own assistant(tool_calls) preamble.
    const window: Message[] = [
      msg({ role: 'user', content: 'Check Aperol against ADA' }),
      msg({
        role: 'assistant',
        content: '',
        toolCallJson: JSON.stringify([
          { id: 'a1', name: 'dashboard_list_jurisdictions', args: {} },
          { id: 'b2', name: 'dashboard_list_regulations', args: { q: 'ada' } },
        ]),
      }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'a1', name: 'dashboard_list_jurisdictions', args: {} }),
        toolResultJson: '"jur"',
      }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'b2', name: 'dashboard_list_regulations', args: { q: 'ada' } }),
        toolResultJson: '"reg"',
      }),
      // Orphan: id not in the prior batch.
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({
          id: 'orphan-c3',
          name: 'dashboard_scan_site',
          args: { siteUrl: 'https://www.aperol.com/' },
        }),
        toolResultJson: '"scan-result"',
      }),
    ];

    const out = windowToChatMessages(window);

    // Expected order:
    //   user, assistant(a1,b2), tool(a1), tool(b2),
    //   assistant(orphan-c3) ← synthetic preamble, tool(orphan-c3)
    expect(out).toHaveLength(6);
    expect(out[0]).toMatchObject({ role: 'user' });
    expect((out[1] as { toolCalls: unknown[] }).toolCalls).toHaveLength(2);
    expect(out[2]).toMatchObject({ role: 'tool' });
    expect(out[3]).toMatchObject({ role: 'tool' });
    expect(out[4]).toMatchObject({ role: 'assistant' });
    const synth = out[4] as { toolCalls: Array<{ id: string; name: string }> };
    expect(synth.toolCalls).toHaveLength(1);
    expect(synth.toolCalls[0].id).toBe('orphan-c3');
    expect(synth.toolCalls[0].name).toBe('dashboard_scan_site');
    expect(out[5]).toMatchObject({ role: 'tool' });
  });

  it('legacy pre-32.1-08 single-tool-call rows still get their preamble synthesised', () => {
    // Pre-Plan-32.1-08 conversations have NO assistant(tool_calls) batch
    // row — the assistant text row preceded a single tool row that carried
    // its own toolCallJson. The shim must still synthesise an assistant
    // preamble per tool row.
    const window: Message[] = [
      msg({ role: 'user', content: 'List jurisdictions' }),
      msg({ role: 'assistant', content: 'Looking that up.' }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({
          id: 'legacy-1',
          name: 'dashboard_list_jurisdictions',
          args: {},
        }),
        toolResultJson: '"jur"',
      }),
    ];

    const out = windowToChatMessages(window);
    // user, assistant(text), assistant(synthetic tool_calls), tool
    expect(out).toHaveLength(4);
    expect(out[2]).toMatchObject({ role: 'assistant' });
    const synth = out[2] as { toolCalls: Array<{ id: string }> };
    expect(synth.toolCalls).toEqual([{ id: 'legacy-1', name: 'dashboard_list_jurisdictions', args: {} }]);
    expect(out[3]).toMatchObject({ role: 'tool' });
  });

  it('user message resets the covered-id tracking', () => {
    const window: Message[] = [
      msg({
        role: 'assistant',
        toolCallJson: JSON.stringify([{ id: 'a1', name: 'tool_a', args: {} }]),
      }),
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'a1', name: 'tool_a', args: {} }),
        toolResultJson: '"ok"',
      }),
      msg({ role: 'user', content: 'next turn' }),
      // After the user row, even an id matching the OLD batch must be
      // treated as orphan and get a fresh preamble.
      msg({
        role: 'tool',
        toolCallJson: JSON.stringify({ id: 'a1', name: 'tool_a', args: {} }),
        toolResultJson: '"ok-2"',
      }),
    ];

    const out = windowToChatMessages(window);
    // assistant(a1), tool(a1), user, assistant(synthetic a1), tool(a1)
    expect(out).toHaveLength(5);
    expect(out[2]).toMatchObject({ role: 'user' });
    expect(out[3]).toMatchObject({ role: 'assistant' });
    expect(out[4]).toMatchObject({ role: 'tool' });
  });
});
