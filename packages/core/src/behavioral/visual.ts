/**
 * Visual-context capture for the LLM-vision behavioral checks (Phase 84).
 *
 * This module is intentionally LLM-agnostic: it only drives the browser to
 * capture the raw material a vision model needs — a screenshot, the semantic
 * heading outline, and an inventory of images with their surrounding context.
 * The actual vision call (the `analyse-visual` LLM capability) is orchestrated
 * one layer up (the dashboard scan pipeline), keeping @luqen/core free of any
 * LLM-service dependency.
 */

import type { Page } from 'puppeteer';

/** A screenshot payload in the shape the LLM `analyse-visual` capability expects. */
export interface CapturedScreenshot {
  readonly mediaType: 'image/png';
  /** Base64-encoded PNG bytes (no `data:` prefix). */
  readonly data: string;
}

/** One image element discovered on the page, with the context for an alt-text check. */
export interface CapturedImage {
  readonly selector: string;
  readonly src: string;
  readonly alt: string | null;
  readonly role: string | null;
  /** Trimmed text of the nearest meaningful ancestor — context for decorative-vs-informational. */
  readonly surroundingText: string;
  /**
   * Phase 84 (alt-text) — the rendered PNG bytes of this image element, when
   * byte capture is enabled (`maxImageBytes > 0`) and the element screenshotted
   * successfully. Feeds the LLM `analyse-visual` alt-text check one layer up.
   * Absent for elements that are hidden / zero-size / failed to screenshot.
   */
  readonly bytes?: CapturedScreenshot;
}

export interface VisualContext {
  readonly screenshot: CapturedScreenshot;
  /** Plain-text outline: real headings + visually-heading-like candidates. */
  readonly headingOutline: string;
  readonly images: readonly CapturedImage[];
}

export interface CaptureVisualOptions {
  /** Max images to inventory (default 20). */
  readonly maxImages?: number;
  /**
   * Phase 84 (alt-text) — max images for which to also capture rendered PNG
   * bytes (via per-element screenshot) for the LLM alt-text check. 0 disables
   * byte capture entirely (the default — byte capture is opt-in because each
   * element screenshot adds latency). Capped at `maxImages`.
   */
  readonly maxImageBytes?: number;
}

const DEFAULT_MAX_IMAGES = 20;

/**
 * Capture the visual context of the currently-loaded page: a viewport
 * screenshot, the heading outline (real + styled-as-heading candidates), and
 * an image inventory. Never throws for empty pages — returns empty collections.
 */
export async function captureVisualContext(
  page: Page,
  opts: CaptureVisualOptions = {},
): Promise<VisualContext> {
  const maxImages = opts.maxImages ?? DEFAULT_MAX_IMAGES;

  const data = (await page.screenshot({ encoding: 'base64', fullPage: false })) as unknown as string;

  const { headingOutline, images } = await page.evaluate((max: number) => {
    function cssPath(el: Element): string {
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = sameTag.indexOf(el);
      return `${tag}:nth-of-type(${idx + 1})`;
    }

    // --- Heading outline: real headings + visually-heading-like candidates ---
    const lines: string[] = [];
    const realHeadings = Array.from(
      document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'),
    );
    for (const h of realHeadings) {
      const text = (h.textContent ?? '').trim().slice(0, 80);
      if (text.length === 0) continue;
      const tag = h.tagName.toLowerCase();
      const level = h.getAttribute('aria-level');
      lines.push(`HEADING <${tag}${level ? ` aria-level=${level}` : ''}>: "${text}"`);
    }

    // Candidate pseudo-headings: block-ish text that LOOKS like a heading but
    // is not marked up as one (the classic styled-<div> heading).
    const candidates = Array.from(document.querySelectorAll('div, span, p, strong, b'));
    let candCount = 0;
    for (const el of candidates) {
      if (candCount >= 30) break;
      const e = el as HTMLElement;
      // Only consider elements whose direct text is the bulk of their content.
      const text = (e.textContent ?? '').trim();
      if (text.length === 0 || text.length > 60) continue;
      if (e.querySelector('h1,h2,h3,h4,h5,h6')) continue;
      const style = window.getComputedStyle(e);
      const fontSize = parseFloat(style.fontSize) || 0;
      const weight = parseInt(style.fontWeight, 10) || 400;
      const display = style.display;
      const isBlock = display === 'block' || display === 'flex' || display === 'grid';
      const looksLikeHeading = (fontSize >= 20 || weight >= 600) && isBlock;
      if (!looksLikeHeading) continue;
      candCount += 1;
      lines.push(
        `CANDIDATE <${e.tagName.toLowerCase()}> (${Math.round(fontSize)}px weight:${weight}): "${text.slice(0, 60)}"`,
      );
    }

    // --- Image inventory ---
    const imgEls = Array.from(document.querySelectorAll('img')).slice(0, max);
    const images = imgEls.map((img) => {
      const ancestor = img.closest('figure, a, p, li, section, article') ?? img.parentElement;
      const surrounding = ((ancestor?.textContent ?? '').trim()).slice(0, 200);
      return {
        selector: cssPath(img),
        src: (img.getAttribute('src') ?? '').slice(0, 300),
        alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
        role: img.getAttribute('role'),
        surroundingText: surrounding,
      };
    });

    return { headingOutline: lines.join('\n'), images };
  }, maxImages);

  // Phase 84 (alt-text) — optionally capture per-image rendered bytes. The
  // evaluate() above walks `img` elements in document order sliced to
  // `maxImages`; `page.$$('img')` yields handles in the SAME order, so handle
  // index N matches images[N]. Each screenshot is guarded: a hidden / detached /
  // zero-size element simply yields no bytes for that entry (degrade, never throw).
  const maxImageBytes = Math.min(opts.maxImageBytes ?? 0, maxImages);
  let imagesOut: CapturedImage[] = images as CapturedImage[];
  if (maxImageBytes > 0 && images.length > 0) {
    const handles = await page.$$('img');
    const limit = Math.min(maxImageBytes, images.length, handles.length);
    imagesOut = await Promise.all(
      images.map(async (img, i): Promise<CapturedImage> => {
        if (i >= limit) return img;
        try {
          const b = (await handles[i].screenshot({ encoding: 'base64' })) as unknown as string;
          if (typeof b === 'string' && b.length > 0) {
            return { ...img, bytes: { mediaType: 'image/png', data: b } };
          }
        } catch {
          // hidden / detached / zero-size element — no bytes for this entry.
        }
        return img;
      }),
    );
  }

  return {
    screenshot: { mediaType: 'image/png', data },
    headingOutline,
    images: imagesOut,
  };
}
