import type { Browser, Page } from 'puppeteer-core';
import { mapAxeRulesToWcagRules, type WcagRule, type AxeRuleMetadata } from './rule-mapper.js';

// ---------------------------------------------------------------------------
// Local interface definitions (compatible with dashboard's ScannerPlugin)
// ---------------------------------------------------------------------------

export interface ScannerIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

export interface PageResult {
  readonly url: string;
  readonly html: string;
  readonly issues: readonly ScannerIssue[];
}

// ---------------------------------------------------------------------------
// axe-core result types (subset we use)
// ---------------------------------------------------------------------------

interface AxeNode {
  readonly target: readonly string[];
  readonly html: string;
}

interface AxeViolation {
  readonly id: string;
  readonly impact?: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  readonly help: string;
  readonly nodes: readonly AxeNode[];
}

interface AxeResults {
  readonly violations: readonly AxeViolation[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AxeScannerConfig {
  readonly browserPath?: string;
  readonly headless: boolean;
  readonly timeout: number;
  readonly standard: 'wcag2a' | 'wcag2aa' | 'wcag2aaa';
}

// ---------------------------------------------------------------------------
// Impact → severity mapping
// ---------------------------------------------------------------------------

export function mapImpactToSeverity(
  impact: string | null | undefined,
): 'error' | 'warning' | 'notice' {
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'error';
    case 'moderate':
      return 'warning';
    case 'minor':
      return 'notice';
    default:
      return 'warning';
  }
}

// ---------------------------------------------------------------------------
// Map axe violations to ScannerIssue[]
// ---------------------------------------------------------------------------

export function mapViolationsToIssues(
  violations: readonly AxeViolation[],
): readonly ScannerIssue[] {
  const issues: ScannerIssue[] = [];

  for (const violation of violations) {
    for (const node of violation.nodes) {
      issues.push({
        code: violation.id,
        type: mapImpactToSeverity(violation.impact),
        message: violation.help,
        selector: node.target[0] ?? '',
        context: node.html,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Build axe.run() tag filter from standard config
// ---------------------------------------------------------------------------

function getAxeRunTags(standard: 'wcag2a' | 'wcag2aa' | 'wcag2aaa'): string[] {
  switch (standard) {
    case 'wcag2a':
      return ['wcag2a', 'wcag21a'];
    case 'wcag2aa':
      return ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    case 'wcag2aaa':
      return ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  }
}

// ---------------------------------------------------------------------------
// AxeScanner class
// ---------------------------------------------------------------------------

export class AxeScanner {
  private browser: Browser | null = null;
  private readonly config: AxeScannerConfig;
  private cachedRules: readonly WcagRule[] = [];

  constructor(config: AxeScannerConfig) {
    this.config = config;
  }

  get rules(): readonly WcagRule[] {
    return this.cachedRules;
  }

  async initialize(): Promise<void> {
    const puppeteer = await import('puppeteer-core');

    const launchOptions: Record<string, unknown> = {
      headless: this.config.headless,
    };

    if (this.config.browserPath) {
      launchOptions['executablePath'] = this.config.browserPath;
    }

    this.browser = await puppeteer.default.launch(launchOptions);

    // Load axe-core rule metadata to build WcagRule list
    await this.loadRuleMetadata();
  }

  private async loadRuleMetadata(): Promise<void> {
    const axeCore = await import('axe-core');
    const axe = axeCore.default ?? axeCore;

    const rawRules = axe.getRules() as Array<{
      ruleId: string;
      description: string;
      tags: string[];
    }>;

    const metadata: AxeRuleMetadata[] = rawRules.map((r) => ({
      ruleId: r.ruleId,
      description: r.description,
      tags: r.tags,
    }));

    this.cachedRules = mapAxeRulesToWcagRules(metadata);
  }

  async evaluate(page: PageResult): Promise<readonly ScannerIssue[]> {
    if (!this.browser) {
      throw new Error('Scanner not initialized — call initialize() first');
    }

    let browserPage: Page | null = null;

    try {
      browserPage = await this.browser.newPage();
      browserPage.setDefaultNavigationTimeout(this.config.timeout);

      await browserPage.goto(page.url, { waitUntil: 'load' });

      // Inject axe-core source into the page
      const axeCore = await import('axe-core');
      const axe = axeCore.default ?? axeCore;
      const axeSource: string = axe.source;

      await browserPage.evaluate(axeSource);

      // Run axe with tag filtering based on the configured standard
      const tags = getAxeRunTags(this.config.standard);

      const results = await browserPage.evaluate(
        (runTags: string[]) => {
          // axe is now available in the page context via the injected source
          const w = globalThis as unknown as { axe: { run: (options: unknown) => Promise<unknown> } };
          return w.axe.run({
            runOnly: { type: 'tag', values: runTags },
          });
        },
        tags,
      ) as AxeResults;

      return mapViolationsToIssues(results.violations);
    } finally {
      if (browserPage) {
        await browserPage.close();
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
