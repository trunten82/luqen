/**
 * DirectScanner — runs pa11y directly via the npm library instead of the webservice HTTP API.
 *
 * This is the default scan mode. The webservice path (WebserviceClient/Pool) remains
 * available as a fallback when `webserviceUrl` is explicitly configured.
 */

export interface DirectScanOptions {
  readonly standard: string;
  readonly timeout?: number;
  readonly wait?: number;
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly runner?: 'htmlcs' | 'axe';
}

export interface DirectScanResult {
  readonly url: string;
  readonly issues: ReadonlyArray<{
    readonly code: string;
    readonly type: string;
    readonly message: string;
    readonly selector: string;
    readonly context: string;
    readonly runner: string;
  }>;
}

/** Find system Chromium binary if available. */
function findSystemChromium(): string | undefined {
  const paths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    process.env['PUPPETEER_EXECUTABLE_PATH'],
  ];
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return undefined;
}

import { existsSync } from 'node:fs';

export class DirectScanner {
  async scan(url: string, options: DirectScanOptions): Promise<DirectScanResult> {
    // pa11y is a CommonJS package — use dynamic import for ESM compatibility
    const pa11yModule = await import('pa11y');
    const pa11y = pa11yModule.default ?? pa11yModule;

    // Prefer system Chromium (avoids missing shared library issues in LXC/Docker)
    const executablePath = findSystemChromium();

    const result = await pa11y(url, {
      standard: options.standard || 'WCAG2AA',
      timeout: options.timeout || 30000,
      wait: options.wait || 0,
      hideElements: options.hideElements || undefined,
      headers: options.headers || {},
      runners: options.runner === 'axe' ? ['axe'] : ['htmlcs'],
      includeWarnings: true,
      includeNotices: true,
      chromeLaunchConfig: {
        ...(executablePath ? { executablePath } : {}),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    return {
      url: result.pageUrl || url,
      issues: (result.issues || []).map((issue: { code: string; type: string; message: string; selector: string; context: string; runner?: string }) => ({
        code: issue.code,
        type: issue.type,
        message: issue.message,
        selector: issue.selector,
        context: issue.context,
        runner: issue.runner || 'htmlcs',
      })),
    };
  }
}
