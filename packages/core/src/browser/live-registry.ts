/**
 * Registry of live engine browsers (PROFILE-CLEANUP-1), so a host process that
 * is shutting down can close every Chromium its engines still hold — with its
 * egress proxy and profile dir — instead of leaving them to be SIGKILLed.
 *
 * Each entry is a teardown function; it is removed from the registry by the
 * `untrack` handle returned when it was added, which callers invoke once the
 * browser is gone by any route (close, crash, finished run).
 */

const teardowns = new Set<() => Promise<void>>();

/** Register a live browser's teardown. Returns the handle that deregisters it. */
export function trackLiveBrowser(teardown: () => Promise<void>): () => void {
  teardowns.add(teardown);
  return () => {
    teardowns.delete(teardown);
  };
}

/** Number of browsers currently registered as live. */
export function trackedCount(): number {
  return teardowns.size;
}

/** Run every registered teardown concurrently. Never throws. */
export async function closeAllTracked(): Promise<void> {
  const pending = [...teardowns];
  await Promise.allSettled(pending.map(async (teardown) => {
    try {
      await teardown();
    } finally {
      teardowns.delete(teardown);
    }
  }));
}
