/**
 * Process lifecycle for the long-running `serve` command:
 *
 *  1. At startup, a best-effort sweep of stale Chromium profile dirs left in
 *     the (often RAM-backed) tmp dir by earlier processes that were SIGKILLed,
 *     OOM-killed or crash-looped (core `sweepStaleChromeProfiles`). It never
 *     touches a profile a running Chromium uses. It is the ONLY cleanup for the
 *     axe scanner plugin's `puppeteer_dev_chrome_profile-*` dirs: that plugin
 *     lives in a separate repository and launches puppeteer directly.
 *  2. A graceful SIGTERM/SIGINT shutdown (./shutdown.ts): stop the HTTP server,
 *     deactivate plugins (which closes their resident browsers), close every
 *     engine browser still alive with its egress proxy and profile, then exit —
 *     inside a hard deadline so systemd never waits out its 90 s stop timeout.
 */

import { closeAllBrowsers as coreCloseAllBrowsers, sweepStaleChromeProfiles, type SweepResult } from '@luqen/core';
import {
  createGracefulShutdown,
  installSignalHandlers,
  DEFAULT_SHUTDOWN_DEADLINE_MS,
  type ShutdownLogger,
  type ShutdownStep,
} from './shutdown.js';

/** Per-step ceiling; three steps stay well inside the 20 s overall deadline. */
const DEFAULT_STEP_TIMEOUT_MS = 5_000;

/** The slice of the Fastify instance the lifecycle needs. */
export interface LifecycleServer {
  readonly log: ShutdownLogger;
  close(): Promise<unknown>;
  /** Decorated by server.ts; absent in hosts without plugins. */
  readonly pluginManager?: { shutdownAll(): Promise<void> };
}

export interface LifecycleOptions {
  readonly deadlineMs?: number;
  readonly stepTimeoutMs?: number;
  readonly closeAllBrowsers?: () => Promise<void>;
  readonly sweep?: () => Promise<SweepResult>;
  readonly proc?: Pick<NodeJS.EventEmitter, 'on' | 'off'>;
  readonly exit?: (code: number) => void;
}

export function buildShutdownSteps(
  server: LifecycleServer,
  opts: Pick<LifecycleOptions, 'closeAllBrowsers' | 'stepTimeoutMs'> = {},
): ShutdownStep[] {
  const timeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const closeBrowsers = opts.closeAllBrowsers ?? coreCloseAllBrowsers;
  return [
    // Stops accepting connections first; waits (bounded) for in-flight requests.
    { name: 'http', timeoutMs, run: () => server.close() },
    { name: 'plugins', timeoutMs, run: () => server.pluginManager?.shutdownAll() },
    { name: 'browsers', timeoutMs, run: () => closeBrowsers() },
  ];
}

function logSweep(log: ShutdownLogger, sweep: () => Promise<SweepResult>): void {
  sweep().then(
    (r) => log.info(
      {
        removed: r.removed.length,
        keptInUse: r.keptInUse.length,
        keptYoung: r.keptYoung.length,
        errors: r.errors.length,
        ...(r.skipped ? { skipped: r.skipped } : {}),
      },
      'Stale Chromium profile sweep finished',
    ),
    (err: unknown) => log.warn({ err }, 'Stale Chromium profile sweep failed — continuing'),
  );
}

/** Wire the sweep and the graceful shutdown. Returns the uninstall handle. */
export function installProcessLifecycle(server: LifecycleServer, opts: LifecycleOptions = {}): () => void {
  logSweep(server.log, opts.sweep ?? (() => sweepStaleChromeProfiles()));
  const shutdown = createGracefulShutdown({
    log: server.log,
    deadlineMs: opts.deadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS,
    steps: buildShutdownSteps(server, opts),
    ...(opts.exit ? { exit: opts.exit } : {}),
  });
  return installSignalHandlers(shutdown, opts.proc ?? process);
}
