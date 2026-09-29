import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'views');

let translateKey: (key: string, locale: string, params?: Record<string, string>) => string;

beforeAll(async () => {
  const i18n = await import('../../src/i18n/index.js');
  i18n.loadTranslations();
  translateKey = i18n.t;

  if (!handlebars.helpers['t']) {
    handlebars.registerHelper('t', function (
      key: string,
      options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } },
    ) {
      const locale = (options?.data?.root?.locale ?? 'en') as string;
      const params: Record<string, string> = {};
      if (options?.hash) {
        for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
      }
      return translateKey(key, locale, params);
    });
  }
  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!handlebars.helpers['formatStandard']) {
    handlebars.registerHelper('formatStandard', (value: unknown) => String(value ?? ''));
  }
});

function renderScanProgress(scan: Record<string, unknown>, locale = 'en'): string {
  const source = readFileSync(join(VIEWS_DIR, 'scan-progress.hbs'), 'utf8');
  const template = handlebars.compile(source);
  return template({ scan, locale });
}

/**
 * Renders the page in jsdom with `runScripts: 'dangerously'` so the page's
 * OWN inline <script> executes for real. `beforeParse` installs a stub
 * EventSource on the window BEFORE that script runs (avoiding a
 * `ReferenceError: EventSource is not defined` on the real parse-time
 * execution), and records every `addEventListener` handler it registers.
 */
function renderRunning(scan: Record<string, unknown>, locale = 'en'): {
  win: Window & typeof globalThis;
  listeners: Record<string, Array<(evt: { data: string }) => void>>;
} {
  const html = renderScanProgress(scan, locale);
  const listeners: Record<string, Array<(evt: { data: string }) => void>> = {};
  class StubEventSource {
    addEventListener(type: string, handler: (evt: { data: string }) => void): void {
      (listeners[type] ??= []).push(handler);
    }
    close(): void {}
  }
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      (window as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    },
  });
  return { win: dom.window, listeners };
}

describe('scan-progress.hbs — discovery-blocked banner (WAF-SURFACE-1)', () => {
  it('progress page shows the warning for a completed flagged scan', () => {
    const html = renderScanProgress({
      id: 'scan-1',
      status: 'completed',
      pagesScanned: 1,
      discoveryWarning: 'waf-blocked',
    });
    const match = html.match(/<div\s+id="discovery-blocked"[^>]*>([\s\S]*?)<\/div>/);
    expect(match).toBeTruthy();
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    expect(openTag).not.toContain('is-hidden');
    expect(match![1]).toContain('Scanned 1 page(s); site discovery was blocked by bot protection');
  });

  it('progress page keeps the warning hidden for an unflagged scan', () => {
    const html = renderScanProgress({
      id: 'scan-2',
      status: 'completed',
      pagesScanned: 1,
    });
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/);
    expect(openTag).toBeTruthy();
    expect(openTag![0]).toContain('is-hidden');
    const match = html.match(/<div\s+id="discovery-blocked"[^>]*>([\s\S]*?)<\/div>/);
    expect(match![1]).not.toContain('Scanned 1 page');
  });

  it('live template holds the untranslated count placeholder in an attribute', () => {
    const html = renderScanProgress({
      id: 'scan-3',
      status: 'completed',
      pagesScanned: 1,
    });
    const placeholder = ['{{', 'pages', '}}'].join('');
    const openTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    expect(openTag).toContain(`data-template="`);
    expect(openTag).toContain(placeholder);
  });

  it('complete listener reveals the warning from the event', () => {
    const html = renderScanProgress({
      id: 'scan-4',
      status: 'running',
      pagesScanned: 0,
    });
    expect(html).toContain('discoveryWarning');
    expect(html).toContain('data-template');
  });
});

describe('scan-progress.hbs — browser discovery banner (WAF-BROWSER-2)', () => {
  it('P1: progress page shows the browser discovery note for a completed browser discovered scan', () => {
    const html = renderScanProgress({
      id: 'scan-5',
      status: 'completed',
      pagesScanned: 7,
      discoveryWarning: 'waf-browser-discovery',
    });
    const openTag = html.match(/<div\s+id="discovery-browser"[^>]*>/)![0];
    expect(openTag).not.toContain('is-hidden');
    const match = html.match(/<div\s+id="discovery-browser"[^>]*>([\s\S]*?)<\/div>/);
    expect(match![1]).toContain('Scanned 7 page(s)');
    expect(match![1]).toContain('headless browser');
  });

  it('P2: progress page keeps both discovery notes hidden for an unflagged scan', () => {
    const html = renderScanProgress({
      id: 'scan-6',
      status: 'completed',
      pagesScanned: 1,
    });
    const blockedTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    const browserTag = html.match(/<div\s+id="discovery-browser"[^>]*>/)![0];
    expect(blockedTag).toContain('is-hidden');
    expect(browserTag).toContain('is-hidden');
  });

  it('P3: progress page does not show the blocked warning for a browser discovered scan', () => {
    const html = renderScanProgress({
      id: 'scan-7',
      status: 'completed',
      pagesScanned: 7,
      discoveryWarning: 'waf-browser-discovery',
    });
    const blockedTag = html.match(/<div\s+id="discovery-blocked"[^>]*>/)![0];
    expect(blockedTag).toContain('is-hidden');
    const match = html.match(/<div\s+id="discovery-blocked"[^>]*>([\s\S]*?)<\/div>/);
    expect(match![1]).not.toContain('Scanned 7 page');
  });

  it('P4: complete listener reveals the browser discovery note from the event', () => {
    const { win, listeners } = renderRunning({ id: 'scan-8', status: 'running', pagesScanned: 0 });

    const completeHandlers = listeners['complete'] ?? [];
    expect(completeHandlers.length).toBeGreaterThan(0);
    completeHandlers[0]({
      data: JSON.stringify({
        type: 'complete',
        data: { pagesScanned: 7, discoveryWarning: 'waf-browser-discovery', reportUrl: '/reports/x' },
      }),
    });

    const discoveryBrowserEl = win.document.getElementById('discovery-browser')!;
    const discoveryBlockedEl = win.document.getElementById('discovery-blocked')!;
    expect(discoveryBrowserEl.classList.contains('is-hidden')).toBe(false);
    expect(discoveryBrowserEl.textContent).toContain('7');
    expect(discoveryBlockedEl.classList.contains('is-hidden')).toBe(true);
  });

  it('P5: complete listener reveals the blocked warning and not the browser note', () => {
    const { win, listeners } = renderRunning({ id: 'scan-9', status: 'running', pagesScanned: 0 });

    const completeHandlers = listeners['complete'] ?? [];
    completeHandlers[0]({
      data: JSON.stringify({
        type: 'complete',
        data: { pagesScanned: 1, discoveryWarning: 'waf-blocked', reportUrl: '/reports/x' },
      }),
    });

    const discoveryBrowserEl = win.document.getElementById('discovery-browser')!;
    const discoveryBlockedEl = win.document.getElementById('discovery-blocked')!;
    expect(discoveryBlockedEl.classList.contains('is-hidden')).toBe(false);
    expect(discoveryBrowserEl.classList.contains('is-hidden')).toBe(true);
  });
});

