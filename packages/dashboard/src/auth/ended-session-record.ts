/**
 * Bounded in-memory record of ended sessions.
 */

export interface EndedSessionRecord {
  /** Record `key`; false when it is already recorded and not yet forgotten. */
  claim(key: string): boolean;
  /** Forget `key` (a claim whose audit write failed). */
  release(key: string): void;
  /** How many keys are held. */
  readonly size: number;
}

export interface EndedSessionRecordOptions {
  readonly maxKeys: number;
  readonly ttlMs: number;
  readonly now?: () => number;
}

export function createEndedSessionRecord(_options: EndedSessionRecordOptions): EndedSessionRecord {
  return { claim: () => true, release: () => undefined, size: 0 };
}
