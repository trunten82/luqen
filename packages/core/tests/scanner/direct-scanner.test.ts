import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';
import { ChromiumNotFoundError } from '../../src/browser/resolve.js';

// Mock pa11y module
vi.mock('pa11y', () => ({
  default: vi.fn().mockResolvedValue({
    pageUrl: 'https://example.com',
    issues: [],
  }),
}));

// Partial-mock the shared resolver: real module, resolveChromium overridden
// so tests never touch the real filesystem or a real puppeteer.
const { mockResolveChromium } = vi.hoisted(() => ({
  mockResolveChromium: vi.fn().mockResolvedValue({
    executablePath: '/fake/chrome',
    source: 'system',
    tried: [],
  }),
}));
vi.mock('../../src/browser/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/resolve.js')>();
  return { ...actual, resolveChromium: mockResolveChromium };
});

// ENGINE-SSRF-1: the scanner launches Chromium itself (to install the
// request guard on the page it hands pa11y). A fake browser/page records what
// the scanner does with them, so no real Chromium starts in the unit tier.
type RequestHandler = (request: unknown) => void;
const { mockLaunchChromium, mockSafeCloseBrowser, fakePage, fakeBrowser, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  const fakePage = {
    handlers: [] as Array<(request: unknown) => void>,
    setRequestInterception: vi.fn(async (enabled: boolean) => { calls.push(`intercept:${enabled}`); }),
    on: vi.fn((event: string, handler: (request: unknown) => void) => {
      if (event === 'request') fakePage.handlers.push(handler);
      return fakePage;
    }),
  };
  const fakeBrowser = { newPage: vi.fn(async () => fakePage) };
  return {
    calls,
    fakePage,
    fakeBrowser,
    mockLaunchChromium: vi.fn(async () => fakeBrowser),
    mockSafeCloseBrowser: vi.fn(async () => { calls.push('close'); }),
  };
});
vi.mock('../../src/browser/launch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/browser/launch.js')>();
  return { ...actual, launchChromium: mockLaunchChromium, safeCloseBrowser: mockSafeCloseBrowser };
});

/** A fake intercepted request that records how the guard resolved it. */
function fakeRequest(url: string, headers: Record<string, string> = { 'user-agent': 'UA' }) {
  const outcome: { action?: 'continue' | 'abort'; overrides?: unknown } = {};
  return {
    outcome,
    request: {
      url: () => url,
      headers: () => headers,
      isInterceptResolutionHandled: () => false,
      async continue(overrides?: unknown) { outcome.action = 'continue'; outcome.overrides = overrides; },
      async abort() { outcome.action = 'abort'; },
    },
  };
}

async function dispatch(url: string): Promise<{ action?: string; overrides?: unknown }> {
  const { request, outcome } = fakeRequest(url);
  fakePage.handlers.forEach((h: RequestHandler) => h(request));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return outcome;
}

