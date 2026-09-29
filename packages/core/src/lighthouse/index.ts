/**
 * Lighthouse accessibility-testing engine — public entry point.
 *
 * Launches a local headless Chrome, runs Google Lighthouse's accessibility
 * category against the URL, and maps every FAILING audit to the shared `Issue`
 * shape (runner='lighthouse'). FREE / local only — no API keys, and the only
 * network access is Lighthouse loading the scanned page.
 *
 * Mirrors the behavioral engine's contract: NEVER throws. On launch / load
 * failure the result has `pagesChecked: 0` and a single error entry.
 *
 * Chrome discovery goes through the ONE shared resolver in
 * packages/core/src/browser/ (CHROMIUM-RESOLVE-1). Unlike the other engines
 * (which launch puppeteer directly), this engine hands the resolved path to
 * chrome-launcher via `chromePath` — a resolution failure now PROPAGATES as a
 * typed error instead of silently falling through to chrome-launcher's own
 * (different) discovery, per the owner's explicit requirement.
 */

import { createRequire } from 'node:module';
import type { Issue } from '../types.js';
import { resolveChromium } from '../browser/resolve.js';
import type { Browser, Page } from 'puppeteer';
import { CHROMIUM_LAUNCH_ARGS, withEgressProxyArgs } from '../browser/launch.js';
import { openEgressProxy, type EgressProxy } from '../net/egress-proxy.js';
import { loadPuppeteer } from '../browser/puppeteer-runtime.js';
import { guardPageRequests } from '../net/browser-request-guard.js';
import type { LighthouseOptions, LighthouseResult } from './types.js';
import { mapLighthouseAudits, type LhAudit } from './map.js';
import { createProfileDir, removeProfileDir } from '../browser/profile-dir.js';
import { trackLiveBrowser } from '../browser/live-registry.js';

export type { LighthouseOptions, LighthouseResult } from './types.js';
export { mapLighthouseAudits, AUDIT_WCAG_MAP, MAX_NODES_PER_AUDIT } from './map.js';

const DEFAULT_TIMEOUT = 60_000;

/** Minimal shape of the chrome-launcher module we depend on. */
interface ChromeLauncherModule {
  launch(opts: Record<string, unknown>): Promise<{
    port: number;
    kill(): Promise<void>;
  }>;
}

/** Minimal shape of the lighthouse default export we depend on. */
type LighthouseFn = (
  url: string,
  flags: Record<string, unknown>,
  config?: unknown,
  page?: Page,
) => Promise<{ lhr?: { audits?: Record<string, LhAudit> } } | undefined>;

let lighthousePromise: Promise<LighthouseFn> | undefined;
let chromeLauncherPromise: Promise<ChromeLauncherModule> | undefined;

/** Lazily load the lighthouse runtime (ESM default export). */
async function loadLighthouse(): Promise<LighthouseFn> {
  if (!lighthousePromise) {
    lighthousePromise = (async () => {
      const mod = (await import('lighthouse')) as unknown as {
        default?: LighthouseFn;
      } & LighthouseFn;
      return (mod.default ?? mod) as LighthouseFn;
    })();
  }
  return lighthousePromise;
}

/** Lazily load chrome-launcher (a lighthouse dependency). */
async function loadChromeLauncher(): Promise<ChromeLauncherModule> {
  if (!chromeLauncherPromise) {
    chromeLauncherPromise = (async () => {
      const require = createRequire(import.meta.url);
      let specifier = 'chrome-launcher';
      try {
        specifier = require.resolve('chrome-launcher');
      } catch {
        try {
          const lhRequire = createRequire(require.resolve('lighthouse/package.json'));
          specifier = lhRequire.resolve('chrome-launcher');
        } catch {
          // Leave bare specifier; import below surfaces a clear error.
        }
      }
      const mod = (await import(specifier)) as ChromeLauncherModule;
      return mod;
    })();
  }
  return chromeLauncherPromise;
}

