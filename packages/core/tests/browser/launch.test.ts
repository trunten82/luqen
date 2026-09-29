import { describe, it, expect, vi, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchChromium,
  safeCloseBrowser,
  egressProxyOf,
  closeAllBrowsers,
  liveBrowserCount,
  CHROMIUM_LAUNCH_ARGS,
} from '../../src/browser/launch.js';
import { ChromiumNotFoundError } from '../../src/browser/resolve.js';
import { EgressProxyUnavailableError, type EgressProxy } from '../../src/net/egress-proxy.js';

function fakePuppeteer() {
  return { launch: vi.fn().mockResolvedValue({ close: vi.fn() }) };
}

/** A stand-in proxy (no socket) so these unit tests stay hermetic. */
function fakeProxy(overrides: Partial<{ listening: boolean; port: number }> = {}): EgressProxy & { closed: boolean } {
  const proxy = {
    port: overrides.port ?? 4321,
    url: `http://127.0.0.1:${overrides.port ?? 4321}`,
    listening: overrides.listening ?? true,
    closed: false,
    activeConnections: () => 0,
    async close() { proxy.closed = true; proxy.listening = false; },
  };
  return proxy;
}

const PROXY_FLAGS = ['--proxy-server=http://127.0.0.1:4321', '--proxy-bypass-list=<-loopback>'];

// Tests that never close their browser still must not leave profile dirs behind.
afterAll(async () => { await closeAllBrowsers(); });

