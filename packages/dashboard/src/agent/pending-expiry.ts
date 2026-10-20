/**
 * pending-expiry.ts
 *
 * A paused assistant action (a destructive tool call waiting for the user's confirmation) that is
 * neither confirmed nor declined within {@link PENDING_CONFIRMATION_TTL_MS} (24 hours) is declined,
 * so its arguments do not stay stored as given indefinitely. The sweep runs when the server starts
 * and then every {@link PENDING_SWEEP_INTERVAL_MS} (one hour), started by one call from createServer
 * ({@link startPendingExpirySweep}); an action therefore lives at most 25 hours.
 *
 * Each row leaves pending through `claimPendingMessage`, the same conditional write a confirmation
 * or a decline takes: a row the user resolved a moment earlier is not touched twice, and the write
 * stores the row's arguments redacted. A declined row gets the same kind of tool row a decline
 * appends, carrying `{ error: 'expired' }`, so the conversation's history stays well formed.
 *
 * Like the API key sweep, a sweep that finds rows writes one log line and one summary audit row
 * (action agent.pending_expired, details count and trigger); a failure is logged at warn and never
 * stops the server.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { StorageAdapter } from '../db/index.js';

/** A paused action not confirmed or declined within this long is declined. */
export const PENDING_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the server looks for paused actions past their time. */
export const PENDING_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type PendingSweepTrigger = 'startup' | 'interval';

const EXPIRED_RESULT = JSON.stringify({
  error: 'expired',
  message: 'The action was not confirmed within 24 hours and was declined.',
});

/** Declines every paused action older than the TTL at `now`. Returns how many were declined. */
export async function runPendingExpirySweep(
  storage: StorageAdapter,
  log: FastifyBaseLogger,
  trigger: PendingSweepTrigger,
  now: Date = new Date(),
): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - PENDING_CONFIRMATION_TTL_MS).toISOString();
    const due = await storage.conversations.listPendingMessagesBefore(cutoff);
    let count = 0;
    for (const row of due) {
      try {
        if (!(await storage.conversations.claimPendingMessage(row.id, 'denied'))) continue;
        count++;
        await storage.conversations.appendMessage({
          conversationId: row.conversationId,
          role: 'tool',
          toolCallJson: row.toolCallJson ?? '{}',
          toolResultJson: EXPIRED_RESULT,
          status: 'sent',
        });
      } catch (err) {
        log.warn({ err, messageId: row.id }, `pending action expiry failed for one action (${trigger})`);
      }
    }
    if (count > 0) {
      log.info(
        { event: 'agent.pending_expired', count, at: now.toISOString(), trigger },
        `Declined ${count} paused assistant actions not confirmed within 24 hours (${trigger})`,
      );
      try {
        await storage.audit.log({
          actor: 'system',
          action: 'agent.pending_expired',
          resourceType: 'agent_message',
          resourceId: 'sweep',
          details: { count, trigger },
        });
      } catch (err) {
        log.warn({ err }, `pending action expiry audit row failed (${trigger})`);
      }
    }
    return count;
  } catch (err) {
    log.warn({ err }, `pending action expiry sweep failed (${trigger})`);
    return 0;
  }
}

export interface PendingExpirySweep {
  /** Stops the hourly run. */
  readonly stop: () => void;
}

/**
 * Runs the sweep now (the caller awaits that first run) and schedules it every hour. The timer is
 * unref'd, so it never keeps the process alive; `stop` clears it. `clock` is injectable for tests.
 */
export async function startPendingExpirySweep(
  storage: StorageAdapter,
  log: FastifyBaseLogger,
  clock: () => Date = () => new Date(),
): Promise<PendingExpirySweep> {
  await runPendingExpirySweep(storage, log, 'startup', clock());
  const handle = setInterval(() => {
    void runPendingExpirySweep(storage, log, 'interval', clock());
  }, PENDING_SWEEP_INTERVAL_MS);
  handle.unref();
  return { stop: () => clearInterval(handle) };
}
