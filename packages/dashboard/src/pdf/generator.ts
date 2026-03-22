/**
 * Server-side PDF generation using Puppeteer.
 *
 * Puppeteer is an optional dependency — if it is not installed, the exported
 * functions throw a descriptive error instead of crashing the process.  The
 * browser instance is lazily initialised as a singleton and reused across
 * requests.  A graceful-shutdown handler closes it when the process exits.
 */

import { createRequire } from 'node:module';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfOptions {
  /** Paper format — default "A4". */
  readonly format?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  /** Landscape orientation — default false. */
  readonly landscape?: boolean;
  /** Page margins. */
  readonly margin?: {
    readonly top?: string;
    readonly right?: string;
    readonly bottom?: string;
    readonly left?: string;
  };
  /** HTML template rendered in the page header (Puppeteer header template). */
  readonly headerTemplate?: string;
  /** HTML template rendered in the page footer (Puppeteer footer template). */
  readonly footerTemplate?: string;
}

// ---------------------------------------------------------------------------
// Puppeteer availability check
// ---------------------------------------------------------------------------

let _puppeteerAvailable: boolean | null = null;

/**
 * Returns `true` when `puppeteer` (or `puppeteer-core`) can be loaded in this
 * environment.  The check is performed once and cached.
 */
export function isPuppeteerAvailable(): boolean {
  if (_puppeteerAvailable !== null) return _puppeteerAvailable;

  const req = createRequire(import.meta.url);

  try {
    req.resolve('puppeteer');
    _puppeteerAvailable = true;
  } catch {
    try {
      req.resolve('puppeteer-core');
      _puppeteerAvailable = true;
    } catch {
      _puppeteerAvailable = false;
    }
  }

  return _puppeteerAvailable;
}

// ---------------------------------------------------------------------------
// Browser singleton
// ---------------------------------------------------------------------------

type PuppeteerBrowser = {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
};

type PuppeteerPage = {
  setContent(html: string, options?: { waitUntil?: string | string[] }): Promise<void>;
  pdf(options?: Record<string, unknown>): Promise<Buffer>;
  close(): Promise<void>;
};

type PuppeteerModule = {
  launch(options?: Record<string, unknown>): Promise<PuppeteerBrowser>;
};

let _browser: PuppeteerBrowser | null = null;
let _browserPromise: Promise<PuppeteerBrowser> | null = null;
let _shutdownRegistered = false;

async function loadPuppeteer(): Promise<PuppeteerModule> {
  try {
    // @ts-expect-error — puppeteer is an optional dependency; types may not be installed
    return (await import('puppeteer')) as unknown as PuppeteerModule;
  } catch {
    try {
      // @ts-expect-error — puppeteer-core is an optional fallback
      return (await import('puppeteer-core')) as unknown as PuppeteerModule;
    } catch {
      throw new Error(
        'Puppeteer is not installed. Install it with: npm install puppeteer' +
        '\nPDF generation requires puppeteer as an optional dependency.',
      );
    }
  }
}

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (_browser !== null) return _browser;

  // Prevent concurrent launches — multiple requests arriving before the
  // first launch completes should all await the same promise.
  if (_browserPromise !== null) return _browserPromise;

  _browserPromise = (async () => {
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    _browser = browser;

    // Register graceful-shutdown handlers once
    if (!_shutdownRegistered) {
      _shutdownRegistered = true;

      const shutdown = () => {
        if (_browser !== null) {
          _browser.close().catch(() => undefined);
          _browser = null;
          _browserPromise = null;
        }
      };

      process.on('exit', shutdown);
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    }

    return browser;
  })();

  try {
    return await _browserPromise;
  } catch (err) {
    // Reset so a subsequent call can retry
    _browserPromise = null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an HTML string to a PDF buffer using Puppeteer.
 *
 * The browser instance is lazily initialised and reused across calls.
 *
 * @throws If puppeteer is not installed or the browser cannot be launched.
 */
export async function generateReportPdf(
  html: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  if (!isPuppeteerAvailable()) {
    throw new Error(
      'Puppeteer is not installed. Install it with: npm install puppeteer' +
      '\nPDF generation requires puppeteer as an optional dependency.',
    );
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfOptions: Record<string, unknown> = {
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: options.margin ?? {
        top: '15mm',
        right: '10mm',
        bottom: '15mm',
        left: '10mm',
      },
    };

    if (options.headerTemplate !== undefined || options.footerTemplate !== undefined) {
      pdfOptions['displayHeaderFooter'] = true;
      if (options.headerTemplate !== undefined) {
        pdfOptions['headerTemplate'] = options.headerTemplate;
      }
      if (options.footerTemplate !== undefined) {
        pdfOptions['footerTemplate'] = options.footerTemplate;
      }
    }

    const pdfBuffer = await page.pdf(pdfOptions);
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Close the shared browser instance, if one is running.
 * Useful for tests or explicit cleanup.
 */
export async function closeBrowser(): Promise<void> {
  if (_browser !== null) {
    await _browser.close().catch(() => undefined);
    _browser = null;
    _browserPromise = null;
  }
}
