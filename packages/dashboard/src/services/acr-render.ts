/**
 * Renders the SHARED ACR template (shared/acr, copied into dist/acr at build)
 * to HTML and to PDF. The template + acr.css are the single source of truth,
 * also vendored by the WordPress plugin, so the dashboard ACR and the WP ACR
 * are the same document. Mustache is the renderer on BOTH sides (the WP plugin
 * ships a tiny logic-less renderer for the same syntax).
 *
 * PDF is produced with the host's chromium via puppeteer — the same browser the
 * scanner engines already run — replacing the prior PDFKit ACR path. Fonts are
 * self-hosted and inlined as data URIs so output is deterministic with no
 * network dependency.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Mustache from 'mustache';
import type { AcrView } from './acr-view.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Built layout: dist/services/acr-render.js + dist/acr/* (copied from shared/acr
// at build). In dev/test we run from src/services, where src/acr does not exist,
// so fall back to the repo's canonical shared/acr (single source of truth).
const BUILT_ACR_DIR = resolve(HERE, '..', 'acr');
const SHARED_ACR_DIR = resolve(HERE, '..', '..', '..', '..', 'shared', 'acr');
const ACR_DIR = existsSync(resolve(BUILT_ACR_DIR, 'acr.template.html')) ? BUILT_ACR_DIR : SHARED_ACR_DIR;
const FONTS_DIR = resolve(HERE, '..', 'pdf', 'fonts');

interface FontFace {
  readonly family: string;
  readonly weight: number;
  readonly file: string;
}

// Inter "bold" weights map to SemiBold (the family ships 400 + SemiBold), so no
// synthetic bolding. IBM Plex Mono is the criterion-id / token face.
const FONT_FACES: readonly FontFace[] = [
  { family: 'Inter', weight: 400, file: 'Inter-Regular.ttf' },
  { family: 'Inter', weight: 500, file: 'Inter-SemiBold.ttf' },
  { family: 'Inter', weight: 600, file: 'Inter-SemiBold.ttf' },
  { family: 'Inter', weight: 700, file: 'Inter-SemiBold.ttf' },
  { family: 'Inter Display', weight: 600, file: 'InterDisplay-SemiBold.ttf' },
  { family: 'Inter Display', weight: 700, file: 'InterDisplay-SemiBold.ttf' },
  { family: 'IBM Plex Mono', weight: 400, file: 'IBMPlexMono-Regular.ttf' },
  { family: 'IBM Plex Mono', weight: 500, file: 'IBMPlexMono-Regular.ttf' },
];

let cachedTemplate: string | null = null;
let cachedCss: string | null = null;
let cachedFontCss: string | null = null;

async function loadTemplate(): Promise<string> {
  if (cachedTemplate === null) {
    cachedTemplate = await readFile(resolve(ACR_DIR, 'acr.template.html'), 'utf-8');
  }
  return cachedTemplate;
}

async function loadCss(): Promise<string> {
  if (cachedCss === null) {
    cachedCss = await readFile(resolve(ACR_DIR, 'acr.css'), 'utf-8');
  }
  return cachedCss;
}

/** Build the @font-face block once, inlining each TTF as a base64 data URI. */
async function loadFontCss(): Promise<string> {
  if (cachedFontCss !== null) return cachedFontCss;
  const faces: string[] = [];
  for (const f of FONT_FACES) {
    const path = resolve(FONTS_DIR, f.file);
    if (!existsSync(path)) continue;
    const b64 = (await readFile(path)).toString('base64');
    faces.push(
      `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-display:block;`
      + `src:url(data:font/ttf;base64,${b64}) format('truetype')}`,
    );
  }
  cachedFontCss = faces.join('\n');
  return cachedFontCss;
}

/**
 * Optional document chrome wrapped around the canonical ACR body. The shared
 * template is a pure legal document; the authenticated dashboard view wraps it
 * with interactive chrome (download buttons, the share-link manager) and the
 * public surfaces add nothing. Injection keeps the document itself byte-for-byte
 * the same Mustache render on every surface.
 */
export interface AcrHtmlChrome {
  /** Document language (drives <html lang> + improves a11y/print). Default 'en'. */
  readonly locale?: string;
  /** Extra <head> markup (meta tags, extra <style>). */
  readonly headExtra?: string;
  /** Markup injected immediately after <body> (toolbars, panels). */
  readonly bodyPrefix?: string;
  /** Markup injected immediately before </body> (scripts). */
  readonly bodySuffix?: string;
}

/**
 * Render the shared ACR template to a self-contained HTML document (fonts + CSS
 * inlined). Identical structure to the WordPress plugin's render of the same
 * template. Optional `chrome` adds dashboard-only interactive elements around
 * the otherwise-identical document body.
 */
export async function renderAcrHtml(view: AcrView, chrome: AcrHtmlChrome = {}): Promise<string> {
  const [template, css, fontCss] = await Promise.all([loadTemplate(), loadCss(), loadFontCss()]);
  const body = Mustache.render(template, view);
  const lang = (chrome.locale ?? 'en').replace(/[^a-zA-Z-]/g, '') || 'en';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>Accessibility Conformance Report</title>`
    + `<style>${fontCss}\n${css}</style>${chrome.headExtra ?? ''}</head>`
    + `<body>${chrome.bodyPrefix ?? ''}${body}${chrome.bodySuffix ?? ''}</body></html>`;
}

/** Resolve a chromium executable, mirroring the scanner's proven resolution. */
function chromiumExecutable(): string | undefined {
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p;
  }
  return undefined; // let puppeteer fall back to its bundled browser
}

/**
 * Render the ACR view to a PDF buffer via the host chromium. A4, print
 * backgrounds, waits for webfonts to settle so typography is deterministic.
 */
export async function generateAcrPdf(view: AcrView): Promise<Buffer> {
  const html = await renderAcrHtml(view);
  // Dynamic import keeps puppeteer out of the cold-start path of routes that
  // never produce a PDF.
  const { default: puppeteer } = await import('puppeteer');
  const exe = chromiumExecutable();
  const browser = await puppeteer.launch({
    headless: true,
    ...(exe ? { executablePath: exe } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}
