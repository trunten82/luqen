/**
 * Accessibility-tree engine — public entry point.
 *
 * Loads a page in a locally-launched headless Chrome and inspects it through the
 * Chrome DevTools Protocol accessibility tree (`Accessibility.getFullAXTree`) —
 * the computed tree assistive technology consumes — to find:
 *   - interactive nodes with NO accessible name (WCAG 4.1.2), and
 *   - elements with a positive tabindex that distorts focus order (WCAG 2.4.3).
 * Findings map to the shared `Issue` shape (runner='a11y-tree').
 *
 * FREE / local only — drives the puppeteer Chrome bundled transitively with
 * pa11y; the only network access is loading the scanned page.
 *
 * Mirrors the reflow / IBM / Lighthouse engines' contract: NEVER throws. On any
 * launch / load / run failure the result has `pagesChecked: 0` and a single
 * error entry.
 *
 * Browser launch: the box runs services as ROOT, so Chrome MUST be launched
 * with `--no-sandbox --disable-setuid-sandbox` — exactly the requirement that,
 * when missed, silently killed the IBM engine. Chrome discovery reuses the same
 * strategy as the reflow / behavioral / Lighthouse / IBM engines.
 */

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Browser, CDPSession, Page, PuppeteerNode } from 'puppeteer';
import type { A11yTreeOptions, A11yTreeResult } from './types.js';
import { mapA11yTreeObservations, type A11yTreeObservation } from './map.js';

export type { A11yTreeOptions, A11yTreeResult } from './types.js';
export {
  mapA11yTreeObservations,
  KIND_MAP,
  MAX_ISSUES,
  type A11yTreeObservation,
  type A11yTreeObservationKind,
} from './map.js';

const DEFAULT_TIMEOUT = 60_000;
/** Cap on missing-name findings emitted from one page. */
const MAX_NAME_FINDINGS = 100;
/** Cap on positive-tabindex findings emitted from one page. */
const MAX_TABINDEX_FINDINGS = 50;

/**
 * ARIA roles that REQUIRE an accessible name. Conservative set — interactive
 * controls + images — to keep the missing-name check low-false-positive. A
 * non-`ignored` AX node with one of these roles and an empty computed name is a
 * genuine WCAG 4.1.2 gap.
 */
const ROLES_REQUIRING_NAME: ReadonlySet<string> = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'image',
]);

/** Lazily-loaded puppeteer runtime (resolved through pa11y). */
let puppeteerPromise: Promise<PuppeteerNode> | undefined;

/**
 * Load the puppeteer runtime. Resolves the module through pa11y (the package
 * that actually depends on puppeteer), falling back to a bare specifier in case
 * puppeteer is hoisted to the top level. Mirrors the reflow / IBM helpers.
 */
async function loadPuppeteer(): Promise<PuppeteerNode> {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      const require = createRequire(import.meta.url);
      let specifier = 'puppeteer';
      try {
        specifier = require.resolve('puppeteer');
      } catch {
        try {
          const pa11yRequire = createRequire(require.resolve('pa11y/package.json'));
          specifier = pa11yRequire.resolve('puppeteer');
        } catch {
          // Leave the bare specifier; the import below surfaces a clear error.
        }
      }
      const mod = (await import(specifier)) as { default?: PuppeteerNode } & PuppeteerNode;
      return (mod.default ?? mod) as PuppeteerNode;
    })();
  }
  return puppeteerPromise;
}

/** Scan a puppeteer-style chrome cache dir for an installed chrome binary. */
function findChromeInCache(cacheRoot: string): string | undefined {
  try {
    const chromeDir = join(cacheRoot, 'chrome');
    if (!existsSync(chromeDir)) return undefined;
    for (const entry of readdirSync(chromeDir)) {
      const candidate = join(chromeDir, entry, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Ignore — fall through to other discovery strategies.
  }
  return undefined;
}

/** Scan a playwright cache dir for an installed chromium binary. */
function findPlaywrightChromium(): string | undefined {
  const root = join(process.env['HOME'] ?? '/root', '.cache', 'ms-playwright');
  try {
    if (!existsSync(root)) return undefined;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      const candidate = join(root, entry, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Ignore.
  }
  return undefined;
}

/**
 * Find a Chromium/Chrome executable. Prefers an explicit env override and
 * system binaries, then puppeteer's own download cache, then a playwright
 * chromium. Returns undefined when nothing is found on disk.
 */
function findChromiumExecutable(): string | undefined {
  const explicit = [
    process.env['PUPPETEER_EXECUTABLE_PATH'],
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of explicit) {
    if (p && existsSync(p)) return p;
  }
  const home = process.env['HOME'] ?? '/root';
  return findChromeInCache(join(home, '.cache', 'puppeteer')) ?? findPlaywrightChromium();
}

/**
 * Resolve the chromium executable: explicit env / system binaries / cache
 * scans, then puppeteer's OWN resolver (`executablePath()`). Returns undefined
 * to let puppeteer.launch() use its built-in default.
 */
function resolveExecutablePath(puppeteer: PuppeteerNode): string | undefined {
  const explicit = findChromiumExecutable();
  if (explicit) return explicit;
  try {
    const own = puppeteer.executablePath();
    if (own && existsSync(own)) return own;
  } catch {
    // executablePath can throw if no browser is configured — fall through.
  }
  return undefined;
}

/**
 * Build the puppeteer launch options, merging caller overrides last. The
 * `--no-sandbox` / `--disable-setuid-sandbox` flags are essential when running
 * as root (the live server) — without them Chrome refuses to start.
 */
function buildLaunchOptions(
  puppeteer: PuppeteerNode,
  opts: A11yTreeOptions,
): Record<string, unknown> {
  const executablePath = resolveExecutablePath(puppeteer);
  return {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
    ...(opts.chromeLaunchConfig ?? {}),
  };
}

/** Close a browser without throwing (best-effort teardown). */
async function safeCloseBrowser(browser: Browser | undefined): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Never let teardown failures mask the real result / error.
  }
}

/** Build a compact CSS-ish selector from a CDP DOM node's attributes. */
function selectorFromNode(node: { localName?: string; nodeName?: string; attributes?: string[] }): string {
  const tag = (node.localName || node.nodeName || 'html').toLowerCase();
  const attrs = node.attributes ?? [];
  let id: string | undefined;
  let className: string | undefined;
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    if (attrs[i] === 'id') id = attrs[i + 1];
    else if (attrs[i] === 'class') className = attrs[i + 1];
  }
  if (id) return `${tag}#${id}`;
  if (className) {
    const classes = className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    if (classes) return `${tag}.${classes}`;
  }
  return tag;
}

