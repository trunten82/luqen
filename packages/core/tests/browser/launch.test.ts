import { describe, it, expect, vi } from 'vitest';
import { launchChromium, safeCloseBrowser, egressProxyOf, CHROMIUM_LAUNCH_ARGS } from '../../src/browser/launch.js';
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
