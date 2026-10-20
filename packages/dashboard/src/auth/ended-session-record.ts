/**
 * Bounded in-memory record of ended sessions.
 *
 * A refused session is cleared on the request that finds it refused, but its cookie is stateless:
 * the same cookie can be sent again. The record holds one key per ended session for the idle
 * window, so the audit log gets one row per session however often the cookie comes back. Activity
 * is recorded only on requests the session guard checks, and the guard clears a session it refuses
 * on the same request, so a refused session gains no activity. A cookie can therefore only reach
 * the refusal within one idle window of its last activity (past that the idle limit ends it
 * first), so one window covers every cookie of the session. The record holds at most
 * `maxKeys` keys; when full the oldest key is dropped. It is process-local, like the sessions it
 * describes. Keys are never derived from a cookie value.
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

export function createEndedSessionRecord(options: EndedSessionRecordOptions): EndedSessionRecord {
  const { maxKeys, ttlMs } = options;
  const now = options.now ?? Date.now;
  // Insertion order is expiry order: every key lives for the same window and a key is
  // re-inserted (at the end) only after it was forgotten.
  const expiries = new Map<string, number>();

  const forgetExpired = (at: number): void => {
    for (const [key, expiresAt] of expiries) {
      if (expiresAt > at) return;
      expiries.delete(key);
    }
  };

  return {
    claim(key: string): boolean {
      const at = now();
      forgetExpired(at);
      if (expiries.has(key)) return false;
      expiries.set(key, at + ttlMs);
      while (expiries.size > maxKeys) {
        const oldest = expiries.keys().next();
        if (oldest.done === true) break;
        expiries.delete(oldest.value);
      }
      return true;
    },
    release(key: string): void {
      expiries.delete(key);
    },
    get size(): number {
      return expiries.size;
    },
  };
}
