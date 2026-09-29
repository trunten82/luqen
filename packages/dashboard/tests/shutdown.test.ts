import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createGracefulShutdown, installSignalHandlers, type ShutdownLogger } from '../src/shutdown.js';

function fakeLog(): ShutdownLogger & { lines: string[] } {
  const lines: string[] = [];
  const rec = (level: string) => (_obj: unknown, msg?: string) => { lines.push(`${level}:${msg ?? ''}`); };
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error') };
}

const never = (): Promise<void> => new Promise<void>(() => {});

describe('createGracefulShutdown', () => {
  it('GS1: runs every step in order, then exits 0', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const sd = createGracefulShutdown({
      log: fakeLog(),
      exit,
      steps: [
        { name: 'http', run: async () => { order.push('http'); } },
        { name: 'plugins', run: async () => { order.push('plugins'); } },
        { name: 'browsers', run: async () => { order.push('browsers'); } },
      ],
    });
    await sd.shutdown('SIGTERM');
    expect(order).toEqual(['http', 'plugins', 'browsers']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('GS2 [deadline]: a close that hangs forever still ends in exit(1) at the deadline', async () => {
    const exit = vi.fn();
    const log = fakeLog();
    const sd = createGracefulShutdown({ log, exit, deadlineMs: 60, steps: [{ name: 'hangs', run: never }] });
    void sd.shutdown('SIGTERM');
    await new Promise((r) => setTimeout(r, 150));
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.lines.some((l) => l.startsWith('error:') && /deadline/i.test(l))).toBe(true);
  });

  it('GS3: a step that hangs past its own timeout does not block the steps after it', async () => {
    const exit = vi.fn();
    const browsers = vi.fn(async () => {});
    const sd = createGracefulShutdown({
      log: fakeLog(),
      exit,
      deadlineMs: 5_000,
      steps: [{ name: 'http', run: never, timeoutMs: 30 }, { name: 'browsers', run: browsers }],
    });
    await sd.shutdown('SIGTERM');
    expect(browsers).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('GS4: a step that throws is logged and the rest still run', async () => {
    const exit = vi.fn();
    const log = fakeLog();
    const after = vi.fn(async () => {});
    const sd = createGracefulShutdown({
      log,
      exit,
      steps: [{ name: 'plugins', run: async () => { throw new Error('boom'); } }, { name: 'browsers', run: after }],
    });
    await sd.shutdown('SIGTERM');
    expect(after).toHaveBeenCalledTimes(1);
    expect(log.lines.some((l) => l.startsWith('warn:'))).toBe(true);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('GS5 [idempotent]: a second signal neither re-runs the steps nor exits twice', async () => {
    const exit = vi.fn();
    const step = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const sd = createGracefulShutdown({ log: fakeLog(), exit, steps: [{ name: 'http', run: step }] });
    const first = sd.shutdown('SIGTERM');
    const second = sd.shutdown('SIGTERM');
    await Promise.all([first, second]);
    await sd.shutdown('SIGINT');
    expect(step).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('installSignalHandlers', () => {
  it('SH1: SIGTERM and SIGINT both start the shutdown; uninstall removes the handlers', () => {
    const proc = new EventEmitter();
    const shutdown = vi.fn(async () => {});
    const uninstall = installSignalHandlers({ shutdown }, proc);
    proc.emit('SIGTERM', 'SIGTERM');
    proc.emit('SIGINT', 'SIGINT');
    expect(shutdown.mock.calls.map((c) => c[0])).toEqual(['SIGTERM', 'SIGINT']);
    uninstall();
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });
});
