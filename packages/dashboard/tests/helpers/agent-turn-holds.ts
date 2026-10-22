/**
 * Hold primitives for the assistant's race tests.
 *
 * A hold is a deferred promise that stands in for I/O latency in the permission decision, the tool run
 * or the model. Every hold is released in the test's `finally`, and every interleaving it produces is
 * one that a dashboard with a real-I/O storage, resolver or a second process can reach: the held code
 * is the production code, only its timing is controlled.
 */
import { vi } from 'vitest';
import type { AgentStreamOptions } from '../../src/agent/agent-service.js';
import type { ToolCallInput, ToolDispatchContext, ToolDispatcher } from '../../src/agent/tool-dispatch.js';
import type { ScriptEntry, ScriptStep } from './agent-chain.js';

/** How long a test waits for a held step to be reached before it fails. */
const WAIT_MS = 4000;

export interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

export function gate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open: () => open() };
}

/** A model step that records the provider options, waits for release and then answers `answer`, whatever the abort says. */
export function heldStep(answer: ScriptStep): { entry: ScriptEntry; release(): void; options(): AgentStreamOptions | undefined } {
  const g = gate();
  let seen: AgentStreamOptions | undefined;
  return {
    entry: (_history, options) => {
      seen = options;
      return g.promise.then(() => answer);
    },
    release: g.open,
    options: () => seen,
  };
}

/**
 * A model step that streams `token` (when given) and waits: it rejects with an AbortError when the signal
 * aborts, the way a provider does, and answers `answer` when it is released first.
 */
export function streamingStep(answer: ScriptStep, token?: string): { entry: ScriptEntry; release(): void; options(): AgentStreamOptions | undefined } {
  const g = gate();
  let seen: AgentStreamOptions | undefined;
  return {
    entry: (_history, options) => {
      seen = options;
      if (token !== undefined) options.onFrame({ type: 'token', text: token });
      return new Promise<ScriptStep>((resolve, reject) => {
        const onAbort = (): void => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (options.signal.aborted) { onAbort(); return; }
        options.signal.addEventListener('abort', onAbort, { once: true });
        void g.promise.then(() => resolve(answer));
      });
    },
    release: g.open,
    options: () => seen,
  };
}

/** The next dispatch of `dispatcher` records its context, waits for release, then runs the real dispatch. */
export function holdDispatchOnce(dispatcher: ToolDispatcher): { release(): void; ctx(): ToolDispatchContext | undefined } {
  const real = dispatcher.dispatch.bind(dispatcher);
  const g = gate();
  let seen: ToolDispatchContext | undefined;
  vi.spyOn(dispatcher, 'dispatch').mockImplementationOnce(async (call: ToolCallInput, ctx: ToolDispatchContext) => {
    seen = ctx;
    await g.promise;
    return real(call, ctx);
  });
  return { release: g.open, ctx: () => seen };
}

/** Waits, bounded by wall-clock time (not a count of event-loop turns, which a loaded host spends quickly), until `ready` holds. */
export async function waitUntil(ready: () => boolean, what: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) await new Promise((r) => setImmediate(r));
  if (!ready()) throw new Error(`the turn did not reach ${what}`);
}