describe('scan-progress.hbs — live discovery progress (DISCOVERY-PROGRESS-1)', () => {
  function fire(
    listeners: Record<string, Array<(evt: { data: string }) => void>>,
    type: string,
    data: Record<string, unknown>,
  ): void {
    const handlers = listeners[type] ?? [];
    expect(handlers.length, `no ${type} listener registered`).toBeGreaterThan(0);
    for (const h of handlers) h({ data: JSON.stringify({ type, data }) });
  }

  it('LP1: the status banner carries one untranslated count template per discovery phase', () => {
    const html = renderScanProgress({ id: 'scan-lp1', status: 'running', pagesScanned: 0 });
    const openTag = html.match(/<div\s+id="scan-status"[^>]*>/)![0];
    const placeholder = ['{{', 'count', '}}'].join('');
    for (const attr of ['data-discovering-sitemap', 'data-discovering-crawl', 'data-discovering-browser']) {
      const m = openTag.match(new RegExp(`${attr}="([^"]*)"`));
      expect(m, `missing ${attr}`).toBeTruthy();
      expect(m![1]).toContain(placeholder);
    }
  });

  it('LP2: a browser-fallback progress event shows the live count and method', () => {
    const { win, listeners } = renderRunning({ id: 'scan-lp2', status: 'running', pagesScanned: 0 });
    fire(listeners, 'discovery_progress', { pagesFound: 12, discoveryPhase: 'browser' });
    const status = win.document.getElementById('status-text')!.textContent!.trim();
    expect(status).toBe('Discovering pages\u2026 12 found (browser fallback)');
    expect(win.document.getElementById('pages-discovered')!.textContent).toBe('12');
  });

  it('LP3: later events update the count in place', () => {
    const { win, listeners } = renderRunning({ id: 'scan-lp3', status: 'running', pagesScanned: 0 });
    fire(listeners, 'discovery_progress', { pagesFound: 1, discoveryPhase: 'crawl' });
    expect(win.document.getElementById('status-text')!.textContent).toContain('1 found (crawl)');
    fire(listeners, 'discovery_progress', { pagesFound: 20, discoveryPhase: 'browser' });
    expect(win.document.getElementById('status-text')!.textContent).toContain('20 found (browser fallback)');
    expect(win.document.getElementById('pages-discovered')!.textContent).toBe('20');
  });

  it('LP4: once scanning starts the scanning display wins and a late progress event is ignored', () => {
    const { win, listeners } = renderRunning({ id: 'scan-lp4', status: 'running', pagesScanned: 0 });
    fire(listeners, 'discovery_progress', { pagesFound: 5, discoveryPhase: 'browser' });
    fire(listeners, 'discovery', { pagesDiscovered: 8 });
    const scanning = win.document.getElementById('status-text')!.textContent;
    expect(scanning).not.toContain('found (browser fallback)');
    expect(scanning).toContain('8');
    fire(listeners, 'discovery_progress', { pagesFound: 6, discoveryPhase: 'browser' });
    expect(win.document.getElementById('status-text')!.textContent).toBe(scanning);
    expect(win.document.getElementById('pages-discovered')!.textContent).toBe('8');
  });

  it('LP5: an unknown phase or a non-numeric count changes nothing', () => {
    const { win, listeners } = renderRunning({ id: 'scan-lp5', status: 'running', pagesScanned: 0 });
    const before = win.document.getElementById('status-text')!.textContent;
    fire(listeners, 'discovery_progress', { pagesFound: 3, discoveryPhase: 'teleport' });
    fire(listeners, 'discovery_progress', { pagesFound: '<b>x</b>', discoveryPhase: 'crawl' });
    expect(win.document.getElementById('status-text')!.textContent).toBe(before);
  });

  it('LP6: a non-English locale renders its own sentence, entity-decoded', () => {
    const { win, listeners } = renderRunning({ id: 'scan-lp6', status: 'running', pagesScanned: 0 }, 'it');
    fire(listeners, 'discovery_progress', { pagesFound: 4, discoveryPhase: 'browser' });
    const status = win.document.getElementById('status-text')!.textContent!;
    expect(status).toContain('4');
    expect(status).not.toContain('found (browser fallback)');
    expect(status).not.toMatch(/&#x27;|&amp;|&quot;/);
  });
});