describe('launchChromium', () => {
  it('LC1: launch passes the resolved executable and the no-sandbox flags', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => fakeProxy() });
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    const options = puppeteer.launch.mock.calls[0][0] as { executablePath: string; args: string[]; headless: boolean };
    expect(options.executablePath).toBe('/resolved/chrome');
    expect(options.args).toContain('--no-sandbox');
    expect(options.args).toContain('--disable-setuid-sandbox');
    expect(options.args).toContain('--disable-dev-shm-usage');
    expect(options.headless).toBe(true);
  });

  it('LC2: caller overrides are merged last — except the egress-proxy flags, which always follow', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({ headless: false, args: ['--custom-flag'] }, { puppeteer, resolve, startEgressProxy: async () => fakeProxy() });
    const options = puppeteer.launch.mock.calls[0][0] as { headless: boolean; args: string[] };
    expect(options.headless).toBe(false);
    expect(options.args).toEqual(['--custom-flag', ...PROXY_FLAGS]);
  });

  it('LC3: an explicit executablePath override skips resolution', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockResolvedValue({ executablePath: '/resolved/chrome' });
    await launchChromium({ executablePath: '/manual/chrome' }, { puppeteer, resolve, startEgressProxy: async () => fakeProxy() });
    expect(resolve).not.toHaveBeenCalled();
    const options = puppeteer.launch.mock.calls[0][0] as { executablePath: string };
    expect(options.executablePath).toBe('/manual/chrome');
  });

  it('LC4: an unresolvable browser rejects with ChromiumNotFoundError and never calls launch', async () => {
    const puppeteer = fakePuppeteer();
    const resolve = vi.fn().mockRejectedValue(new ChromiumNotFoundError(['/a', '/b']));
    await expect(launchChromium({}, { puppeteer, resolve })).rejects.toBeInstanceOf(ChromiumNotFoundError);
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('exports the shared launch args as a stable tuple', () => {
    expect(CHROMIUM_LAUNCH_ARGS).toEqual(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']);
  });
});

describe('launchChromium — egress proxy (SCAN-EGRESS-PROXY-1)', () => {
  const resolve = async () => ({ executablePath: '/resolved/chrome' });

  it('EP1: every launch carries --proxy-server and --proxy-bypass-list=<-loopback> for its own proxy', async () => {
    const puppeteer = fakePuppeteer();
    await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => fakeProxy() });
    const options = puppeteer.launch.mock.calls[0][0] as { args: string[] };
    expect(options.args).toEqual([...CHROMIUM_LAUNCH_ARGS, ...PROXY_FLAGS]);
  });

  it('EP2: a caller cannot replace or disable the proxy through args', async () => {
    const puppeteer = fakePuppeteer();
    await launchChromium(
      { args: ['--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*', '--proxy-pac-url=http://x/p.pac', '--keep'] },
      { puppeteer, resolve, startEgressProxy: async () => fakeProxy() },
    );
    const options = puppeteer.launch.mock.calls[0][0] as { args: string[] };
    expect(options.args).toEqual(['--keep', ...PROXY_FLAGS]);
  });

  it('EP3: the guard goes to the proxy, never to puppeteer', async () => {
    const puppeteer = fakePuppeteer();
    const start = vi.fn(async () => fakeProxy());
    const guard = { allowPrivate: true };
    await launchChromium({ guard }, { puppeteer, resolve, startEgressProxy: start });
    expect(start).toHaveBeenCalledWith(guard);
    expect(puppeteer.launch.mock.calls[0][0]).not.toHaveProperty('guard');
  });

  it('EP4: no guard means the strict policy', async () => {
    const start = vi.fn(async () => fakeProxy());
    await launchChromium({}, { puppeteer: fakePuppeteer(), resolve, startEgressProxy: start });
    expect(start).toHaveBeenCalledWith({});
  });

  it('EP5 [fail-closed]: a proxy that cannot start means Chromium is never launched', async () => {
    const puppeteer = fakePuppeteer();
    await expect(launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => { throw new Error('EADDRINUSE'); } }))
      .rejects.toBeInstanceOf(EgressProxyUnavailableError);
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('EP6 [fail-closed]: a proxy that is not listening means Chromium is never launched', async () => {
    const puppeteer = fakePuppeteer();
    const dead = fakeProxy({ listening: false });
    await expect(launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => dead }))
      .rejects.toThrow(/egress proxy unavailable.*not listening/i);
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(dead.closed).toBe(true);
  });

  it('EP7: a failed launch closes the proxy it opened', async () => {
    const proxy = fakeProxy();
    const puppeteer = { launch: vi.fn().mockRejectedValue(new Error('spawn failed')) };
    await expect(launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => proxy })).rejects.toThrow('spawn failed');
    expect(proxy.closed).toBe(true);
  });

  it('EP8: the browser is bound to its proxy, and closing the browser closes it', async () => {
    const proxy = fakeProxy();
    const browser = await launchChromium({}, { puppeteer: fakePuppeteer(), resolve, startEgressProxy: async () => proxy });
    expect(egressProxyOf(browser)).toBe(proxy);
    await safeCloseBrowser(browser);
    expect(proxy.closed).toBe(true);
  });

  it('EP9: a real proxy is started by default and bound to 127.0.0.1', async () => {
    const puppeteer = fakePuppeteer();
    const browser = await launchChromium({}, { puppeteer, resolve });
    const proxy = egressProxyOf(browser);
    expect(proxy?.listening).toBe(true);
    const options = puppeteer.launch.mock.calls[0][0] as { args: string[] };
    expect(options.args).toContain(`--proxy-server=http://127.0.0.1:${proxy?.port}`);
    await safeCloseBrowser(browser);
    expect(proxy?.listening).toBe(false);
  });

  it('exports the shared launch args (unchanged by the proxy)', () => {
    expect(CHROMIUM_LAUNCH_ARGS).toEqual(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']);
  });
});

/** A puppeteer-shaped browser whose process can exit and whose connection can drop. */
function fakeBrowser() {
  const proc = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null });
  const browser = Object.assign(new EventEmitter(), {
    proc,
    process: () => proc,
    /** Crash-style death: the process dies and the connection drops, nobody calls close(). */
    crash(): void {
      proc.signalCode = 'SIGKILL';
      proc.emit('exit', null, 'SIGKILL');
      browser.emit('disconnected');
    },
    close: vi.fn(async () => {
      proc.exitCode = 0;
      proc.emit('exit', 0, null);
      browser.emit('disconnected');
    }),
  });
  return browser;
}

