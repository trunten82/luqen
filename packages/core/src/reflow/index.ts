/**
 * Reflow / zoom-400% accessibility-testing engine — public entry point.
 *
 * Loads a page in a locally-launched headless Chrome, narrows the viewport to
 * 320 CSS px (equivalent to 400% zoom of a 1280px desktop layout) and reports
 * content that breaks: a page that needs horizontal scrolling, individual
 * elements that spill past the viewport, and viewport meta tags that lock zoom.
 * Findings map to the shared `Issue` shape (runner='reflow'), covering WCAG
 * 1.4.10 (Reflow) and 1.4.4 (Resize text) — layout criteria that static
 * rulesets (axe-core, HTML_CodeSniffer, IBM Equal Access) do not cover.
 *
 * FREE / local only — drives the puppeteer Chrome that ships transitively with
 * pa11y; the only network access is loading the scanned page.
 *
 * Mirrors the behavioral / Lighthouse / IBM engines' contract: NEVER throws. On
 * any launch / load / run failure the result has `pagesChecked: 0` and a single
 * error entry.
 *
 * Browser launch: the box runs services as ROOT, so Chrome MUST be launched
 * with `--no-sandbox --disable-setuid-sandbox` — without them Chrome refuses to
 * start ("Running as root without --no-sandbox is not supported"). This is
 * exactly the bug that silently killed the IBM engine. Chrome discovery goes
 * through the ONE shared resolver in packages/core/src/browser/
 * (CHROMIUM-RESOLVE-1) — no local copy of the discovery strategy.
 */

import type { Browser, Page } from 'puppeteer';
import { launchChromium, safeCloseBrowser } from '../browser/launch.js';
import type { ReflowOptions, ReflowResult } from './types.js';
import { mapReflowObservations, type ReflowObservation } from './map.js';

export type { ReflowOptions, ReflowResult } from './types.js';
export {
  mapReflowObservations,
  KIND_MAP,
  MAX_ISSUES,
  type ReflowObservation,
  type ReflowObservationKind,
} from './map.js';

const DEFAULT_TIMEOUT = 60_000;
/** Baseline desktop width before narrowing — a 1280px layout at 400% zoom = 320 CSS px. */
const BASELINE_VIEWPORT_WIDTH = 1280;
/** WCAG 1.4.10 reflow target: a single column of content at 320 CSS px. */
const REFLOW_VIEWPORT_WIDTH = 320;
const REFLOW_VIEWPORT_HEIGHT = 1024;
/** Pixels of slack before horizontal overflow counts (rounding / scrollbar artifacts). */
const OVERFLOW_TOLERANCE_PX = 4;
/** Cap on per-element overflow findings emitted from one page. */
const MAX_OVERFLOW_ELEMENTS = 15;
/** Cap on elements scanned in-page (bounds the DOM walk on huge pages). */
const MAX_ELEMENTS_SCANNED = 4000;
/** Settle time (ms) after narrowing the viewport so media queries / responsive JS apply. */
const REFLOW_SETTLE_MS = 300;

/**
 * Gather reflow observations from the page AS RENDERED at the current (narrow)
 * viewport. Pure data crosses the evaluate boundary; the mapping to Issues
 * happens in the (unit-tested) pure mapper.
 */
