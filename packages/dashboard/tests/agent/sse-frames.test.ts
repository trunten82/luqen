/**
 * Phase 32 Plan 04 Task 1 (RED) — SSE frame schema + writeFrame helper tests.
 *
 * Tests the zod discriminated-union contract for SSE frames emitted by
 * AgentService across the browser boundary. writeFrame validates BEFORE
 * writing — malformed frames throw without any bytes hitting reply.raw.
 *
 * Tests 1-5 of plan 32-04.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  SseFrameSchema,
  TokenFrameSchema,
  ToolCallsFrameSchema,
  PendingConfirmationFrameSchema,
  DoneFrameSchema,
  ErrorFrameSchema,
  writeFrame,
  type SseFrame,
} from '../../src/agent/sse-frames.js';

describe('SseFrameSchema — parse + invariants', () => {
  it('Test 1: parses a valid token frame', () => {
    const frame = SseFrameSchema.parse({ type: 'token', text: 'hi' });
    expect(frame).toEqual({ type: 'token', text: 'hi' });
  });

  it('Test 2: rejects unknown frame type', () => {
    expect(() => SseFrameSchema.parse({ type: 'unknown' })).toThrow(z.ZodError);
  });

  it('Test 3: pending_confirmation — confirmationText is optional', () => {
    const frame = SseFrameSchema.parse({
      type: 'pending_confirmation',
      messageId: 'm1',
      toolName: 'foo',
      args: { a: 1 },
    });
    expect(frame).toEqual({
      type: 'pending_confirmation',
      messageId: 'm1',
      toolName: 'foo',
      args: { a: 1 },
    });
  });

  it('Test 3b: exposes component schemas for granular asserts', () => {
    // sanity that subcomponent exports exist
    expect(TokenFrameSchema).toBeDefined();
    expect(ToolCallsFrameSchema).toBeDefined();
    expect(PendingConfirmationFrameSchema).toBeDefined();
    expect(DoneFrameSchema).toBeDefined();
    expect(ErrorFrameSchema).toBeDefined();
  });
});

describe('writeFrame — validates before writing', () => {
  it('Test 4: writeFrame throws on malformed frame; no bytes written', () => {
    const write = vi.fn().mockReturnValue(true);
    const reply = { raw: { write } } as unknown as Parameters<typeof writeFrame>[0];
    expect(() =>
      // cast bypass so we can simulate a bad frame arriving at runtime
      writeFrame(reply, { type: 'nope' } as unknown as SseFrame),
    ).toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it('Test 5: writeFrame writes the SSE line format and returns write() boolean', () => {
    const write = vi.fn().mockReturnValue(true);
    const reply = { raw: { write } } as unknown as Parameters<typeof writeFrame>[0];
    const ok = writeFrame(reply, { type: 'token', text: 'hi' });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      `event: token\ndata: ${JSON.stringify({ type: 'token', text: 'hi' })}\n\n`,
    );
  });
});
