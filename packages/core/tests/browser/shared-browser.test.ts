/**
 * DEEP-SCAN-BROWSER-REUSE-1 — the per-scan shared Chromium (browser/shared-browser.ts).
 *
 * Hermetic: the launcher is a fake, so these tests prove the LIFECYCLE rules
 * (one launch, a fresh isolated context per lease, relaunch on disconnect,
 * deterministic teardown). The real-browser proof that a shared browser keeps
 * the egress proxy and the page guard, and that contexts do not leak storage,
 * lives in tests/behavioral/shared-browser-real.test.ts and
 * tests/behavioral/egress-proxy-browser.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Browser } from 'puppeteer';
import { createSharedBrowser } from '../../src/browser/shared-browser.js';

interface FakeContext { readonly id: number; closed: boolean; readonly pages: FakePage[] }
interface FakePage { readonly contextId: number }

class FakeBrowser extends EventEmitter {
  connected = true;
  closed = false;
  readonly contexts: FakeContext[] = [];
  failNextContext = false;
  async createBrowserContext(): Promise<unknown> {
    if (!this.connected) throw new Error('Protocol error: Target closed');
    if (this.failNextContext) {
      this.failNextContext = false;
      throw new Error('context refused');
    }
    const ctx: FakeContext = { id: this.contexts.length, closed: false, pages: [] };
    this.contexts.push(ctx);
    return {
      newPage: async () => {
        if (ctx.closed) throw new Error('context closed');
        const page: FakePage = { contextId: ctx.id };
        ctx.pages.push(page);
        return page;
      },
      close: async () => { ctx.closed = true; },
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.crash();
  }
  /** A browser-process crash: disconnect without close(). */
  crash(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit('disconnected');
  }
}

function fakeLauncher() {
  const browsers: FakeBrowser[] = [];
  const launch = vi.fn(async (_overrides: unknown) => {
    const b = new FakeBrowser();
    browsers.push(b);
    return b as unknown as Browser;
  });
  return { launch, browsers };
}

const GUARD = { allowPrivate: false } as const;

describe('createSharedBrowser (DEEP-SCAN-BROWSER-REUSE-1)', () => {
  it('SB1: N leases cause exactly ONE launch, lazily, with the scan guard', async () => {
    const { launch } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    expect(launch).not.toHaveBeenCalled();
    const leases = [];
    for (let i = 0; i < 6; i++) leases.push(await shared.acquire());
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0][0]).toMatchObject({ guard: GUARD });
    expect(shared.launchCount()).toBe(1);
    for (const l of leases) await l.release();
    await shared.close();
  });

  it('SB2: concurrent first leases share one in-flight launch', async () => {
    const { launch } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    const leases = await Promise.all([shared.acquire(), shared.acquire(), shared.acquire(), shared.acquire(), shared.acquire()]);
    expect(launch).toHaveBeenCalledTimes(1);
    await Promise.all(leases.map((l) => l.release()));
    await shared.close();
  });

  it('SB3: every lease gets its OWN fresh browser context and page', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    const a = await shared.acquire();
    const b = await shared.acquire();
    const pageA = a.page as unknown as FakePage;
    const pageB = b.page as unknown as FakePage;
    expect(pageA).not.toBe(pageB);
    expect(pageA.contextId).not.toBe(pageB.contextId);
    expect(browsers[0].contexts).toHaveLength(2);
    for (const ctx of browsers[0].contexts) expect(ctx.pages).toHaveLength(1);
    await a.release();
    await b.release();
    await shared.close();
  });

  it('SB4: release closes the lease context, is idempotent, and leaves the browser up', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    const lease = await shared.acquire();
    await lease.release();
    await lease.release();
    expect(browsers[0].contexts[0].closed).toBe(true);
    expect(browsers[0].closed).toBe(false);
    await shared.close();
  });

  it('SB5: a crashed (disconnected) browser is relaunched for the next lease; earlier leases are unaffected', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    const first = await shared.acquire();
    await first.release();
    browsers[0].crash();
    const second = await shared.acquire();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(second.browser).toBe(browsers[1]);
    // A disconnect the event has not been delivered for yet is also caught.
    browsers[1].connected = false;
    const third = await shared.acquire();
    expect(launch).toHaveBeenCalledTimes(3);
    expect(third.browser).toBe(browsers[2]);
    await second.release();
    await third.release();
    await shared.close();
  });

  it('SB6: a browser that dies between the liveness check and the context call is relaunched once', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    (await shared.acquire()).release();
    const orig = browsers[0].createBrowserContext.bind(browsers[0]);
    browsers[0].createBrowserContext = async () => {
      browsers[0].crash();
      return orig();
    };
    const lease = await shared.acquire();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(lease.browser).toBe(browsers[1]);
    await shared.close();
  });

  it('SB7: a context error on a LIVE browser propagates (no relaunch loop)', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    (await shared.acquire()).release();
    browsers[0].failNextContext = true;
    await expect(shared.acquire()).rejects.toThrow('context refused');
    expect(launch).toHaveBeenCalledTimes(1);
    await shared.close();
  });

  it('SB8: a failed launch propagates and the NEXT lease tries a fresh launch', async () => {
    const { launch } = fakeLauncher();
    launch.mockRejectedValueOnce(new Error('no chromium'));
    const shared = createSharedBrowser(GUARD, { launch });
    await expect(shared.acquire()).rejects.toThrow('no chromium');
    const lease = await shared.acquire();
    expect(launch).toHaveBeenCalledTimes(2);
    await lease.release();
    await shared.close();
  });

  it('SB9: close() closes the browser and every context still open; later leases are refused', async () => {
    const { launch, browsers } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch });
    await shared.acquire(); // never released — close() must still clean up
    await shared.close();
    expect(browsers[0].contexts[0].closed).toBe(true);
    expect(browsers[0].closed).toBe(true);
    await expect(shared.acquire()).rejects.toThrow(/closed/);
    await shared.close(); // idempotent
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('SB10: close() while the launch is still in flight closes the browser it produced', async () => {
    let finish!: (b: Browser) => void;
    const b = new FakeBrowser();
    const launch = vi.fn(() => new Promise<Browser>((resolve) => { finish = resolve; }));
    const shared = createSharedBrowser(GUARD, { launch });
    const pending = shared.acquire();
    const closing = shared.close();
    finish(b as unknown as Browser);
    await closing;
    await expect(pending).rejects.toThrow(/closed/);
    expect(b.closed).toBe(true);
  });

  it('SB11: launch overrides are forwarded, but the guard always comes from the shared browser', async () => {
    const { launch } = fakeLauncher();
    const shared = createSharedBrowser(GUARD, { launch, launchOverrides: { args: ['--x'], guard: { allowPrivate: true } } });
    await (await shared.acquire()).release();
    expect(launch.mock.calls[0][0]).toEqual({ args: ['--x'], guard: GUARD });
    expect(shared.guard).toBe(GUARD);
    await shared.close();
  });
});
