/**
 * Shared puppeteer runtime loader — the ONE place that resolves the
 * `puppeteer` module itself (not the Chromium *binary*; see resolve.ts for
 * that). Moved out of ibm/index.ts verbatim (CHROMIUM-RESOLVE-1 item 1).
 *
 * Resolution order: `require.resolve('puppeteer')` (the root workspace
 * dependency) first, then pa11y's own nested copy (pa11y bundles its own
 * puppeteer), else a bare specifier (surfaces a clear import error).
 */

import { createRequire } from 'node:module';
import type { PuppeteerNode } from 'puppeteer';

let puppeteerPromise: Promise<PuppeteerNode> | undefined;

/** Lazily-loaded puppeteer runtime (cached promise; resolved once). */
export async function loadPuppeteer(): Promise<PuppeteerNode> {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      const require = createRequire(import.meta.url);
      let specifier = 'puppeteer';
      try {
        specifier = require.resolve('puppeteer');
      } catch {
        try {
          // Resolve via pa11y's module graph (its nested dependency).
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
