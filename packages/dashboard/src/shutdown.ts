/**
 * Graceful process shutdown with a hard deadline.
 *
 * Why this exists (measured 2026-09-29): `systemctl stop luqen-dashboard` hung
 * for the full 90 s `TimeoutStopSec` and ended in SIGKILL. The dashboard had no
 * SIGTERM handler of its own, but puppeteer installs one for every browser it
 * launches (`handleSIGTERM` defaults to true — the axe scanner plugin's
 * resident browsers do exactly this). That listener closes its browser and
 * does NOT exit, and because a listener exists Node no longer applies its
 * default "terminate on SIGTERM" — so the listening HTTP server kept the
 * process alive until systemd killed it.
 *
 * The shutdown runs its steps in order, each bounded by its own timeout and by
 * the overall deadline; a step that throws or hangs is logged and the next one
 * still runs. When the steps finish the process exits 0; if the deadline
 * passes first it exits 1 with an error line, so systemd never waits out its
 * own timeout. Repeated signals are ignored while a shutdown is in progress.
 */

export interface ShutdownLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface ShutdownStep {
  readonly name: string;
  readonly run: () => Promise<unknown> | unknown;
  /** Upper bound for this step; the overall deadline still applies. */
  readonly timeoutMs?: number;
}

export interface GracefulShutdownOptions {
  readonly steps: readonly ShutdownStep[];
  readonly log: ShutdownLogger;
  /** Hard ceiling for the whole shutdown. Default 20 s (systemd waits 90 s). */
  readonly deadlineMs?: number;
  readonly exit?: (code: number) => void;
}

export interface GracefulShutdown {
  shutdown(reason: string): Promise<void>;
}

export const DEFAULT_SHUTDOWN_DEADLINE_MS = 20_000;

class StepTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`step did not finish within ${ms} ms`);
  }
}

async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  if (!Number.isFinite(ms)) {
    await work;
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(ms)), Math.max(0, ms));
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function runStep(step: ShutdownStep, log: ShutdownLogger): Promise<void> {
  const started = Date.now();
  try {
    await withTimeout(Promise.resolve().then(step.run), step.timeoutMs ?? Infinity);
    log.info({ step: step.name, ms: Date.now() - started }, 'Shutdown step complete');
  } catch (err) {
    log.warn({ step: step.name, ms: Date.now() - started, err }, 'Shutdown step failed or timed out — continuing');
  }
}

export function createGracefulShutdown(opts: GracefulShutdownOptions): GracefulShutdown {
  const deadlineMs = opts.deadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let inFlight: Promise<void> | undefined;
  let exited = false;
  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  const run = async (reason: string): Promise<void> => {
    const started = Date.now();
    opts.log.info({ reason, deadlineMs }, 'Graceful shutdown started');
    // Deliberately NOT unref'd: it must fire even if a hung step holds nothing else.
    const deadline = setTimeout(() => {
      opts.log.error({ reason, deadlineMs }, 'Graceful shutdown exceeded its deadline — forcing exit');
      exitOnce(1);
    }, deadlineMs);
    for (const step of opts.steps) {
      if (exited) return;
      await runStep(step, opts.log); // the deadline timer bounds the whole loop
    }
    clearTimeout(deadline);
    if (exited) return;
    opts.log.info({ reason, ms: Date.now() - started }, 'Graceful shutdown complete');
    exitOnce(0);
  };

  return {
    shutdown(reason: string): Promise<void> {
      if (inFlight) {
        opts.log.warn({ reason }, 'Shutdown already in progress — signal ignored');
        return inFlight;
      }
      inFlight = run(reason);
      return inFlight;
    },
  };
}

type SignalSource = Pick<NodeJS.EventEmitter, 'on' | 'off'>;

/** Route SIGTERM and SIGINT to the shutdown. Returns the uninstall handle. */
export function installSignalHandlers(
  target: Pick<GracefulShutdown, 'shutdown'>,
  proc: SignalSource = process,
  signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
): () => void {
  const handlers = signals.map((signal) => {
    const handler = (): void => { void target.shutdown(signal); };
    proc.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) proc.off(signal, handler);
  };
}
