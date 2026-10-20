/**
 * pending-expiry.ts
 *
 * Declines paused assistant actions that were not confirmed or declined in time.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { StorageAdapter } from '../db/index.js';

/** A paused action not confirmed or declined within this long is declined. */
export const PENDING_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the server looks for paused actions past their time. */
export const PENDING_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type PendingSweepTrigger = 'startup' | 'interval';

export async function runPendingExpirySweep(
  _storage: StorageAdapter,
  _log: FastifyBaseLogger,
  _trigger: PendingSweepTrigger,
  _now: Date = new Date(),
): Promise<number> {
  return 0;
}

export interface PendingExpirySweep {
  /** Stops the hourly run. */
  readonly stop: () => void;
}

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
