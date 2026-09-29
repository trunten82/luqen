/**
 * Live discovery progress (DISCOVERY-PROGRESS-1).
 *
 * Discovery — and above all the WAF browser fallback, which can run for its
 * whole 120 s budget — used to produce no event until it finished, so a
 * healthy scan looked frozen. This reporter turns the crawlers' per-URL
 * `onUrlFound` callbacks into a throttled "N pages found so far, in phase X"
 * stream:
 *
 *  - every phase change is emitted IMMEDIATELY (carrying the current count);
 *  - finds inside a phase are emitted at most once per interval, with a
 *    trailing event so the last count of a burst is never held back longer
 *    than one interval;
 *  - `pagesFound` counts DISTINCT URLs, so it can only grow, and is capped at
 *    `maxPages` so the live figure never exceeds the final discovered count;
 *  - `close()` cancels any pending trailing event and silences the reporter,
 *    so nothing can arrive after discovery has returned;
 *  - a throwing listener is swallowed — progress must never break discovery.
 */

export type DiscoveryPhase = 'sitemap' | 'crawl' | 'browser';

export interface DiscoveryProgress {
  readonly phase: DiscoveryPhase;
  /** Distinct in-scope URLs found so far across every phase (capped at maxPages). */
  readonly pagesFound: number;
}

export type DiscoveryProgressListener = (progress: DiscoveryProgress) => void;

/** At most one within-phase event per second. */
export const DISCOVERY_PROGRESS_INTERVAL_MS = 1000;

export interface DiscoveryProgressReporter {
  phase(phase: DiscoveryPhase): void;
  found(url: string): void;
  foundMany(urls: readonly string[]): void;
  close(): void;
}

export interface DiscoveryProgressReporterOptions {
  readonly maxPages?: number;
  readonly intervalMs?: number;
}

/** Calls a crawler's per-URL progress callback without ever letting it break the crawl. */
export function notifyUrlFound(listener: ((url: string) => void) | undefined, url: string): void {
  if (listener === undefined) return;
  try {
    listener(url);
  } catch {
    // Progress reporting is best-effort.
  }
}

const NOOP_REPORTER: DiscoveryProgressReporter = {
  phase() {},
  found() {},
  foundMany() {},
  close() {},
};

export function createDiscoveryProgressReporter(
  listener: DiscoveryProgressListener | undefined,
  options: DiscoveryProgressReporterOptions = {},
): DiscoveryProgressReporter {
  if (listener === undefined) return NOOP_REPORTER;

  const intervalMs = options.intervalMs ?? DISCOVERY_PROGRESS_INTERVAL_MS;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  let currentPhase: DiscoveryPhase | undefined;
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let lastEmittedCount = -1;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const count = (): number => Math.min(seen.size, maxPages);

  const cancelTrailing = (): void => {
    if (trailing !== undefined) {
      clearTimeout(trailing);
      trailing = undefined;
    }
  };

  const emitNow = (): void => {
    if (closed || currentPhase === undefined) return;
    cancelTrailing();
    lastEmitAt = Date.now();
    lastEmittedCount = count();
    try {
      listener({ phase: currentPhase, pagesFound: lastEmittedCount });
    } catch {
      // A listener failure is never a discovery failure.
    }
  };

  const onCountChanged = (): void => {
    if (closed || currentPhase === undefined) return;
    if (count() === lastEmittedCount) return;
    const elapsed = Date.now() - lastEmitAt;
    if (elapsed >= intervalMs) {
      emitNow();
      return;
    }
    if (trailing === undefined) {
      trailing = setTimeout(() => {
        trailing = undefined;
        if (count() !== lastEmittedCount) emitNow();
      }, intervalMs - elapsed);
    }
  };

  return {
    phase(phase) {
      if (closed) return;
      currentPhase = phase;
      emitNow();
    },
    found(url) {
      if (closed || seen.has(url)) return;
      seen.add(url);
      onCountChanged();
    },
    foundMany(urls) {
      if (closed) return;
      for (const url of urls) seen.add(url);
      onCountChanged();
    },
    close() {
      closed = true;
      cancelTrailing();
    },
  };
}
