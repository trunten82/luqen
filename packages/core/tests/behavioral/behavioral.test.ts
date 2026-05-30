/**
 * Integration tests for the behavioral accessibility engine.
 *
 * These tests launch a real puppeteer browser and serve HTML fixtures over a
 * tiny in-process HTTP server (so `page.goto` and same-origin scripts behave
 * exactly like production). Each test sets a generous timeout because browser
 * launch is slow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runBehavioralChecks } from '../../src/behavioral/index.js';

const TEST_TIMEOUT = 30000;

/** The regex `extractCriterion()` uses downstream to map a code to a criterion. */
const CRITERION_RE = /(\d+)_(\d+)_(\d+)/;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGE_HEAD =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title>';

/** Clean, accessible page: visible focus styles on all interactive elements. */
const CLEAN_FIXTURE = `${PAGE_HEAD}
<style>
  a:focus, button:focus, input:focus { outline: 2px solid blue; }
</style>
</head>
<body>
  <main>
    <a href="#section">Skip link</a>
    <button type="button">Action</button>
    <label>Name <input type="text" name="name"></label>
    <a href="https://example.com">External link</a>
  </main>
</body></html>`;

/**
 * Keyboard trap: an input that swallows the Tab key (preventDefault) so once
 * focus lands on it, the keyboard can never move focus away — a definite,
 * deterministic 2.1.2 keyboard trap.
 *
 * (A naive "refocus on blur" trap is browser-dependent: modern Chromium often
 * still completes the focus move before the async refocus fires. Swallowing Tab
 * is unambiguous and is exactly what a real trapping widget does.)
 */
const TRAP_FIXTURE = `${PAGE_HEAD}
<style>
  button:focus, #trap:focus { outline: 2px solid blue; }
</style>
</head>
<body>
  <button type="button" id="first">First</button>
  <input type="text" id="trap" aria-label="Trapped field">
  <button type="button" id="after">After</button>
  <script>
    var trap = document.getElementById('trap');
    // Swallow the Tab key so focus cannot leave this element via the keyboard.
    trap.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); }
    });
  </script>
</body></html>`;

/** No focus indicator: a button with outline:none and no alternative. */
const NO_INDICATOR_FIXTURE = `${PAGE_HEAD}
<style>
  * { outline: none; }
  button { border: none; box-shadow: none; }
</style>
</head>
<body>
  <button type="button" id="ghost">Invisible focus</button>
</body></html>`;

/**
 * Dynamic state:
 *  - #broken reveals a region but NEVER updates aria-expanded → 4.1.2
 *  - #good correctly toggles aria-expanded → no false positive
 */
const DYNAMIC_FIXTURE = `${PAGE_HEAD}
<style>
  button:focus { outline: 2px solid blue; }
  [hidden] { display: none; }
</style>
</head>
<body>
  <button type="button" id="broken" aria-expanded="false" aria-controls="panel1">Broken toggle</button>
  <div id="panel1" hidden>Broken panel content</div>

  <button type="button" id="good" aria-expanded="false" aria-controls="panel2">Good toggle</button>
  <div id="panel2" hidden>Good panel content</div>

  <script>
    var broken = document.getElementById('broken');
    var panel1 = document.getElementById('panel1');
    broken.addEventListener('click', function () {
      // Reveal the region but DO NOT update aria-expanded (the bug).
      panel1.hidden = false;
    });

    var good = document.getElementById('good');
    var panel2 = document.getElementById('panel2');
    good.addEventListener('click', function () {
      var open = good.getAttribute('aria-expanded') === 'true';
      good.setAttribute('aria-expanded', String(!open));
      panel2.hidden = open;
    });
  </script>
</body></html>`;

// ---------------------------------------------------------------------------
// Test HTTP server (serves one fixture per path)
// ---------------------------------------------------------------------------

const ROUTES: Record<string, string> = {
  '/clean': CLEAN_FIXTURE,
  '/trap': TRAP_FIXTURE,
  '/no-indicator': NO_INDICATOR_FIXTURE,
  '/dynamic': DYNAMIC_FIXTURE,
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = ROUTES[req.url ?? ''];
    if (html === undefined) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorsOf(issues: readonly { type: string }[]): number {
  return issues.filter((i) => i.type === 'error').length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBehavioralChecks', () => {
  it(
    'clean accessible fixture yields zero errors',
    async () => {
      const result = await runBehavioralChecks(`${baseUrl}/clean`);
      expect(result.pagesChecked).toBe(1);
      expect(result.errors).toEqual([]);
      // The clean fixture must not produce any ERROR-level findings.
      expect(errorsOf(result.issues)).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'keyboard-trap fixture yields exactly one 2.1.2 error',
    async () => {
      const result = await runBehavioralChecks(`${baseUrl}/trap`);
      const trapErrors = result.issues.filter(
        (i) => i.type === 'error' && i.code.includes('2_1_2'),
      );
      expect(trapErrors.length).toBe(1);
      expect(trapErrors[0].code).toContain('KeyboardTrap');
      expect(trapErrors[0].runner).toBe('behavioral');
    },
    TEST_TIMEOUT,
  );

  it(
    'no-focus-indicator fixture yields a 2.4.7 warning and no error',
    async () => {
      const result = await runBehavioralChecks(`${baseUrl}/no-indicator`);
      const focusWarnings = result.issues.filter(
        (i) => i.type === 'warning' && i.code.includes('2_4_7'),
      );
      expect(focusWarnings.length).toBeGreaterThanOrEqual(1);
      // Heuristic only — must never escalate to an error.
      expect(errorsOf(result.issues)).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'dynamic-state fixture flags the broken toggle (4.1.2) but not the correct one',
    async () => {
      const result = await runBehavioralChecks(`${baseUrl}/dynamic`);
      const nrvWarnings = result.issues.filter(
        (i) => i.type === 'warning' && i.code.includes('4_1_2'),
      );
      // Exactly the broken toggle should be flagged.
      expect(nrvWarnings.length).toBe(1);
      expect(nrvWarnings[0].selector).toContain('broken');
      // The correct toggle must NOT be a false positive.
      const flaggedGood = nrvWarnings.some((i) => i.selector.includes('good'));
      expect(flaggedGood).toBe(false);
      // Conservative: dynamic-state checks are warnings, never errors.
      expect(errorsOf(result.issues)).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'every emitted issue has runner==="behavioral" and a criterion-parseable code',
    async () => {
      const paths = ['/clean', '/trap', '/no-indicator', '/dynamic'];
      for (const path of paths) {
        const result = await runBehavioralChecks(`${baseUrl}${path}`);
        for (const issue of result.issues) {
          expect(issue.runner).toBe('behavioral');
          expect(issue.code).toMatch(CRITERION_RE);
        }
      }
    },
    TEST_TIMEOUT * 2,
  );

  it(
    'a page that cannot load returns zero pages and one error (no throw, no leak)',
    async () => {
      // Port 1 is privileged/closed — the connection fails fast.
      const result = await runBehavioralChecks('http://127.0.0.1:1/nope', {
        timeout: 4000,
      });
      expect(result.pagesChecked).toBe(0);
      expect(result.issues).toEqual([]);
      expect(result.errors.length).toBe(1);
    },
    TEST_TIMEOUT,
  );
});
