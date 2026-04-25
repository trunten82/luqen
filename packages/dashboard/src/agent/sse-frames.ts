/**
 * Phase 32 Plan 04 — SSE frame contract between AgentService, the /agent/stream
 * route handler, and browser EventSource consumers.
 *
 * Discriminated-union schema validated via zod at emit time: the one chokepoint
 * (`writeFrame`) parses before writing so a malformed frame throws synchronously
 * and no bytes reach the client. Source-of-truth for the frame shape is
 * AI-SPEC §4b.1 — kept byte-verbatim except for the optional `confirmationText`
 * on pending_confirmation (per D-28) and the broadened error `code` set.
 */

import { z } from 'zod';
import type { FastifyReply } from 'fastify';

export const TokenFrameSchema = z.object({
  type: z.literal('token'),
  text: z.string(),
});

export const ToolCallsFrameSchema = z.object({
  type: z.literal('tool_calls'),
  calls: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
    }),
  ),
});

export const PendingConfirmationFrameSchema = z.object({
  type: z.literal('pending_confirmation'),
  messageId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  /**
   * Optional human-readable confirmation copy; sourced from the tool's
   * `confirmationTemplate(args)` when the destructive tool defines one
   * (D-28). Absent when the template is undefined — Plan 07 dialog falls
   * back to `toolName + JSON args`.
   */
  confirmationText: z.string().optional(),
});

export const DoneFrameSchema = z.object({ type: z.literal('done') });

export const ErrorFrameSchema = z.object({
  type: z.literal('error'),
  code: z.enum([
    'provider_failed',
    'iteration_cap',
    'rate_limited',
    'internal',
    'tool_timeout',
  ]),
  message: z.string(),
  retryable: z.boolean(),
});

/**
 * Phase 36 ATOOL-01 — per-tool lifecycle frames emitted around each tool
 * call dispatched within an iteration. Wired into the chip strip in 36-04.
 * Errors during a single tool call are surfaced via tool_completed
 * { status: 'error' }, NOT via the global ErrorFrame (which remains
 * reserved for turn-fatal conditions).
 */
export const ToolStartedFrameSchema = z.object({
  type: z.literal('tool_started'),
  toolCallId: z.string(),
  toolName: z.string(),
});

export const ToolCompletedFrameSchema = z.object({
  type: z.literal('tool_completed'),
  toolCallId: z.string(),
  toolName: z.string(),
  status: z.enum(['success', 'error']),
  errorMessage: z.string().optional(),
});

export const SseFrameSchema = z.discriminatedUnion('type', [
  TokenFrameSchema,
  ToolCallsFrameSchema,
  PendingConfirmationFrameSchema,
  DoneFrameSchema,
  ErrorFrameSchema,
  ToolStartedFrameSchema,
  ToolCompletedFrameSchema,
]);

export type SseFrame = z.infer<typeof SseFrameSchema>;
export type TokenFrame = z.infer<typeof TokenFrameSchema>;
export type ToolCallsFrame = z.infer<typeof ToolCallsFrameSchema>;
export type PendingConfirmationFrame = z.infer<typeof PendingConfirmationFrameSchema>;
export type DoneFrame = z.infer<typeof DoneFrameSchema>;
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>;
export type ToolStartedFrame = z.infer<typeof ToolStartedFrameSchema>;
export type ToolCompletedFrame = z.infer<typeof ToolCompletedFrameSchema>;

/**
 * Minimal FastifyReply shape writeFrame depends on. Avoids importing the
 * full FastifyReply in tests so unit tests can stub with a plain object.
 */
type FastifyReplyLike = Pick<FastifyReply, never> & {
  readonly raw: { write(chunk: string): boolean };
};

/**
 * Single chokepoint for emitting SSE frames from any route handler. Validates
 * the frame against SseFrameSchema BEFORE serialising — catches contract drift
 * (a future adapter emitting an unknown `type`) the instant it happens.
 *
 * Returns the underlying `reply.raw.write` boolean so callers can handle
 * backpressure (AI-SPEC §4b.2) — `false` means the kernel buffer is full and
 * the writer should await `drain` before the next frame.
 */
export function writeFrame(reply: FastifyReplyLike, frame: SseFrame): boolean {
  SseFrameSchema.parse(frame);
  const serialized = `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`;
  return reply.raw.write(serialized);
}
