/**
 * Phase 63.1 — Aggregator webhook delivery.
 *
 * Fire-and-forget POST to every active aggregator webhook subscription for
 * a given org. Signs the payload with HMAC-SHA256 when the subscription
 * has a secret. Never throws to the caller — audit events must not be
 * blocked by webhook delivery problems.
 *
 * Phase 63.4 — Retries on 5xx and network errors with exponential backoff
 * (250ms, 1s, 4s — three attempts after the initial try, max). Still fire
 * and forget; failures are logged with subscriber id + URL.
 */
import { createHmac } from 'node:crypto';
import type { StorageAdapter } from '../db/index.js';

export interface AggregatorLogger {
  warn(msg: string, ...args: unknown[]): void;
  error?(msg: string, ...args: unknown[]): void;
}

export type AggregatorEventType =
  | 'coordinated_pr.created'
  | 'coordinated_pr.leg.opened'
  | 'coordinated_pr.leg.delegated'
  | 'coordinated_pr.rolled_back';

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// Phase 63.4 — backoff schedule (ms) for retry attempts AFTER the initial
// attempt. Three retries total. Kept in-file to honour the no-new-deps rule.
const RETRY_BACKOFFS_MS: readonly number[] = [250, 1000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt one HTTP delivery and decide whether to retry. Returns true on
 * a non-retryable outcome (success OR 4xx — caller's fault, retrying is
 * pointless), false on 5xx, or throws on network error.
 */
async function attemptDelivery(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; retryable: boolean }> {
  const res = await fetch(url, init);
  const retryable = res.status >= 500 && res.status < 600;
  return { ok: res.ok, status: res.status, retryable };
}

async function deliverWithRetry(
  sub: { id: string; url: string; secret: string | null },
  body: string,
  eventType: AggregatorEventType,
  logger?: AggregatorLogger,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Luqen-Event': eventType,
  };
  if (sub.secret !== null && sub.secret !== '') {
    headers['Luqen-Signature'] = `sha256=${sign(sub.secret, body)}`;
  }
  const init: RequestInit = { method: 'POST', headers, body };

  let lastErr: unknown = null;
  let lastStatus: number | null = null;
  const totalAttempts = RETRY_BACKOFFS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const result = await attemptDelivery(sub.url, init);
      if (!result.retryable) {
        // Success OR 4xx — done. 4xx is not our problem to retry.
        return;
      }
      lastStatus = result.status;
      lastErr = null;
    } catch (err) {
      lastErr = err;
      lastStatus = null;
    }
    // Sleep before next attempt (skip after the final attempt).
    if (attempt < RETRY_BACKOFFS_MS.length) {
      await sleep(RETRY_BACKOFFS_MS[attempt]);
    }
  }
  // All attempts exhausted — log once with subscriber + URL context.
  const reason =
    lastErr !== null
      ? lastErr instanceof Error
        ? lastErr.message
        : String(lastErr)
      : `http_${lastStatus ?? 'unknown'}`;
  logger?.warn(
    `aggregator webhook delivery failed for sub=${sub.id} url=${sub.url}: ${reason}`,
  );
}

/**
 * Deliver an aggregator event to every active subscription for orgId.
 * Each delivery is wrapped in try/catch — a failure for one subscriber
 * never blocks the others, and never propagates back to the caller.
 */
export async function deliverAggregatorEvent(
  storage: StorageAdapter,
  orgId: string,
  eventType: AggregatorEventType,
  payload: Record<string, unknown>,
  logger?: AggregatorLogger,
): Promise<void> {
  let subscribers: readonly { id: string; url: string; secret: string | null }[] = [];
  try {
    subscribers = await storage.orgAggregatorWebhooks.listActive(orgId);
  } catch (err) {
    logger?.warn(
      `aggregator webhook lookup failed for org=${orgId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }
  if (subscribers.length === 0) return;

  const body = JSON.stringify({ event: eventType, payload });

  await Promise.all(
    subscribers.map((sub) => deliverWithRetry(sub, body, eventType, logger)),
  );
}
