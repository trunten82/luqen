/**
 * "Try the canonical renderer, else degrade" for the ACR PDF.
 *
 * The dashboard renders the shared ACR template to PDF via headless Chromium
 * (generateAcrPdf) — the single-source path that matches the WordPress plugin.
 * That path needs a launchable browser, which is not guaranteed everywhere
 * (CI, a host where Chromium is missing or the service user can't spawn it).
 * Rather than fail the export, the route degrades to the dependency-free PDFKit
 * VPAT renderer so a valid PDF is always served. This module keeps that policy
 * pure and injectable so the degrade path is testable without a browser.
 */

/**
 * Run the primary PDF renderer; if it throws, run the fallback. The fallback's
 * own errors propagate (there is nothing left to serve). `onFallback` is
 * invoked with the primary error before degrading — wire it to a logger so a
 * silent regression to the non-canonical renderer is observable.
 *
 * @param primary    Canonical renderer (shared-template HTML→PDF).
 * @param fallback   Degraded renderer (PDFKit VPAT) used only if primary fails.
 * @param onFallback Optional hook invoked with the primary error before degrading.
 */
export async function pdfWithFallback(
  primary: () => Promise<Buffer>,
  fallback: () => Promise<Buffer>,
  onFallback?: (err: unknown) => void,
): Promise<Buffer> {
  try {
    return await primary();
  } catch (err) {
    if (onFallback) onFallback(err);
    return await fallback();
  }
}