function launchedDir(puppeteer: { launch: { mock: { calls: unknown[][] } } }): string {
  return (puppeteer.launch.mock.calls[0][0] as { userDataDir: string }).userDataDir;
}

/** Wait (bounded) for an async, event-driven removal to land. */
async function eventually(check: () => boolean, ms = 2000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return check();
}

describe('launchChromium — per-launch profile dir (PROFILE-CLEANUP-1)', () => {
  const resolve = async () => ({ executablePath: '/resolved/chrome' });
  const root = mkdtempSync(join(tmpdir(), 'luqen-launch-profile-'));
  afterAll(async () => {
    await closeAllBrowsers();
    rmSync(root, { recursive: true, force: true });
  });

  it('PR1: every launch gets its own profile dir under the luqen-owned root, removed on close', async () => {
    const b = fakeBrowser();
    const puppeteer = { launch: vi.fn().mockResolvedValue(b) };
    const browser = await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => fakeProxy(), profileRoot: root });
    const dir = launchedDir(puppeteer);
    expect(dir.startsWith(root + '/')).toBe(true);
    expect(existsSync(dir)).toBe(true);
    writeFileSync(join(dir, 'Local State'), '{}'); // the browser populated it
    await safeCloseBrowser(browser);
    expect(existsSync(dir)).toBe(false);
  });

  it('PR2 [crash]: a browser that dies without close() still has its profile removed', async () => {
    const b = fakeBrowser();
    const puppeteer = { launch: vi.fn().mockResolvedValue(b) };
    await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => fakeProxy(), profileRoot: root });
    const dir = launchedDir(puppeteer);
    writeFileSync(join(dir, 'Local State'), '{}');
    b.crash();
    expect(await eventually(() => !existsSync(dir))).toBe(true);
    expect(b.close).not.toHaveBeenCalled();
  });

  it('PR3: a caller-owned userDataDir is used as given and never deleted', async () => {
    const own = mkdtempSync(join(root, 'caller-'));
    const b = fakeBrowser();
    const puppeteer = { launch: vi.fn().mockResolvedValue(b) };
    const browser = await launchChromium({ userDataDir: own }, { puppeteer, resolve, startEgressProxy: async () => fakeProxy(), profileRoot: root });
    expect(launchedDir(puppeteer)).toBe(own);
    await safeCloseBrowser(browser);
    expect(existsSync(own)).toBe(true);
  });

  it('PR4: a failed launch removes the profile dir it created', async () => {
    const puppeteer = { launch: vi.fn().mockRejectedValue(new Error('spawn failed')) };
    await expect(launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => fakeProxy(), profileRoot: root }))
      .rejects.toThrow('spawn failed');
    expect(existsSync(launchedDir(puppeteer))).toBe(false);
  });

  it('PR5: closeAllBrowsers closes every live browser, its proxy and its profile', async () => {
    const b1 = fakeBrowser();
    const b2 = fakeBrowser();
    const p1 = fakeProxy();
    const p2 = fakeProxy();
    const puppeteer = { launch: vi.fn().mockResolvedValueOnce(b1).mockResolvedValueOnce(b2) };
    await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => p1, profileRoot: root });
    await launchChromium({}, { puppeteer, resolve, startEgressProxy: async () => p2, profileRoot: root });
    const dirs = puppeteer.launch.mock.calls.map((c) => (c[0] as { userDataDir: string }).userDataDir);
    expect(liveBrowserCount()).toBeGreaterThanOrEqual(2);
    await closeAllBrowsers();
    expect(b1.close).toHaveBeenCalled();
    expect(b2.close).toHaveBeenCalled();
    expect(p1.closed && p2.closed).toBe(true);
    expect(dirs.map((d) => existsSync(d))).toEqual([false, false]);
    expect(liveBrowserCount()).toBe(0);
  });
});
