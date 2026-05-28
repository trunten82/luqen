import { performance } from 'node:perf_hooks';
import type { DbAdapter } from '../db/adapter.js';
import type { CompletionResult } from '../providers/types.js';
import type { CapabilityName, Model, Provider } from '../types.js';

/**
 * Phase 72-02 — wrap a provider call (`adapter.complete(...)`) with
 * persistent usage telemetry.
 *
 *  - Persists exactly one row per call attempt, success OR error.
 *  - Failures inside `db.recordUsage` are swallowed: telemetry must
 *    never alter the inference's success/failure observable behaviour.
 *  - Latency is measured by this helper, not the provider, so the
 *    figure includes the time spent inside the adapter.
 *
 * The 6th capability (agent-conversation) consumes a stream, not a
 * Promise<CompletionResult>; it uses `recordStreamingUsage()` (sibling
 * helper) instead.
 */

interface UsageMeta {
  readonly capability: CapabilityName;
  readonly orgId?: string | null;
  readonly provider: Pick<Provider, 'id' | 'type'>;
  readonly model: Pick<Model, 'id' | 'displayName'>;
  readonly agentConvId?: string | null;
  readonly agentMsgId?: string | null;
}

async function safeRecord(
  db: DbAdapter,
  meta: UsageMeta,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  status: 'ok' | 'error',
  errorClass?: string,
): Promise<void> {
  try {
    await db.recordUsage({
      capability: meta.capability,
      orgId: meta.orgId ?? null,
      providerId: meta.provider.id,
      providerType: meta.provider.type,
      modelId: meta.model.id,
      modelName: meta.model.displayName,
      promptTokens,
      completionTokens,
      latencyMs,
      status,
      ...(errorClass !== undefined ? { errorClass } : {}),
      ...(meta.agentConvId !== undefined && meta.agentConvId !== null
        ? { agentConvId: meta.agentConvId }
        : {}),
      ...(meta.agentMsgId !== undefined && meta.agentMsgId !== null
        ? { agentMsgId: meta.agentMsgId }
        : {}),
    });
  } catch {
    /* Telemetry failure must never alter inference path. */
  }
}

export async function recordCompletion(
  db: DbAdapter,
  meta: UsageMeta,
  call: () => Promise<CompletionResult>,
): Promise<CompletionResult> {
  const t0 = performance.now();
  try {
    const result = await call();
    await safeRecord(
      db,
      meta,
      result.usage.inputTokens,
      result.usage.outputTokens,
      Math.round(performance.now() - t0),
      'ok',
    );
    return result;
  } catch (err) {
    const errorClass = err instanceof Error ? err.constructor.name : 'Error';
    await safeRecord(
      db,
      meta,
      0,
      0,
      Math.round(performance.now() - t0),
      'error',
      errorClass,
    );
    throw err;
  }
}

/**
 * Streaming variant — used by agent-conversation. The caller passes a
 * factory for the StreamFrame iterable; this helper wraps the
 * iteration, watches for the terminal `done` (with usage) or `error`
 * frame, then records one row.
 */
export async function* recordStreaming<F extends { type: string }>(
  db: DbAdapter,
  meta: UsageMeta,
  source: AsyncIterable<F>,
): AsyncIterable<F> {
  const t0 = performance.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let status: 'ok' | 'error' = 'ok';
  let errorClass: string | undefined;
  try {
    for await (const frame of source) {
      const anyFrame = frame as unknown as {
        type: string;
        usage?: { inputTokens?: number; outputTokens?: number };
        code?: string;
      };
      if (anyFrame.type === 'done' && anyFrame.usage !== undefined) {
        promptTokens = anyFrame.usage.inputTokens ?? 0;
        completionTokens = anyFrame.usage.outputTokens ?? 0;
      } else if (anyFrame.type === 'error') {
        status = 'error';
        errorClass = anyFrame.code ?? 'StreamError';
      }
      yield frame;
    }
  } catch (err) {
    status = 'error';
    errorClass = err instanceof Error ? err.constructor.name : 'Error';
    throw err;
  } finally {
    await safeRecord(
      db,
      meta,
      promptTokens,
      completionTokens,
      Math.round(performance.now() - t0),
      status,
      errorClass,
    );
  }
}
