import type { StreamFrame } from './types.js';

/**
 * Merge multiple AbortSignals into one. Aborts as soon as ANY input aborts.
 *
 * Falls back to a manual controller on runtimes that don't expose the native
 * AbortSignal.any() static (Node 20 prior to 22.3).
 */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: readonly AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * Yield Server-Sent-Events payloads from a Response body. Each yielded value
 * is the `data:` payload of one SSE frame (frames separated by blank lines).
 *
 * Skips `data: [DONE]` sentinels and malformed JSON. Callers own JSON.parse.
 *
 * Used by the OpenAI adapter for `/v1/chat/completions` with `stream=true`.
 */
export async function* readSsePayloads(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
        const rawFrame = buf.slice(0, sepIdx);
        buf = buf.slice(sepIdx + 2);
        for (const line of rawFrame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '' || data === '[DONE]') continue;
          yield data;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released — ignore.
    }
  }
}

/**
 * Yield NDJSON lines (newline-delimited JSON) as raw strings from a Response
 * body. Callers own JSON.parse.
 *
 * Used by the Ollama adapter for `/api/chat` with `stream=true`.
 */
export async function* readNdjsonLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nlIdx).trim();
        buf = buf.slice(nlIdx + 1);
        if (line.length === 0) continue;
        yield line;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released — ignore.
    }
  }
}

/**
 * Runtime type guard for StreamFrame. Defense-in-depth at emit boundaries.
 *
 * Returns the frame unchanged when valid, throws Error when not. We accept
 * the tiny perf cost of this check at each emit site to catch regressions
 * in provider-adapter code paths that would otherwise leak malformed frames
 * through to the capability engine.
 */
export function validateStreamFrame(frame: unknown): StreamFrame {
  if (typeof frame !== 'object' || frame === null) {
    throw new Error('StreamFrame must be an object');
  }
  const f = frame as { type?: unknown };
  switch (f.type) {
    case 'token': {
      const tf = f as { type: 'token'; text?: unknown };
      if (typeof tf.text !== 'string') {
        throw new Error("StreamFrame 'token' requires text:string");
      }
      return tf as StreamFrame;
    }
    case 'tool_calls': {
      const tc = f as { type: 'tool_calls'; calls?: unknown };
      if (!Array.isArray(tc.calls)) {
        throw new Error("StreamFrame 'tool_calls' requires calls:Array");
      }
      for (const c of tc.calls as Array<{ id?: unknown; name?: unknown; args?: unknown }>) {
        if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.args !== 'object') {
          throw new Error('StreamFrame tool_calls[].{id,name,args} malformed');
        }
      }
      return tc as StreamFrame;
    }
    case 'done': {
      const df = f as { type: 'done'; finishReason?: unknown };
      const ok = df.finishReason === 'stop' || df.finishReason === 'length'
        || df.finishReason === 'tool_calls' || df.finishReason === 'error';
      if (!ok) {
        throw new Error("StreamFrame 'done' requires finishReason");
      }
      return df as StreamFrame;
    }
    case 'error': {
      const ef = f as { type: 'error'; code?: unknown; message?: unknown; retryable?: unknown };
      const codeOk = ef.code === 'provider_failed' || ef.code === 'timeout' || ef.code === 'invalid_response';
      if (!codeOk || typeof ef.message !== 'string' || typeof ef.retryable !== 'boolean') {
        throw new Error("StreamFrame 'error' requires code/message/retryable");
      }
      return ef as StreamFrame;
    }
    default:
      throw new Error(`StreamFrame has unknown type: ${String(f.type)}`);
  }
}
