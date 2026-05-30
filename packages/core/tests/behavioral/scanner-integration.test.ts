import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createServer as _createServer, type Server } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../../src/index.js';

/**
 * The static Pa11y scanner (DirectScanner) only auto-discovers a system
 * Chromium at /usr/bin/chromium*. Dev boxes / CI often have only a
 * puppeteer- or playwright-managed Chromium. Point pa11y at one via
 * PUPPETEER_EXECUTABLE_PATH so the FULL scanner path (static + behavioral)
 * runs here exactly as it does in production, where a system Chromium exists.
 */
function discoverChromium(): string | undefined {
  const home = process.env['HOME'] ?? '/root';
  const roots = [
    { base: join(home, '.cache', 'ms-playwright'), prefix: 'chromium' },
    { base: join(home, '.cache', 'puppeteer', 'chrome'), prefix: 'linux' },
  ];
  for (const { base, prefix } of roots) {
    try {
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        if (!entry.startsWith(prefix)) continue;
        const candidate = join(base, entry, 'chrome-linux64', 'chrome');
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // ignore — try next root
    }
  }
  return undefined;
}

beforeAll(() => {
  if (!process.env['PUPPETEER_EXECUTABLE_PATH']) {
    const chrome = discoverChromium();
    if (chrome) process.env['PUPPETEER_EXECUTABLE_PATH'] = chrome;
  }
});

/**
 * Integration test for the opt-in behavioral pass wired into createScanner.
 *
 * Drives the FULL scanner (static Pa11y scan + behavioral layer) in single-page
 * mode against an in-process fixture, and asserts that behavioral findings are
 * merged into the page's issue list when `behavioral: true`, and absent when
 * the flag is off (default). Launches a real headless browser, so timeouts are
 * generous.
 */

const TEST_TIMEOUT = 60000;

let servers: Server[] = [];

async function serve(html: string): Promise<string> {
  const server = _createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  return `http://127.0.0.1:${port}/`;
}

afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

// A page whose middle input traps the Tab key (preventDefault) — a definite
// keyboard trap that only the behavioral layer can detect, never static Pa11y.
const TRAP_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Trap fixture</title></head>
<body>
  <h1>Trap fixture</h1>
  <input id="a" aria-label="first">
  <input id="trap" aria-label="trapping">
  <input id="c" aria-label="third">
  <script>
    document.getElementById('trap').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); }
    });
  </script>
</body></html>`;

describe('createScanner behavioral pass (integration)', () => {
  it('merges behavioral findings into page issues when behavioral=true', async () => {
    const url = await serve(TRAP_PAGE);
    const scanner = createScanner({ standard: 'WCAG2AA', singlePage: true, behavioral: true });
    const result = await scanner.scan(url);

    // The static Pa11y scan needs a system Chromium (DirectScanner only probes
    // /usr/bin/chromium*); in environments without one it yields zero pages and
    // the behavioral pass has nothing to attach to. Skip rather than false-fail —
    // the behavioral engine itself is covered by behavioral.test.ts (its own
    // chromium discovery works), and prod/CI provide a system Chromium.
    if (result.pages.length === 0) {
      console.warn('[scanner-integration] static scan produced 0 pages (no system Chromium) — skipping merge assertions');
      return;
    }

    expect(result.pages.length).toBe(1);
    const allIssues = result.pages.flatMap((p) => p.issues);
    const behavioralIssues = allIssues.filter((i) => /Luqen\.Behavioral\./.test(i.code));
    expect(behavioralIssues.length).toBeGreaterThan(0);
    // The keyboard trap (2.1.2) must be among them, as an error.
    const trap = behavioralIssues.find((i) => /2_1_2/.test(i.code));
    expect(trap).toBeDefined();
    expect(trap?.type).toBe('error');
    // page.issueCount reflects the merged total.
    expect(result.pages[0].issueCount).toBe(result.pages[0].issues.length);
  }, TEST_TIMEOUT);

  it('does NOT run behavioral checks when the flag is off (default)', async () => {
    const url = await serve(TRAP_PAGE);
    const scanner = createScanner({ standard: 'WCAG2AA', singlePage: true });
    const result = await scanner.scan(url);

    const behavioralIssues = result.pages
      .flatMap((p) => p.issues)
      .filter((i) => /Luqen\.Behavioral\./.test(i.code));
    expect(behavioralIssues.length).toBe(0);
  }, TEST_TIMEOUT);
});