async function gatherObservations(
  page: Page,
  tolerance: number,
  maxElements: number,
  maxElementsScanned: number,
): Promise<ReflowObservation[]> {
  return page.evaluate(
    (tol: number, maxEls: number, maxScan: number): ReflowObservation[] => {
      const observations: ReflowObservation[] = [];
      const docEl = document.documentElement;
      const vw = docEl.clientWidth;
      const scrollW = docEl.scrollWidth;

      // Page-level horizontal overflow — the canonical Reflow (1.4.10) failure.
      if (scrollW - vw > tol) {
        observations.push({
          kind: 'page-overflow',
          selector: 'html',
          snippet: '',
          message:
            `Page content is ${scrollW}px wide but the viewport is ${vw}px — ` +
            'horizontal scrolling is required at 320 CSS px (400% zoom). Fails Reflow (WCAG 1.4.10).',
        });
      }

      // Viewport meta tag that locks zoom — Resize text (1.4.4) failure.
      const meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        const raw = meta.getAttribute('content') ?? '';
        const content = raw.toLowerCase();
        const userScalableNo = /user-scalable\s*=\s*(no|0)\b/.test(content);
        const maxScaleMatch = content.match(/maximum-scale\s*=\s*([0-9.]+)/);
        const maxScale = maxScaleMatch ? parseFloat(maxScaleMatch[1]) : NaN;
        const maxScaleLow = Number.isFinite(maxScale) && maxScale < 2;
        if (userScalableNo || maxScaleLow) {
          observations.push({
            kind: 'zoom-disabled',
            selector: 'meta[name="viewport"]',
            snippet: raw.slice(0, 160),
            message: userScalableNo
              ? 'Viewport meta tag sets user-scalable=no, preventing zoom — fails Resize text (WCAG 1.4.4).'
              : `Viewport meta tag sets maximum-scale=${maxScale}, blocking 200% zoom — fails Resize text (WCAG 1.4.4).`,
          });
        }
      }

      // Per-element overflow (content loss / overlap). Report only the INNERMOST
      // offenders — an element whose own box spills past the viewport but none
      // of whose direct children do — so we surface the genuinely wide content
      // rather than every ancestor that contains it.
      const selectorFor = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `${tag}#${el.id}`;
        let sel = tag;
        if (el.classList.length > 0) {
          sel += `.${Array.from(el.classList).slice(0, 2).join('.')}`;
        }
        const parent = el.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
          if (sameTag.length > 1) sel += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
        }
        return sel;
      };

      // Only RIGHTWARD overflow is a reflow problem (it forces horizontal
      // scrolling). Elements positioned off-screen to the LEFT — the standard
      // visually-hidden / skip-link / sr-only pattern (left:-9999px) — have
      // rect.right <= 0 and never create horizontal scroll, so we must NOT flag
      // them (they are an accessibility AID, not a failure).
      const overflowsViewport = (rect: DOMRect): boolean =>
        rect.width > 0 && rect.height > 0 && rect.right > vw + tol;

      const all = document.body ? document.body.querySelectorAll('*') : [];
      let scanned = 0;
      for (const el of Array.from(all)) {
        if (observations.length >= maxEls || scanned >= maxScan) break;
        scanned++;
        const style = getComputedStyle(el);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          parseFloat(style.opacity) === 0
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (!overflowsViewport(rect)) continue;
        // Skip if a direct child is itself the overflowing box (report the leaf).
        const childOverflows = Array.from(el.children).some((c) =>
          overflowsViewport(c.getBoundingClientRect()),
        );
        if (childOverflows) continue;
        observations.push({
          kind: 'element-overflow',
          selector: selectorFor(el),
          snippet: (el.outerHTML ?? '').slice(0, 160),
          message:
            `Element reaches ${Math.round(rect.right)}px (viewport ${vw}px), causing ` +
            'horizontal scrolling or content loss at 400% zoom (WCAG 1.4.10).',
        });
      }

      return observations;
    },
    tolerance,
    maxElements,
    maxElementsScanned,
  );
}

/**
 * Run the reflow / zoom-400% engine against a single URL.
 *
 * Returns a {@link ReflowResult}. Never throws: any launch / load / run failure
 * yields `pagesChecked: 0` and a single error entry.
 */
export async function runReflowChecks(
  url: string,
  opts: ReflowOptions = {},
): Promise<ReflowResult> {
  let browser: Browser | undefined;
  try {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    browser = await launchChromium(opts.chromeLaunchConfig);
    const page: Page = await browser.newPage();
    if (opts.headers && Object.keys(opts.headers).length > 0) {
      await page.setExtraHTTPHeaders({ ...opts.headers });
    }
    // Load at a normal desktop width first so the page lays out as designed...
    await page.setViewport({ width: BASELINE_VIEWPORT_WIDTH, height: REFLOW_VIEWPORT_HEIGHT });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // ...then narrow to 320 CSS px (= 400% zoom of 1280px) and let it reflow.
    await page.setViewport({ width: REFLOW_VIEWPORT_WIDTH, height: REFLOW_VIEWPORT_HEIGHT });
    await new Promise<void>((resolve) => setTimeout(resolve, REFLOW_SETTLE_MS));

    const observations = await withTimeout(
      gatherObservations(page, OVERFLOW_TOLERANCE_PX, MAX_OVERFLOW_ELEMENTS, MAX_ELEMENTS_SCANNED),
      timeout,
      url,
    );
    const issues = mapReflowObservations(observations);
    return { issues, pagesChecked: 1, errors: [] };
  } catch (err) {
    return {
      issues: [],
      pagesChecked: 0,
      errors: [{ url, message: toMessage(err) }],
    };
  } finally {
    await safeCloseBrowser(browser);
  }
}

/** Reject if the promise does not settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Reflow checks timed out after ${ms}ms for ${url}`));
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
