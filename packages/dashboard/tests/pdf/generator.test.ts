import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock objects used across tests
// ---------------------------------------------------------------------------

const mockPage = {
  setContent: vi.fn().mockResolvedValue(undefined),
  pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockLaunch = vi.fn().mockResolvedValue(mockBrowser);

// ---------------------------------------------------------------------------
// Mock puppeteer — vitest intercepts both require.resolve and dynamic import
// so isPuppeteerAvailable() will see puppeteer as resolvable.
// ---------------------------------------------------------------------------

vi.mock('puppeteer', () => ({
  default: { launch: mockLaunch, executablePath: () => '/usr/bin/chromium' },
  launch: mockLaunch,
  executablePath: () => '/usr/bin/chromium',
}));

vi.mock('puppeteer-core', () => ({
  default: { launch: mockLaunch, executablePath: () => '/usr/bin/chromium' },
  launch: mockLaunch,
  executablePath: () => '/usr/bin/chromium',
}));

// ---------------------------------------------------------------------------
// Helper: reset all mock state and get a fresh module instance
// ---------------------------------------------------------------------------

function resetMocks(): void {
  mockPage.setContent.mockClear().mockResolvedValue(undefined);
  mockPage.pdf.mockClear().mockResolvedValue(Buffer.from('%PDF-fake'));
  mockPage.close.mockClear().mockResolvedValue(undefined);
  mockBrowser.newPage.mockClear().mockResolvedValue(mockPage);
  mockBrowser.close.mockClear().mockResolvedValue(undefined);
  mockLaunch.mockClear().mockResolvedValue(mockBrowser);
}

async function freshModule() {
  vi.resetModules();
  resetMocks();
  return import('../../src/pdf/generator.js');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PDF Generator', () => {

  // -----------------------------------------------------------------------
  // isPuppeteerAvailable
  // -----------------------------------------------------------------------

  describe('isPuppeteerAvailable', () => {
    it('returns true when puppeteer is resolvable (mocked)', async () => {
      const { isPuppeteerAvailable } = await freshModule();
      // Our vi.mock('puppeteer') makes it resolvable, and the mock provides
      // executablePath, so the binary check passes.
      expect(isPuppeteerAvailable()).toBe(true);
    });

    it('caches result after first call', async () => {
      const { isPuppeteerAvailable } = await freshModule();
      const first = isPuppeteerAvailable();
      const second = isPuppeteerAvailable();
      expect(first).toBe(second);
    });

    it('returns boolean type', async () => {
      const { isPuppeteerAvailable } = await freshModule();
      expect(typeof isPuppeteerAvailable()).toBe('boolean');
    });
  });

  // -----------------------------------------------------------------------
  // generateReportPdf — puppeteer available (the common path)
  // -----------------------------------------------------------------------

  describe('generateReportPdf', () => {
    it('generates a PDF buffer from HTML with default options', async () => {
      const { generateReportPdf } = await freshModule();
      const result = await generateReportPdf('<h1>Hello</h1>');

      expect(result).toBeInstanceOf(Buffer);
      expect(mockPage.setContent).toHaveBeenCalledWith('<h1>Hello</h1>', {
        waitUntil: 'networkidle0',
      });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'A4',
          landscape: false,
          printBackground: true,
          margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
        }),
      );
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('applies custom format — Letter', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Content</p>', { format: 'Letter' });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'Letter' }),
      );
    });

    it('applies custom format — A3', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>A3</p>', { format: 'A3' });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'A3' }),
      );
    });

    it('applies custom format — Legal', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Legal</p>', { format: 'Legal' });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'Legal' }),
      );
    });

    it('applies custom format — Tabloid', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Tabloid</p>', { format: 'Tabloid' });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'Tabloid' }),
      );
    });

    it('applies landscape orientation', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Landscape</p>', { landscape: true });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: true }),
      );
    });

    it('applies custom margin options', async () => {
      const { generateReportPdf } = await freshModule();
      const margin = { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' };
      await generateReportPdf('<p>Content</p>', { margin });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ margin }),
      );
    });

    it('sets displayHeaderFooter when headerTemplate is provided', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Content</p>', {
        headerTemplate: '<div>Header</div>',
      });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          displayHeaderFooter: true,
          headerTemplate: '<div>Header</div>',
        }),
      );
    });

    it('sets displayHeaderFooter when footerTemplate is provided', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Content</p>', {
        footerTemplate: '<div>Footer</div>',
      });
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          displayHeaderFooter: true,
          footerTemplate: '<div>Footer</div>',
        }),
      );
    });

    it('sets both header and footer templates together', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Content</p>', {
        headerTemplate: '<div>Header</div>',
        footerTemplate: '<div>Footer</div>',
      });
      const callArgs = mockPage.pdf.mock.calls[0][0];
      expect(callArgs.displayHeaderFooter).toBe(true);
      expect(callArgs.headerTemplate).toBe('<div>Header</div>');
      expect(callArgs.footerTemplate).toBe('<div>Footer</div>');
    });

    it('does not set displayHeaderFooter when no templates provided', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Content</p>');
      const callArgs = mockPage.pdf.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('displayHeaderFooter');
      expect(callArgs).not.toHaveProperty('headerTemplate');
      expect(callArgs).not.toHaveProperty('footerTemplate');
    });

    it('closes the page even when pdf() throws', async () => {
      const { generateReportPdf } = await freshModule();
      mockPage.pdf.mockRejectedValueOnce(new Error('PDF render failed'));

      await expect(generateReportPdf('<h1>Fail</h1>')).rejects.toThrow('PDF render failed');
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('closes the page even when setContent throws', async () => {
      const { generateReportPdf } = await freshModule();
      mockPage.setContent.mockRejectedValueOnce(new Error('content error'));

      await expect(generateReportPdf('<bad>')).rejects.toThrow('content error');
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('handles page.close() throwing without propagating', async () => {
      const { generateReportPdf } = await freshModule();
      mockPage.close.mockRejectedValueOnce(new Error('close failed'));

      const result = await generateReportPdf('<h1>OK</h1>');
      expect(result).toBeInstanceOf(Buffer);
    });

    it('reuses the same browser across multiple calls', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<h1>First</h1>');
      await generateReportPdf('<h1>Second</h1>');

      // newPage called twice but launch only once (singleton)
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(2);
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('uses A4 format by default', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Default</p>', {});
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'A4' }),
      );
    });

    it('uses portrait orientation by default', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Default</p>', {});
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ landscape: false }),
      );
    });

    it('uses default margins when none provided', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Default</p>');
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
        }),
      );
    });

    it('always enables printBackground', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Default</p>');
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ printBackground: true }),
      );
    });

    it('returns a proper Buffer instance', async () => {
      const { generateReportPdf } = await freshModule();
      const result = await generateReportPdf('<h1>Buffer test</h1>');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('accepts no options argument at all', async () => {
      const { generateReportPdf } = await freshModule();
      const result = await generateReportPdf('<p>No opts</p>');
      expect(result).toBeInstanceOf(Buffer);
    });

    it('passes correct args to puppeteer.launch', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<h1>Launch</h1>');

      expect(mockLaunch).toHaveBeenCalledWith({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    });

    it('sets waitUntil to networkidle0 for page content', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<h1>Wait</h1>');
      expect(mockPage.setContent).toHaveBeenCalledWith('<h1>Wait</h1>', {
        waitUntil: 'networkidle0',
      });
    });

    it('combines format, landscape, margin, and templates', async () => {
      const { generateReportPdf } = await freshModule();
      await generateReportPdf('<p>Full</p>', {
        format: 'A3',
        landscape: true,
        margin: { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' },
        headerTemplate: '<h>H</h>',
        footerTemplate: '<f>F</f>',
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'A3',
          landscape: true,
          printBackground: true,
          margin: { top: '5mm', right: '5mm', bottom: '5mm', left: '5mm' },
          displayHeaderFooter: true,
          headerTemplate: '<h>H</h>',
          footerTemplate: '<f>F</f>',
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // closeBrowser
  // -----------------------------------------------------------------------

  describe('closeBrowser', () => {
    it('closes the browser when one is active', async () => {
      const { generateReportPdf, closeBrowser } = await freshModule();
      await generateReportPdf('<h1>Init</h1>');
      mockBrowser.close.mockClear();

      await closeBrowser();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('does nothing when no browser is active', async () => {
      const { closeBrowser } = await freshModule();
      mockBrowser.close.mockClear();

      await closeBrowser();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it('handles browser.close() throwing without propagating', async () => {
      const { generateReportPdf, closeBrowser } = await freshModule();
      await generateReportPdf('<h1>Init</h1>');
      mockBrowser.close.mockRejectedValueOnce(new Error('close error'));

      await expect(closeBrowser()).resolves.toBeUndefined();
    });

    it('allows a new browser to launch after close', async () => {
      const { generateReportPdf, closeBrowser } = await freshModule();
      await generateReportPdf('<h1>First</h1>');
      await closeBrowser();

      const result = await generateReportPdf('<h1>Second</h1>');
      expect(result).toBeInstanceOf(Buffer);
      // Launch should have been called twice now (once before close, once after)
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('resets browser state so closeBrowser is idempotent', async () => {
      const { generateReportPdf, closeBrowser } = await freshModule();
      await generateReportPdf('<h1>Init</h1>');

      await closeBrowser();
      mockBrowser.close.mockClear();

      // Second close should be a no-op
      await closeBrowser();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getBrowser error recovery (tested indirectly)
  // -----------------------------------------------------------------------

  describe('getBrowser error recovery', () => {
    it('resets browser promise on launch failure so retry works', async () => {
      const { generateReportPdf } = await freshModule();
      mockLaunch.mockRejectedValueOnce(new Error('launch failed'));

      await expect(generateReportPdf('<h1>Fail</h1>')).rejects.toThrow('launch failed');

      // Second call should succeed because _browserPromise was reset
      mockLaunch.mockResolvedValueOnce(mockBrowser);
      const result = await generateReportPdf('<h1>Retry</h1>');
      expect(result).toBeInstanceOf(Buffer);
    });

    it('propagates launch error to caller', async () => {
      const { generateReportPdf } = await freshModule();
      mockLaunch.mockRejectedValueOnce(new Error('Chrome not found'));

      await expect(generateReportPdf('<h1>X</h1>')).rejects.toThrow('Chrome not found');
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent browser access
  // -----------------------------------------------------------------------

  describe('concurrent access', () => {
    it('shares the same browser promise for concurrent calls', async () => {
      const { generateReportPdf } = await freshModule();

      const [r1, r2] = await Promise.all([
        generateReportPdf('<h1>A</h1>'),
        generateReportPdf('<h1>B</h1>'),
      ]);

      expect(r1).toBeInstanceOf(Buffer);
      expect(r2).toBeInstanceOf(Buffer);
      expect(mockBrowser.newPage).toHaveBeenCalledTimes(2);
      // Only one launch despite concurrent calls
      expect(mockLaunch).toHaveBeenCalledTimes(1);
    });

    it('each call creates and closes its own page', async () => {
      const { generateReportPdf } = await freshModule();

      await generateReportPdf('<h1>A</h1>');
      await generateReportPdf('<h1>B</h1>');

      expect(mockPage.close).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Module exports
  // -----------------------------------------------------------------------

  describe('module exports', () => {
    it('exports generateReportPdf function', async () => {
      const mod = await freshModule();
      expect(typeof mod.generateReportPdf).toBe('function');
    });

    it('exports closeBrowser function', async () => {
      const mod = await freshModule();
      expect(typeof mod.closeBrowser).toBe('function');
    });

    it('exports isPuppeteerAvailable function', async () => {
      const mod = await freshModule();
      expect(typeof mod.isPuppeteerAvailable).toBe('function');
    });
  });

  // -----------------------------------------------------------------------
  // Graceful shutdown handlers (registered once)
  // -----------------------------------------------------------------------

  describe('shutdown handlers', () => {
    it('registers process exit handlers on first browser launch', async () => {
      const onSpy = vi.spyOn(process, 'on');
      const { generateReportPdf } = await freshModule();

      await generateReportPdf('<h1>Shutdown</h1>');

      const registeredEvents = onSpy.mock.calls.map(c => c[0]);
      expect(registeredEvents).toContain('exit');
      expect(registeredEvents).toContain('SIGINT');
      expect(registeredEvents).toContain('SIGTERM');

      onSpy.mockRestore();
    });
  });
});