describe('DirectScanner', () => {
  let scanner: DirectScanner;

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    fakePage.handlers.length = 0;
    mockResolveChromium.mockResolvedValue({
      executablePath: '/fake/chrome',
      source: 'system',
      tried: [],
    });
    scanner = new DirectScanner();
  });

  it('includes actions in the pa11y options', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    const actions = ['wait for element #main to be visible', 'click element #accept'];

    await scanner.scan('https://example.com', {
      standard: 'WCAG2AA',
      actions,
    });

    expect(pa11yFn).toHaveBeenCalledTimes(1);
    const callArgs = pa11yFn.mock.calls[0];
    expect(callArgs[0]).toBe('https://example.com');
    expect(callArgs[1].actions).toEqual([...actions]);
  });

  it('passes empty actions array when actions option is omitted', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    await scanner.scan('https://example.com', {
      standard: 'WCAG2AA',
    });

    expect(pa11yFn).toHaveBeenCalledTimes(1);
    const callArgs = pa11yFn.mock.calls[0];
    expect(callArgs[1].actions).toEqual([]);
  });

  it('returns mapped issues from pa11y result', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    pa11yFn.mockResolvedValueOnce({
      pageUrl: 'https://example.com',
      issues: [
        { code: 'WCAG2AA.H37', type: 'error', message: 'Image missing alt', selector: 'img', context: '<img src="x.jpg">', runner: 'htmlcs' },
      ],
    });

    const result = await scanner.scan('https://example.com', { standard: 'WCAG2AA' });

    expect(result.url).toBe('https://example.com');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual({
      code: 'WCAG2AA.H37',
      type: 'error',
      message: 'Image missing alt',
      selector: 'img',
      context: '<img src="x.jpg">',
      runner: 'htmlcs',
    });
  });

  it('[EVIDENCE] caps axe needs-review (incomplete) results at warning — they are not confirmed violations', async () => {
    // pa11y 9 defaults levelCapWhenNeedsReview to 'error', so every axe "incomplete" result
    // (contrast over a background image, a video that MAY need captions) arrived as an error.
    // Measured 2026-10-08: 43 of 47 such contrast "errors" on a customer site passed or were not painted.
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    await scanner.scan('https://example.com', { standard: 'WCAG2AA', runners: ['htmlcs', 'axe'] });

    expect(pa11yFn.mock.calls[0][1].levelCapWhenNeedsReview).toBe('warning');
  });

  it('[EVIDENCE] drops contrast findings on non-rendered <noscript>/<video> fallback content', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;
    const G18 = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';

    // Shapes from a real customer scan (2026-10-08).
    pa11yFn.mockResolvedValueOnce({
      pageUrl: 'https://example.com',
      issues: [
        { code: G18, type: 'error', message: '1.23:1', selector: '#w > div:nth-child(1) > noscript', context: '<noscript><img class="img-bottles" src="h...</noscript>', runner: 'htmlcs' },
        { code: G18, type: 'error', message: '1.23:1', selector: '#w > div > video', context: '<video controls>...</video>', runner: 'htmlcs' },
        { code: G18, type: 'error', message: '2.1:1', selector: '#w > p', context: '<p>Real text</p>', runner: 'htmlcs' },
      ],
    });

    const result = await scanner.scan('https://example.com', { standard: 'WCAG2AA' });

    expect(result.issues.map((i) => i.selector)).toEqual(['#w > p']);
  });

  it('DS1: launches the resolved browser itself and hands pa11y the browser + a guarded page', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;
    pa11yFn.mockImplementationOnce(async () => { calls.push('pa11y'); return { pageUrl: 'https://example.com', issues: [] }; });

    await scanner.scan('https://example.com', { standard: 'WCAG2AA' });

    // SCAN-EGRESS-PROXY-1: the launch carries the guard its egress proxy enforces.
    expect(mockLaunchChromium).toHaveBeenCalledWith({ executablePath: '/fake/chrome', guard: {} });
    const callArgs = pa11yFn.mock.calls[0];
    expect(callArgs[1].browser).toBe(fakeBrowser);
    expect(callArgs[1].page).toBe(fakePage);
    expect(callArgs[1].chromeLaunchConfig).toBeUndefined();
    // Guard installed BEFORE pa11y navigates; browser closed afterwards.
    expect(calls).toEqual(['intercept:true', 'pa11y', 'close']);
  });

  it('ES1: the guarded page aborts private targets and continues public ones (strict by default)', async () => {
    await scanner.scan('https://example.com', { standard: 'WCAG2AA' });
    expect((await dispatch('http://127.0.0.1:8080/admin')).action).toBe('abort');
    expect((await dispatch('http://10.1.2.3/')).action).toBe('abort');
    expect((await dispatch('data:image/png;base64,AAAA')).action).toBe('continue');
  });

  it('ES2: the constructor guard is the default and a per-scan guard overrides it', async () => {
    await new DirectScanner({ guard: { allowPrivate: true } }).scan('https://example.com', { standard: 'WCAG2AA' });
    expect((await dispatch('http://127.0.0.1:8080/')).action).toBe('continue');

    fakePage.handlers.length = 0;
    await new DirectScanner({ guard: { allowPrivate: true } }).scan('https://example.com', { standard: 'WCAG2AA', guard: {} });
    expect((await dispatch('http://127.0.0.1:8080/')).action).toBe('abort');
    // The egress proxy gets the SAME effective guard as the page interception.
    expect(mockLaunchChromium.mock.calls.map((call) => (call[0] as { guard: unknown }).guard)).toEqual([{ allowPrivate: true }, {}]);
  });

  it('ES3: headers go to the FIRST request only (pa11y parity), never through pa11y\'s own interceptor', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;
    await new DirectScanner({ guard: { allowPrivate: true } })
      .scan('http://127.0.0.1:8080/', { standard: 'WCAG2AA', headers: { 'X-Probe': 'yes' } });

    expect(pa11yFn.mock.calls[0][1].headers).toEqual({});
    const first = await dispatch('http://127.0.0.1:8080/');
    expect(first).toEqual({ action: 'continue', overrides: { headers: { 'user-agent': 'UA', 'x-probe': 'yes' } } });
    const second = await dispatch('http://127.0.0.1:8080/style.css');
    expect(second).toEqual({ action: 'continue', overrides: undefined });
  });

  it('ES4: the browser is closed even when pa11y rejects', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;
    pa11yFn.mockRejectedValueOnce(new Error('net::ERR_BLOCKED_BY_CLIENT'));
    await expect(scanner.scan('https://example.com', { standard: 'WCAG2AA' })).rejects.toThrow('ERR_BLOCKED_BY_CLIENT');
    expect(mockSafeCloseBrowser).toHaveBeenCalledWith(fakeBrowser);
  });

  it('DS2: a missing browser rejects with ChromiumNotFoundError before pa11y runs', async () => {
    mockResolveChromium.mockRejectedValue(new ChromiumNotFoundError(['/fake/one', '/fake/two']));
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    await expect(scanner.scan('https://example.com', { standard: 'WCAG2AA' })).rejects.toBeInstanceOf(ChromiumNotFoundError);
    expect(pa11yFn).not.toHaveBeenCalled();
    expect(mockLaunchChromium).not.toHaveBeenCalled();
  });
});
