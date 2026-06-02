import { describe, it, expect, vi } from 'vitest';
import { pdfWithFallback } from '../../src/services/pdf-fallback.js';

/**
 * The ACR PDF route renders the shared template via headless Chromium
 * (generateAcrPdf). When no browser can launch (e.g. CI, or a misconfigured
 * host), the route must still return a valid PDF by degrading to the PDFKit
 * VPAT renderer. pdfWithFallback encodes that "try canonical, else degrade"
 * contract, kept pure so the degrade path is testable without a browser.
 */
describe('pdfWithFallback', () => {
  it('returns the primary buffer when the primary renderer succeeds', async () => {
    const primary = vi.fn(async () => Buffer.from('PRIMARY'));
    const fallback = vi.fn(async () => Buffer.from('FALLBACK'));

    const out = await pdfWithFallback(primary, fallback);

    expect(out.toString()).toBe('PRIMARY');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to the secondary renderer when the primary throws', async () => {
    const primary = vi.fn(async () => {
      throw new Error('Failed to launch the browser process');
    });
    const fallback = vi.fn(async () => Buffer.from('FALLBACK'));

    const out = await pdfWithFallback(primary, fallback);

    expect(out.toString()).toBe('FALLBACK');
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('invokes the onFallback hook with the primary error before degrading', async () => {
    const err = new Error('no chromium');
    const onFallback = vi.fn();

    await pdfWithFallback(
      async () => {
        throw err;
      },
      async () => Buffer.from('FALLBACK'),
      onFallback,
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(err);
  });

  it('propagates the error when the fallback ALSO throws (nothing to serve)', async () => {
    await expect(
      pdfWithFallback(
        async () => {
          throw new Error('primary down');
        },
        async () => {
          throw new Error('fallback down');
        },
      ),
    ).rejects.toThrow('fallback down');
  });
});
