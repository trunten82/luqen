/**
 * DEEP-SCAN-BROWSER-REUSE-1 — ONE Chromium per deep scan, shared by every
 * browser engine (pa11y, behavioral/vision, Lighthouse, IBM, reflow,
 * a11y-tree) instead of each engine launching its own for every page.
 *
 * Launch: lazily, on the first lease, through {@link launchChromium} — so the
 * shared browser keeps everything a per-engine launch had: the resolver, the
 * fail-closed egress proxy enforcing the scan's guard (SCAN-EGRESS-PROXY-1),
 * its own removable profile dir and the live registry (PROFILE-CLEANUP-1).
 * The guard is fixed at construction; caller launch overrides cannot replace it.
 *
 * Isolation: every lease is a FRESH browser context (`createBrowserContext`,
 * Chromium's incognito-style context) with one new page. Contexts do not share
 * cookies, localStorage/sessionStorage, IndexedDB, cache, service workers or
 * permission grants, and emulation (viewport, headers) is per page — so no
 * engine can see state another engine's page load left behind. Releasing a
 * lease closes its context. The egress proxy is a browser-level flag, so it
 * applies to every context; the page-level request guard is installed by each
 * engine on its leased page, exactly as on its own page before.
 *
 * Crashes: a disconnected browser is dropped and the NEXT lease relaunches it,
 * so an engine that crashes Chromium costs only the engines running on it at
 * that moment. {@link SharedBrowser.close} closes the browser (and with it
 * every context still open) and refuses further leases; it never throws.
 */

import type { Browser, BrowserContext, Page } from 'puppeteer';
import { launchChromium, safeCloseBrowser, type LaunchChromiumOverrides } from './launch.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

export interface EngineLease {
  /** A new page in the lease's own fresh browser context. */
  readonly page: Page;
  readonly browser: Browser;
  /** Close the lease's context (and its page). Idempotent; never throws. */
  release(): Promise<void>;
}

export interface SharedBrowser {
  /** The guard the shared browser's egress proxy enforces. */
  readonly guard: NetworkGuardPolicy;
  /** Lease a fresh isolated context + page, launching or relaunching the browser if needed. */
  acquire(): Promise<EngineLease>;
  /** Close the browser and refuse further leases. Idempotent; never throws. */
  close(): Promise<void>;
  /** How many times a browser was launched (1 unless it crashed or failed to launch). */
  launchCount(): number;
}

export interface SharedBrowserDeps {
  /** Launcher seam (tests); defaults to {@link launchChromium}. */
  readonly launch?: (overrides: LaunchChromiumOverrides) => Promise<Browser>;
  /** Extra launch overrides (e.g. Chromium args). Their `guard`, if any, is ignored. */
  readonly launchOverrides?: LaunchChromiumOverrides;
}

type Disconnectable = { once?: (event: string, fn: () => void) => unknown };

async function closeQuietly(target: { close(): Promise<void> }): Promise<void> {
  try {
    await target.close();
  } catch {
    // A context on a dead browser cannot be closed and needs no closing.
  }
}

/** Create the per-scan shared browser. Nothing launches until the first lease. */
export function createSharedBrowser(
  guard: NetworkGuardPolicy,
  deps: SharedBrowserDeps = {},
): SharedBrowser {
  const launch = deps.launch ?? ((overrides: LaunchChromiumOverrides) => launchChromium(overrides));
  const { guard: _ignored, ...launchOverrides } = deps.launchOverrides ?? {};
  let current: Promise<Browser> | undefined;
  let closed = false;
  let launches = 0;
  const openContexts = new Set<BrowserContext>();

  function startLaunch(): Promise<Browser> {
    launches += 1;
    const pending = launch({ ...launchOverrides, guard });
    current = pending;
    pending.then(
      (browser) => {
        (browser as unknown as Disconnectable).once?.('disconnected', () => {
          if (current === pending) current = undefined;
        });
      },
      () => {
        if (current === pending) current = undefined;
      },
    );
    return pending;
  }

  async function liveBrowser(): Promise<Browser> {
    const existing = current;
    if (existing) {
      const browser = await existing;
      if (browser.connected) return browser;
      if (current === existing) current = undefined;
    }
    if (closed) throw new Error('Shared browser is closed');
    return current ?? startLaunch();
  }

  async function assertOpen(browser: Browser): Promise<void> {
    if (!closed) return;
    // close() raced this launch: it owns nothing it has not seen, so close here.
    await safeCloseBrowser(browser);
    throw new Error('Shared browser is closed');
  }

  async function newContext(): Promise<{ browser: Browser; context: BrowserContext }> {
    let browser = await liveBrowser();
    await assertOpen(browser);
    try {
      return { browser, context: await browser.createBrowserContext() };
    } catch (err) {
      if (browser.connected) throw err;
      // It died between the liveness check and the call: relaunch ONCE.
      browser = await liveBrowser();
      await assertOpen(browser);
      return { browser, context: await browser.createBrowserContext() };
    }
  }

  return {
    guard,
    async acquire(): Promise<EngineLease> {
      if (closed) throw new Error('Shared browser is closed');
      const { browser, context } = await newContext();
      openContexts.add(context);
      let released = false;
      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        openContexts.delete(context);
        await closeQuietly(context);
      };
      let page: Page;
      try {
        page = await context.newPage();
      } catch (err) {
        await release();
        throw err;
      }
      return { page, browser, release };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const pending = current;
      current = undefined;
      const contexts = [...openContexts];
      openContexts.clear();
      await Promise.all(contexts.map(closeQuietly));
      if (!pending) return;
      const browser = await pending.catch(() => undefined);
      if (browser) await safeCloseBrowser(browser);
    },
    launchCount: () => launches,
  };
}

/** What an engine needs to open its page: a shared browser, or its own launch config. */
export interface EnginePageSource {
  readonly sharedBrowser?: SharedBrowser;
  readonly guard?: NetworkGuardPolicy;
  readonly chromeLaunchConfig?: Record<string, unknown>;
}

export interface EnginePage {
  readonly page: Page;
  readonly browser: Browser;
  /** Release the lease (shared) or close the engine's own browser. Never throws. */
  dispose(): Promise<void>;
}

/**
 * Open the page an engine works on. With a shared browser: a lease (fresh
 * context + page; `chromeLaunchConfig` is ignored, as pa11y ignores its own
 * launch config when handed a browser). Without: the engine's own browser via
 * {@link launchChromium}, exactly as before.
 */
export async function openEnginePage(
  source: EnginePageSource,
  launchOverrides: LaunchChromiumOverrides = {},
): Promise<EnginePage> {
  if (source.sharedBrowser) {
    const lease = await source.sharedBrowser.acquire();
    return { page: lease.page, browser: lease.browser, dispose: () => lease.release() };
  }
  const browser = await launchChromium({ ...source.chromeLaunchConfig, ...launchOverrides, guard: source.guard ?? {} }); // SCAN-EGRESS-PROXY-1
  let page: Page;
  try {
    page = await browser.newPage();
  } catch (err) {
    await safeCloseBrowser(browser);
    throw err;
  }
  return { page, browser, dispose: () => safeCloseBrowser(browser) };
}
