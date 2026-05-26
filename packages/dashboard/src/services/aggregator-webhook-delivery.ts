/**
 * Phase 63.1 — Aggregator webhook delivery.
 *
 * Fire-and-forget POST to every active aggregator webhook subscription for
 * a given org. Signs the payload with HMAC-SHA256 when the subscription
 * has a secret. Never throws to the caller — audit events must not be
 * blocked by webhook delivery problems.
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
    subscribers.map(async (sub) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Luqen-Event': eventType,
        };
        if (sub.secret !== null && sub.secret !== '') {
          headers['Luqen-Signature'] = `sha256=${sign(sub.secret, body)}`;
        }
        await fetch(sub.url, { method: 'POST', headers, body });
      } catch (err) {
        logger?.warn(
          `aggregator webhook delivery failed for sub=${sub.id} url=${sub.url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }),
  );
}
