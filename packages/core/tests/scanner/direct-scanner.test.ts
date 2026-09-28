import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';
import { CHROMIUM_LAUNCH_ARGS } from '../../src/browser/launch.js';
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

describe('DirectScanner', () => {
  let scanner: DirectScanner;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('DS1: passes the resolved browser and the shared flags to pa11y', async () => {
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    await scanner.scan('https://example.com', { standard: 'WCAG2AA' });

    expect(pa11yFn).toHaveBeenCalledTimes(1);
    const callArgs = pa11yFn.mock.calls[0];
    expect(callArgs[1].chromeLaunchConfig.executablePath).toBe('/fake/chrome');
    expect(callArgs[1].chromeLaunchConfig.args).toEqual([...CHROMIUM_LAUNCH_ARGS]);
  });

  it('DS2: a missing browser rejects with ChromiumNotFoundError before pa11y runs', async () => {
    mockResolveChromium.mockRejectedValue(new ChromiumNotFoundError(['/fake/one', '/fake/two']));
    const pa11yModule = await import('pa11y');
    const pa11yFn = pa11yModule.default as ReturnType<typeof vi.fn>;

    await expect(scanner.scan('https://example.com', { standard: 'WCAG2AA' })).rejects.toBeInstanceOf(ChromiumNotFoundError);
    expect(pa11yFn).not.toHaveBeenCalled();
  });
});
