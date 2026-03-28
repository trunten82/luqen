import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectScanner } from '../../src/scanner/direct-scanner.js';

// Mock pa11y module
vi.mock('pa11y', () => ({
  default: vi.fn().mockResolvedValue({
    pageUrl: 'https://example.com',
    issues: [],
  }),
}));

// Mock node:fs (existsSync used by findSystemChromium)
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe('DirectScanner', () => {
  let scanner: DirectScanner;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
