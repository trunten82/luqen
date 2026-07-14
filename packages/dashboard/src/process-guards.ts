/**
 * Process-level guards for the long-running dashboard service.
 *
 * Why this exists: pa11y's request-interception callback calls
 * `interceptedRequest.continue()` fire-and-forget inside Puppeteer's async
 * event path. When Chrome rejects the continue (e.g. a scanned site set a
 * cookie header Chrome refuses to re-send — observed live 2026-07-13:
 * `ProtocolError: Fetch.continueRequest: Invalid header: cookie age-gate-ok…`),
 * the rejection is unhandled and Node's default behaviour KILLS the whole
 * dashboard — a production outage caused by one hostile page on a scan.
 * A try/catch around `pa11y()` cannot catch it.
 *
 * unhandledRejection → log + keep serving. uncaughtException deliberately
 * keeps Node's default (crash, systemd restarts): after a synchronous
 * uncaught throw the process state may be corrupt and must not linger.
 */

export interface GuardLogger {
  error(obj: unknown, msg?: string): void;
}

/** Build the handler (exported for direct unit testing). */
export function makeUnhandledRejectionHandler(
  log: GuardLogger,
): (reason: unknown) => void {
  return (reason: unknown): void => {
    log.error(
      { err: reason },
      'Unhandled promise rejection — service kept alive; find and fix the source',
    );
  };
}

/** Wire the guards onto the current process. Call once from the serve entry. */
export function registerProcessGuards(log: GuardLogger): (reason: unknown) => void {
  const handler = makeUnhandledRejectionHandler(log);
  process.on('unhandledRejection', handler);
  return handler;
}