/** Read a CDP AXValue's value as a trimmed string ('' when absent/non-string). */
function axStringValue(v: { value?: unknown } | undefined): string {
  return typeof v?.value === 'string' ? v.value : '';
}

/**
 * Gather accessibility-tree observations: missing accessible names (from the AX
 * tree, with selector/snippet resolved per node) and positive tabindex (from a
 * DOM probe). Best-effort per node — a resolution failure on one node never
 * aborts the rest.
 */
async function gatherObservations(client: CDPSession, page: Page): Promise<A11yTreeObservation[]> {
  const out: A11yTreeObservation[] = [];

  // 1. Missing accessible names from the computed accessibility tree.
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  for (const node of nodes) {
    if (out.length >= MAX_NAME_FINDINGS) break;
    if (node.ignored) continue;
    const role = axStringValue(node.role);
    if (!ROLES_REQUIRING_NAME.has(role)) continue;
    if (axStringValue(node.name).trim().length > 0) continue;
    const backendNodeId = node.backendDOMNodeId;
    if (backendNodeId === undefined) continue; // Need a DOM node to attribute it.

    let selector = role;
    let snippet = '';
    try {
      const described = await client.send('DOM.describeNode', { backendNodeId });
      selector = selectorFromNode(described.node);
    } catch {
      // Best-effort — keep the role as a fallback selector.
    }
    try {
      const html = await client.send('DOM.getOuterHTML', { backendNodeId });
      snippet = (html.outerHTML ?? '').slice(0, 160);
    } catch {
      // Best-effort — snippet stays empty.
    }
    out.push({ kind: 'missing-name', role, selector, snippet });
  }

  // 2. Positive tabindex (WCAG 2.4.3) from a DOM probe — deterministic, low-FP.
  try {
    const tabindexObs = await page.evaluate((cap: number): A11yTreeObservation[] => {
      const found: A11yTreeObservation[] = [];
      const els = Array.from(document.querySelectorAll<HTMLElement>('[tabindex]'));
      for (const el of els) {
        if (found.length >= cap) break;
        if (!(el.tabIndex > 0)) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const tag = el.tagName.toLowerCase();
        let selector = tag;
        if (el.id) selector = `${tag}#${el.id}`;
        else if (el.classList.length > 0) {
          selector = `${tag}.${Array.from(el.classList).slice(0, 2).join('.')}`;
        }
        found.push({
          kind: 'positive-tabindex',
          selector,
          snippet: (el.outerHTML ?? '').slice(0, 160),
          message:
            `Element has tabindex="${el.getAttribute('tabindex')}", forcing a focus order ` +
            'that diverges from the DOM / reading order (WCAG 2.4.3 Focus Order).',
        });
      }
      return found;
    }, MAX_TABINDEX_FINDINGS);
    out.push(...tabindexObs);
  } catch {
    // DOM probe is additive — a failure leaves the AX-tree findings intact.
  }

  return out;
}

/**
 * Run the accessibility-tree engine against a single URL.
 *
 * Returns an {@link A11yTreeResult}. Never throws: any launch / load / run
 * failure yields `pagesChecked: 0` and a single error entry.
 */
export async function runA11yTreeChecks(
  url: string,
  opts: A11yTreeOptions = {},
): Promise<A11yTreeResult> {
  let browser: Browser | undefined;
  let client: CDPSession | undefined;
  try {
    const puppeteer = await loadPuppeteer();
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    browser = await puppeteer.launch(
      buildLaunchOptions(puppeteer, opts) as Parameters<PuppeteerNode['launch']>[0],
    );
    const page: Page = await browser.newPage();
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      await page.setExtraHTTPHeaders({ ...opts.headers });
    }
    await page.setViewport({ width: 1280, height: 1024 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    client = await page.createCDPSession();
    await client.send('Accessibility.enable');
    await client.send('DOM.enable');

    const observations = await withTimeout(gatherObservations(client, page), timeout, url);
    const issues = mapA11yTreeObservations(observations);
    return { issues, pagesChecked: 1, errors: [] };
  } catch (err) {
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  } finally {
    if (client) {
      try {
        await client.detach();
      } catch {
        // Never let teardown failures mask the real result / error.
      }
    }
    await safeCloseBrowser(browser);
  }
}

/** Reject if the promise does not settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Accessibility-tree checks timed out after ${ms}ms for ${url}`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
