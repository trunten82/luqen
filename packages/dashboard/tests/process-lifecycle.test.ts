import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { buildShutdownSteps, installProcessLifecycle } from '../src/process-lifecycle.js';

function fakeServer(withPlugins = true) {
  const calls: string[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const server = {
    log,
    close: vi.fn(async () => { calls.push('http'); }),
    ...(withPlugins ? { pluginManager: { shutdownAll: vi.fn(async () => { calls.push('plugins'); }) } } : {}),
  };
  return { server, calls, log };
}

describe('buildShutdownSteps', () => {
  it('PL1: closes http, then plugins (their resident browsers), then every engine browser', async () => {
    const { server, calls } = fakeServer();
    const steps = buildShutdownSteps(server, { closeAllBrowsers: async () => { calls.push('browsers'); } });
    for (const step of steps) await step.run();
    expect(calls).toEqual(['http', 'plugins', 'browsers']);
    expect(steps.every((s) => typeof s.timeoutMs === 'number')).toBe(true);
  });

  it('PL2: a server without a plugin manager still shuts down', async () => {
    const { server, calls } = fakeServer(false);
    const steps = buildShutdownSteps(server, { closeAllBrowsers: async () => { calls.push('browsers'); } });
    for (const step of steps) await step.run();
    expect(calls).toEqual(['http', 'browsers']);
  });
});

describe('installProcessLifecycle', () => {
  it('PL3: sweeps stale profiles at startup and logs what it did', async () => {
    const { server, log } = fakeServer();
    const sweep = vi.fn(async () => ({ removed: ['/tmp/a', '/tmp/b'], keptInUse: ['/tmp/c'], keptYoung: [], errors: [] }));
    const uninstall = installProcessLifecycle(server, { sweep, proc: new EventEmitter(), exit: vi.fn() });
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ removed: 2, keptInUse: 1 }),
      expect.stringMatching(/stale chromium profile/i),
    ));
    uninstall();
  });

  it('PL4: a failing sweep is logged, never thrown', async () => {
    const { server, log } = fakeServer();
    const uninstall = installProcessLifecycle(server, {
      sweep: async () => { throw new Error('EACCES'); },
      proc: new EventEmitter(),
      exit: vi.fn(),
    });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalled());
    uninstall();
  });

  it('PL5: SIGTERM on the process runs the steps and exits 0', async () => {
    const { server, calls } = fakeServer();
    const proc = new EventEmitter();
    const exit = vi.fn();
    const uninstall = installProcessLifecycle(server, {
      sweep: async () => ({ removed: [], keptInUse: [], keptYoung: [], errors: [] }),
      closeAllBrowsers: async () => { calls.push('browsers'); },
      proc,
      exit,
    });
    proc.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(calls).toEqual(['http', 'plugins', 'browsers']);
    uninstall();
  });
});
