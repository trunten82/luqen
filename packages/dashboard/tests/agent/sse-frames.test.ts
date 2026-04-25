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
  ToolStartedFrameSchema,
  ToolCompletedFrameSchema,
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

describe('Tool lifecycle frames', () => {
  it('Test 1: tool_started parses with toolCallId + toolName', () => {
    const frame = SseFrameSchema.parse({
      type: 'tool_started',
      toolCallId: 't1',
      toolName: 'dashboard_list_reports',
    });
    expect(frame).toEqual({
      type: 'tool_started',
      toolCallId: 't1',
      toolName: 'dashboard_list_reports',
    });
    // exposed schema export usable too
    expect(ToolStartedFrameSchema.parse(frame)).toEqual(frame);
  });

  it('Test 2: tool_completed parses with status success and status error', () => {
    const success = SseFrameSchema.parse({
      type: 'tool_completed',
      toolCallId: 't1',
      toolName: 'foo',
      status: 'success',
    });
    expect(success).toMatchObject({ type: 'tool_completed', status: 'success' });

    const errored = SseFrameSchema.parse({
      type: 'tool_completed',
      toolCallId: 't1',
      toolName: 'foo',
      status: 'error',
    });
    expect(errored).toMatchObject({ type: 'tool_completed', status: 'error' });
    expect(ToolCompletedFrameSchema).toBeDefined();
  });

  it('Test 3: tool_completed with status:error accepts optional errorMessage', () => {
    const frame = SseFrameSchema.parse({
      type: 'tool_completed',
      toolCallId: 't1',
      toolName: 'foo',
      status: 'error',
      errorMessage: 'handler exploded',
    });
    expect(frame).toEqual({
      type: 'tool_completed',
      toolCallId: 't1',
      toolName: 'foo',
      status: 'error',
      errorMessage: 'handler exploded',
    });
  });

  it('Test 4: tool_completed with invalid status enum throws', () => {
    expect(() =>
      SseFrameSchema.parse({
        type: 'tool_completed',
        toolCallId: 't1',
        toolName: 'foo',
        status: 'foo',
      }),
    ).toThrow(z.ZodError);
  });

  it('Test 5: writeFrame emits tool_started event with serialized data', () => {
    const write = vi.fn().mockReturnValue(true);
    const reply = { raw: { write } } as unknown as Parameters<typeof writeFrame>[0];
    const ok = writeFrame(reply, {
      type: 'tool_started',
      toolCallId: 't1',
      toolName: 'foo',
    });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledWith(
      `event: tool_started\ndata: ${JSON.stringify({
        type: 'tool_started',
        toolCallId: 't1',
        toolName: 'foo',
      })}\n\n`,
    );
  });

  it('Test 6: writeFrame on malformed tool_started throws synchronously, no bytes', () => {
    const write = vi.fn().mockReturnValue(true);
    const reply = { raw: { write } } as unknown as Parameters<typeof writeFrame>[0];
    expect(() =>
      writeFrame(reply, { type: 'tool_started' } as unknown as SseFrame),
    ).toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
