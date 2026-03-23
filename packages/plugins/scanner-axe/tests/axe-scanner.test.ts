import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mapImpactToSeverity,
  mapViolationsToIssues,
  AxeScanner,
  type PageResult,
} from '../src/axe-scanner.js';
import {
  parseWcagTag,
  parseWcagLevel,
  mapAxeRulesToWcagRules,
  buildRuleIdToCriterionMap,
  type AxeRuleMetadata,
} from '../src/rule-mapper.js';

// ---------------------------------------------------------------------------
// rule-mapper: parseWcagTag
// ---------------------------------------------------------------------------

describe('parseWcagTag', () => {
  it('parses "wcag111" to "1.1.1"', () => {
    expect(parseWcagTag('wcag111')).toBe('1.1.1');
  });

  it('parses "wcag143" to "1.4.3"', () => {
    expect(parseWcagTag('wcag143')).toBe('1.4.3');
  });

  it('parses "wcag211" to "2.1.1"', () => {
    expect(parseWcagTag('wcag211')).toBe('2.1.1');
  });

  it('parses "wcag311" to "3.1.1"', () => {
    expect(parseWcagTag('wcag311')).toBe('3.1.1');
  });

  it('returns null for level tags like "wcag2a"', () => {
    expect(parseWcagTag('wcag2a')).toBeNull();
  });

  it('returns null for level tags like "wcag2aa"', () => {
    expect(parseWcagTag('wcag2aa')).toBeNull();
  });

  it('returns null for non-wcag tags', () => {
    expect(parseWcagTag('best-practice')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseWcagTag('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rule-mapper: parseWcagLevel
// ---------------------------------------------------------------------------

describe('parseWcagLevel', () => {
  it('returns "A" for tags with only wcag2a', () => {
    expect(parseWcagLevel(['wcag2a', 'wcag111'])).toBe('A');
  });

  it('returns "AA" for tags with wcag2aa', () => {
    expect(parseWcagLevel(['wcag2a', 'wcag2aa', 'wcag143'])).toBe('AA');
  });

  it('returns "AAA" for tags with wcag2aaa', () => {
    expect(parseWcagLevel(['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag145'])).toBe('AAA');
  });

  it('returns "AA" for wcag21aa tags', () => {
    expect(parseWcagLevel(['wcag21aa', 'wcag135'])).toBe('AA');
  });

  it('returns "A" when no level tags present', () => {
    expect(parseWcagLevel(['best-practice'])).toBe('A');
  });
});

// ---------------------------------------------------------------------------
// rule-mapper: mapAxeRulesToWcagRules
// ---------------------------------------------------------------------------

describe('mapAxeRulesToWcagRules', () => {
  const sampleRules: AxeRuleMetadata[] = [
    { ruleId: 'image-alt', description: 'Images must have alternate text', tags: ['wcag2a', 'wcag111'] },
    { ruleId: 'color-contrast', description: 'Elements must have sufficient color contrast', tags: ['wcag2aa', 'wcag143'] },
    { ruleId: 'best-practice-rule', description: 'A best practice', tags: ['best-practice'] },
  ];

  it('maps rules with WCAG criterion tags', () => {
    const result = mapAxeRulesToWcagRules(sampleRules);
    expect(result).toHaveLength(2);
  });

  it('correctly extracts criterion code', () => {
    const result = mapAxeRulesToWcagRules(sampleRules);
    expect(result[0].code).toBe('1.1.1');
    expect(result[1].code).toBe('1.4.3');
  });

  it('correctly determines level', () => {
    const result = mapAxeRulesToWcagRules(sampleRules);
    expect(result[0].level).toBe('A');
    expect(result[1].level).toBe('AA');
  });

  it('excludes rules without WCAG tags', () => {
    const result = mapAxeRulesToWcagRules(sampleRules);
    const codes = result.map((r) => r.code);
    expect(codes).not.toContain('best-practice-rule');
  });

  it('returns empty array for empty input', () => {
    expect(mapAxeRulesToWcagRules([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// rule-mapper: buildRuleIdToCriterionMap
// ---------------------------------------------------------------------------

describe('buildRuleIdToCriterionMap', () => {
  it('maps rule IDs to criterion codes', () => {
    const rules: AxeRuleMetadata[] = [
      { ruleId: 'image-alt', description: 'alt text', tags: ['wcag2a', 'wcag111'] },
      { ruleId: 'label', description: 'labels', tags: ['wcag2a', 'wcag412'] },
    ];

    const map = buildRuleIdToCriterionMap(rules);
    expect(map.get('image-alt')).toBe('1.1.1');
    expect(map.get('label')).toBe('4.1.2');
  });

  it('skips rules without criterion tags', () => {
    const rules: AxeRuleMetadata[] = [
      { ruleId: 'skip-link', description: 'skip link', tags: ['best-practice'] },
    ];

    const map = buildRuleIdToCriterionMap(rules);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// axe-scanner: mapImpactToSeverity
// ---------------------------------------------------------------------------

describe('mapImpactToSeverity', () => {
  it('maps "critical" to "error"', () => {
    expect(mapImpactToSeverity('critical')).toBe('error');
  });

  it('maps "serious" to "error"', () => {
    expect(mapImpactToSeverity('serious')).toBe('error');
  });

  it('maps "moderate" to "warning"', () => {
    expect(mapImpactToSeverity('moderate')).toBe('warning');
  });

  it('maps "minor" to "notice"', () => {
    expect(mapImpactToSeverity('minor')).toBe('notice');
  });

  it('maps null to "warning"', () => {
    expect(mapImpactToSeverity(null)).toBe('warning');
  });

  it('maps undefined to "warning"', () => {
    expect(mapImpactToSeverity(undefined)).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// axe-scanner: mapViolationsToIssues
// ---------------------------------------------------------------------------

describe('mapViolationsToIssues', () => {
  it('converts violations with nodes to ScannerIssue[]', () => {
    const violations = [
      {
        id: 'image-alt',
        impact: 'critical' as const,
        help: 'Images must have alternate text',
        nodes: [
          { target: ['img.hero'], html: '<img class="hero" src="photo.jpg">' },
          { target: ['img.logo'], html: '<img class="logo" src="logo.png">' },
        ],
      },
    ];

    const issues = mapViolationsToIssues(violations);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({
      code: 'image-alt',
      type: 'error',
      message: 'Images must have alternate text',
      selector: 'img.hero',
      context: '<img class="hero" src="photo.jpg">',
    });
  });

  it('handles violations with different impacts', () => {
    const violations = [
      {
        id: 'color-contrast',
        impact: 'moderate' as const,
        help: 'Ensure sufficient contrast',
        nodes: [{ target: ['.text'], html: '<p class="text">Hello</p>' }],
      },
      {
        id: 'link-name',
        impact: 'minor' as const,
        help: 'Links must have discernible text',
        nodes: [{ target: ['a.nav'], html: '<a class="nav"></a>' }],
      },
    ];

    const issues = mapViolationsToIssues(violations);
    expect(issues).toHaveLength(2);
    expect(issues[0].type).toBe('warning');
    expect(issues[1].type).toBe('notice');
  });

  it('returns empty array for no violations', () => {
    expect(mapViolationsToIssues([])).toHaveLength(0);
  });

  it('handles nodes with empty target array', () => {
    const violations = [
      {
        id: 'test-rule',
        impact: 'serious' as const,
        help: 'Test help',
        nodes: [{ target: [] as string[], html: '<div></div>' }],
      },
    ];

    const issues = mapViolationsToIssues(violations);
    expect(issues[0].selector).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AxeScanner: browser lifecycle and evaluate
// ---------------------------------------------------------------------------

describe('AxeScanner', () => {
  const mockPage = {
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock puppeteer-core
    vi.doMock('puppeteer-core', () => ({
      default: {
        launch: vi.fn().mockResolvedValue(mockBrowser),
      },
    }));

    // Mock axe-core
    vi.doMock('axe-core', () => ({
      default: {
        source: 'window.axe = { run: function() {} };',
        getRules: vi.fn().mockReturnValue([
          { ruleId: 'image-alt', description: 'Images must have alt text', tags: ['wcag2a', 'wcag111'] },
          { ruleId: 'color-contrast', description: 'Color contrast', tags: ['wcag2aa', 'wcag143'] },
        ]),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('launches browser on initialize', async () => {
    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();

    const puppeteer = await import('puppeteer-core');
    expect(puppeteer.default.launch).toHaveBeenCalledWith({ headless: true });

    await scanner.close();
  });

  it('passes browserPath as executablePath', async () => {
    const scanner = new AxeScanner({
      browserPath: '/usr/bin/chromium',
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();

    const puppeteer = await import('puppeteer-core');
    expect(puppeteer.default.launch).toHaveBeenCalledWith({
      headless: true,
      executablePath: '/usr/bin/chromium',
    });

    await scanner.close();
  });

  it('loads WCAG rules on initialize', async () => {
    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    expect(scanner.rules).toHaveLength(0);
    await scanner.initialize();
    expect(scanner.rules.length).toBeGreaterThan(0);
    expect(scanner.rules[0].code).toBe('1.1.1');

    await scanner.close();
  });

  it('closes browser on close()', async () => {
    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();
    await scanner.close();

    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  it('close() is safe to call when not initialized', async () => {
    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    // Should not throw
    await scanner.close();
  });

  it('throws if evaluate called before initialize', async () => {
    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    const page: PageResult = { url: 'https://example.com', html: '', issues: [] };
    await expect(scanner.evaluate(page)).rejects.toThrow('Scanner not initialized');
  });

  it('evaluates a page and returns issues', async () => {
    const axeResults = {
      violations: [
        {
          id: 'image-alt',
          impact: 'critical',
          help: 'Images must have alternate text',
          nodes: [
            { target: ['img.hero'], html: '<img class="hero" src="photo.jpg">' },
          ],
        },
      ],
    };

    // evaluate is called twice: once for injecting axe source, once for running
    mockPage.evaluate
      .mockResolvedValueOnce(undefined) // inject axe source
      .mockResolvedValueOnce(axeResults); // axe.run()

    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();

    const page: PageResult = { url: 'https://example.com', html: '<html></html>', issues: [] };
    const issues = await scanner.evaluate(page);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      code: 'image-alt',
      type: 'error',
      message: 'Images must have alternate text',
      selector: 'img.hero',
      context: '<img class="hero" src="photo.jpg">',
    });

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'load' });
    expect(mockPage.close).toHaveBeenCalled();

    await scanner.close();
  });

  it('sets navigation timeout from config', async () => {
    mockPage.evaluate
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ violations: [] });

    const scanner = new AxeScanner({
      headless: true,
      timeout: 15000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();

    const page: PageResult = { url: 'https://example.com', html: '', issues: [] };
    await scanner.evaluate(page);

    expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(15000);

    await scanner.close();
  });

  it('closes page even when evaluate throws', async () => {
    mockPage.evaluate.mockRejectedValueOnce(new Error('Navigation timeout'));

    const scanner = new AxeScanner({
      headless: true,
      timeout: 30000,
      standard: 'wcag2aa',
    });

    await scanner.initialize();

    const page: PageResult = { url: 'https://example.com', html: '', issues: [] };
    await expect(scanner.evaluate(page)).rejects.toThrow('Navigation timeout');

    expect(mockPage.close).toHaveBeenCalled();

    await scanner.close();
  });
});

// ---------------------------------------------------------------------------
// Plugin factory (index.ts)
// ---------------------------------------------------------------------------

describe('createPlugin factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.doMock('puppeteer-core', () => ({
      default: {
        launch: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockResolvedValue({
            setDefaultNavigationTimeout: vi.fn(),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
              .mockResolvedValueOnce(undefined)
              .mockResolvedValueOnce({ violations: [] }),
            close: vi.fn().mockResolvedValue(undefined),
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    }));

    vi.doMock('axe-core', () => ({
      default: {
        source: 'window.axe = {};',
        getRules: vi.fn().mockReturnValue([
          { ruleId: 'image-alt', description: 'alt text', tags: ['wcag2a', 'wcag111'] },
        ]),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads manifest with correct name and type', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    expect(plugin.manifest.name).toBe('scanner-axe');
    expect(plugin.manifest.type).toBe('scanner');
    expect(plugin.manifest.version).toBe('1.0.0');
  });

  it('has empty rules before activation', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    expect(plugin.rules).toHaveLength(0);
  });

  it('healthCheck returns false before activation', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    expect(await plugin.healthCheck()).toBe(false);
  });

  it('healthCheck returns true after activation', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    await plugin.activate({});
    expect(await plugin.healthCheck()).toBe(true);

    await plugin.deactivate();
  });

  it('healthCheck returns false after deactivation', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    await plugin.activate({});
    await plugin.deactivate();
    expect(await plugin.healthCheck()).toBe(false);
  });

  it('throws when evaluating before activation', async () => {
    const { default: createPlugin } = await import('../src/index.js');
    const plugin = createPlugin();

    const page = { url: 'https://example.com', html: '', issues: [] };
    await expect(plugin.evaluate(page)).rejects.toThrow('Plugin has not been activated');
  });
});