/**
 * Build chrome-launcher options, merging caller overrides last — except the
 * egress-proxy flags (SCAN-EGRESS-PROXY-1), which are appended AFTER the merge
 * so no `chromeFlags` override can drop or replace them.
 *
 * PROFILE-CLEANUP-1: `userDataDir` is the luqen-owned profile dir unless the
 * caller configured its own.
 */
export function buildLaunchOptions(
  opts: LighthouseOptions,
  chromePath: string,
  proxy: Pick<EgressProxy, 'port'>,
  userDataDir?: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    chromeFlags: ['--headless=new', ...CHROMIUM_LAUNCH_ARGS],
    chromePath,
    ...(userDataDir !== undefined ? { userDataDir } : {}),
    ...(opts.chromeLaunchConfig ?? {}),
  };
  const flags = Array.isArray(merged['chromeFlags']) ? (merged['chromeFlags'] as unknown[]).map(String) : [];
  return { ...merged, chromeFlags: withEgressProxyArgs(flags, proxy) };
}

/**
 * Run Lighthouse's accessibility category against a single URL.
 *
 * Returns a {@link LighthouseResult}. Never throws: any launch / load / run
 * failure yields `pagesChecked: 0` and a single error entry.
 */
export async function runLighthouseChecks(
  url: string,
  opts: LighthouseOptions = {},
): Promise<LighthouseResult> {
  let chrome: { port: number; kill(): Promise<void> } | undefined;
  let controller: Browser | undefined;
  let proxy: EgressProxy | undefined;
  let profile: string | undefined;
  // A host shutting down mid-run kills this Chrome too (PROFILE-CLEANUP-1).
  const untrack = trackLiveBrowser(async () => {
    await chrome?.kill();
    await proxy?.close();
  });
  try {
    // Resolve BEFORE loading chrome-launcher: a resolution failure must
    // surface as our own typed error rather than silently falling through
    // to chrome-launcher's own (different) discovery.
    const configuredChromePath = (opts.chromeLaunchConfig?.['chromePath'] as string | undefined);
    const executablePath = configuredChromePath ?? (await resolveChromium()).executablePath;

    const launcher = await loadChromeLauncher();
    // SCAN-EGRESS-PROXY-1 — FAIL CLOSED: no proxy, no Chrome.
    proxy = await openEgressProxy(opts.guard ?? {});
    profile = opts.chromeLaunchConfig?.['userDataDir'] === undefined
      ? await createProfileDir().catch(() => undefined) // fall back to chrome-launcher's own tmp dir
      : undefined;
    chrome = await launcher.launch(buildLaunchOptions(opts, executablePath, proxy, profile));

    const lighthouse = await loadLighthouse();
    const flags: Record<string, unknown> = {
      port: chrome.port,
      output: 'json',
      logLevel: 'silent',
      onlyCategories: ['accessibility'],
      maxWaitForLoad: opts.timeout ?? DEFAULT_TIMEOUT,
      ...(opts.headers && Object.keys(opts.headers).length > 0
        ? { extraHeaders: { ...opts.headers } }
        : {}),
    };

    // ENGINE-SSRF-1: Lighthouse drives the page it is GIVEN (its documented
    // fourth argument), so attach puppeteer to the chrome-launcher instance,
    // open the page ourselves and install the request guard on it before
    // Lighthouse navigates. Without a page Lighthouse would open its own tab
    // with no interception at all.
    const puppeteer = await loadPuppeteer();
    controller = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
    const page = await controller.newPage();
    await guardPageRequests(page, opts.guard ?? {});

    const runnerResult = await lighthouse(url, flags, undefined, page);
    const audits = runnerResult?.lhr?.audits;
    const issues = mapLighthouseAudits(audits);
    return { issues, pagesChecked: 1, errors: [] };
  } catch (err) {
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  } finally {
    if (controller) {
      try {
        await controller.disconnect();
      } catch {
        // Never let teardown failures mask the real result / error.
      }
    }
    if (chrome) {
      try {
        await chrome.kill();
      } catch {
        // Never let teardown failures mask the real result / error.
      }
    }
    await proxy?.close();
    untrack();
    // chrome.kill() SIGKILLs the process group, so nothing still writes here.
    if (profile !== undefined) await removeProfileDir(profile, null);
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
