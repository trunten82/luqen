/**
 * The ONE puppeteer `.launch()` call site for every browser-launching engine
 * in packages/*\/src (CHROMIUM-RESOLVE-1). Resolves the executable through
 * {@link resolveChromium} — a resolution failure PROPAGATES as
 * {@link ChromiumNotFoundError} and `puppeteer.launch()` is never called, so
 * there is no silent fall-through to puppeteer's own (often wrong) default
 * lookup.
 *
 * SCAN-EGRESS-PROXY-1: every browser launched here gets its OWN filtering
 * egress proxy (net/egress-proxy.ts) enforcing the caller's guard policy, and
 * `--proxy-server` / `--proxy-bypass-list=<-loopback>` pointing at it. The
 * proxy is opened and proven listening BEFORE `puppeteer.launch()`; if it
 * cannot be, launch throws {@link EgressProxyUnavailableError} and Chromium is
 * never started. Caller-supplied proxy flags are dropped, so no override can
 * route around it. The proxy is closed with the browser.
 */

import type { Browser, PuppeteerNode } from 'puppeteer';
import { loadPuppeteer } from './puppeteer-runtime.js';
import { resolveChromium, type ResolveChromiumDeps } from './resolve.js';
import {
  egressProxyArgs,
  openEgressProxy,
  startEgressProxy,
  type EgressProxy,
  type EgressProxyStarter,
} from '../net/egress-proxy.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

/**
 * `--no-sandbox` / `--disable-setuid-sandbox` are essential when running as
 * root (the live server) — without them Chrome refuses to start.
 */
export const CHROMIUM_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
] as const;

export interface LaunchChromiumDeps {
  readonly puppeteer?: Pick<PuppeteerNode, 'launch'>;
  readonly resolve?: (deps?: ResolveChromiumDeps) => Promise<{ readonly executablePath: string }>;
  /** Egress-proxy seam (tests); defaults to {@link startEgressProxy}. */
  readonly startEgressProxy?: EgressProxyStarter;
}

export interface LaunchChromiumOverrides {
  readonly executablePath?: string;
  readonly headless?: boolean;
  readonly args?: readonly string[];
  /**
   * SSRF guard the browser's egress proxy enforces (SCAN-EGRESS-PROXY-1).
   * Default `{}` = strict. Never passed to puppeteer.
   */
  readonly guard?: NetworkGuardPolicy;
  readonly [key: string]: unknown;
}

/** Chromium switches that would change or disable the egress proxy. */
const PROXY_SWITCH = /^--(no-proxy-server|proxy-server|proxy-bypass-list|proxy-pac-url|proxy-auto-detect|winhttp-proxy-resolver)(=|$)/;

/** Caller args with every proxy switch removed, then the egress proxy's own. */
export function withEgressProxyArgs(args: readonly string[], proxy: Pick<EgressProxy, 'port'>): string[] {
  return [...args.filter((arg) => !PROXY_SWITCH.test(arg)), ...egressProxyArgs(proxy)];
}

const browserProxies = new WeakMap<object, EgressProxy>();

/** The egress proxy a browser from {@link launchChromium} is bound to. */
export function egressProxyOf(browser: object): EgressProxy | undefined {
  return browserProxies.get(browser);
}

/**
 * Launch a Chromium browser through the shared resolver. An explicit
 * `overrides.executablePath` skips resolution entirely (used by callers that
 * already resolved once and want to avoid a second lookup).
 */
export async function launchChromium(
  overrides: LaunchChromiumOverrides = {},
  deps: LaunchChromiumDeps = {},
): Promise<Browser> {
  const puppeteer = deps.puppeteer ?? (await loadPuppeteer());
  const resolve = deps.resolve ?? resolveChromium;

  let executablePath = overrides.executablePath;
  if (!executablePath) {
    const resolved = await resolve();
    executablePath = resolved.executablePath;
  }

  const { guard, ...launchOverrides } = overrides;
  // FAIL CLOSED: throws EgressProxyUnavailableError before any launch.
  const proxy = await openEgressProxy(guard ?? {}, deps.startEgressProxy ?? startEgressProxy);

  const options = {
    headless: true, // MEASURED equivalent to 'new' in puppeteer-core 25.1.0
    executablePath,
    ...launchOverrides,
    args: withEgressProxyArgs(launchOverrides.args ?? CHROMIUM_LAUNCH_ARGS, proxy),
  };

  let browser: Browser;
  try {
    browser = (await puppeteer.launch(options as Parameters<PuppeteerNode['launch']>[0])) as Browser;
  } catch (err) {
    await proxy.close();
    throw err;
  }
  browserProxies.set(browser, proxy);
  // A crashed or externally closed browser must not leave its proxy behind.
  (browser as { once?: (event: string, fn: () => void) => unknown }).once?.('disconnected', () => {
    void proxy.close();
  });
  return browser;
}

/** Close a browser without throwing (best-effort teardown). */
export async function safeCloseBrowser(browser: Browser | undefined | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Never let teardown failures mask the real result / error.
  }
  await browserProxies.get(browser)?.close();
}
