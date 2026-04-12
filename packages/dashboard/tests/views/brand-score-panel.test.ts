import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'views');

let template: ReturnType<typeof handlebars.compile>;

beforeAll(async () => {
  const { loadTranslations, t: translateKey } = await import(
    '../../src/i18n/index.js'
  );
  loadTranslations();

  // Register helpers used by brand-score-panel.hbs
  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
  if (!handlebars.helpers['gt']) {
    handlebars.registerHelper(
      'gt',
      (a: unknown, b: unknown) => Number(a) > Number(b),
    );
  }
  if (!handlebars.helpers['gte']) {
    handlebars.registerHelper(
      'gte',
      (a: unknown, b: unknown) => Number(a) >= Number(b),
    );
  }
  if (!handlebars.helpers['cmpPositive']) {
    handlebars.registerHelper(
      'cmpPositive',
      (n: number) => typeof n === 'number' && n > 0,
    );
  }
  if (!handlebars.helpers['cmpNegative']) {
    handlebars.registerHelper(
      'cmpNegative',
      (n: number) => typeof n === 'number' && n < 0,
    );
  }
  if (!handlebars.helpers['brandScoreClass']) {
    handlebars.registerHelper('brandScoreClass', (value: unknown) => {
      const n = Number(value);
      if (Number.isNaN(n)) return '';
      if (n >= 85) return 'progress-bar__fill--success';
      if (n >= 70) return 'progress-bar__fill--warning';
      return 'progress-bar__fill--error';
    });
  }
  if (!handlebars.helpers['brandScoreBadge']) {
    handlebars.registerHelper('brandScoreBadge', (value: unknown) => {
      const n = Number(value);
      if (Number.isNaN(n)) return 'badge--neutral';
      if (n >= 85) return 'badge--success';
      if (n >= 70) return 'badge--warning';
      return 'badge--error';
    });
  }
  if (!handlebars.helpers['unscorable-reason-label']) {
    handlebars.registerHelper('unscorable-reason-label', (reason: unknown) => {
      const labels: Record<string, string> = {
        'no-guideline': 'No brand guideline linked',
        'empty-guideline': 'Brand guideline has no rules',
        'no-branded-issues': 'No branded issues found in this scan',
        'no-typography-data': 'No typography data available',
        'no-component-tokens': 'No component token data available',
        'all-subs-unscorable': 'Insufficient data to compute a score',
      };
      return typeof reason === 'string'
        ? (labels[reason] ?? String(reason))
        : 'Score not available';
    });
  }
  if (!handlebars.helpers['t']) {
    handlebars.registerHelper('t', function (
      key: string,
      options: {
        hash?: Record<string, unknown>;
        data?: { root?: { locale?: string } };
      },
    ) {
      const locale = (options?.data?.root?.locale ?? 'en') as 'en';
      const params: Record<string, string> = {};
      if (options?.hash) {
        for (const [k, v] of Object.entries(options.hash)) params[k] = String(v);
      }
      return translateKey(key, locale, params);
    });
  }

  // Compile the partial under test
  const source = readFileSync(
    join(VIEWS_DIR, 'partials', 'brand-score-panel.hbs'),
    'utf8',
  );
  template = handlebars.compile(source);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const scoredResult = {
  kind: 'scored' as const,
  overall: 72,
  color: {
    kind: 'scored' as const,
    value: 85,
    detail: { dimension: 'color' as const, passes: 17, fails: 3 },
  },
  typography: {
    kind: 'scored' as const,
    value: 67,
    detail: {
      dimension: 'typography' as const,
      fontOk: true,
      sizeOk: true,
      lineHeightOk: false,
    },
  },
  components: {
    kind: 'scored' as const,
    value: 50,
    detail: { dimension: 'components' as const, matched: 5, total: 10 },
  },
  coverage: {
    color: true,
    typography: true,
    components: true,
    contributingWeight: 1.0,
  },
};

const scoredWithUnscorableSub = {
  kind: 'scored' as const,
  overall: 78,
  color: {
    kind: 'scored' as const,
    value: 90,
    detail: { dimension: 'color' as const, passes: 9, fails: 1 },
  },
  typography: {
    kind: 'unscorable' as const,
    reason: 'no-typography-data' as const,
  },
  components: {
    kind: 'scored' as const,
    value: 60,
    detail: { dimension: 'components' as const, matched: 6, total: 10 },
  },
  coverage: {
    color: true,
    typography: false,
    components: true,
    contributingWeight: 0.7,
  },
};

const unscorableResult = {
  kind: 'unscorable' as const,
  reason: 'no-guideline' as const,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderPanel(ctx: Record<string, unknown>): string {
  return template(ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('brand-score-panel.hbs', () => {
  // Test 1: Pitfall #8 -- null brandScore (pre-v2.11.0)
  it('renders empty-state for null brandScore (Pitfall #8)', () => {
    const html = renderPanel({ brandScore: null });
    expect(html).toContain('not available');
    expect(html).toContain('v2.11.0');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('progress-bar__fill');
  });

  // Test 2: D-06 -- unscorable brandScore
  it('renders reason label for unscorable brandScore (D-06)', () => {
    const html = renderPanel({ brandScore: unscorableResult });
    expect(html).toContain('No brand guideline linked');
    expect(html).not.toContain('progress-bar__fill');
    expect(html).not.toContain('0/100');
    expect(html).not.toContain('0%');
  });

  // Test 3: scored -- renders composite + 3 subs
  it('renders overall score and 3 sub-score progress bars for scored result', () => {
    const html = renderPanel({
      brandScore: scoredResult,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 5,
      totalIssues: 20,
    });
    expect(html).toContain('72');
    expect(html).toContain('/100');
    expect((html.match(/progress-bar__fill /g) ?? []).length).toBe(3);
    expect(html).toContain('Color contrast');
    expect(html).toContain('Typography');
    expect(html).toContain('Components');
  });

  // Test 4: delta positive
  it('renders upward arrow and positive delta', () => {
    const html = renderPanel({
      brandScore: scoredResult,
      brandDelta: 5,
      brandIsFirstScore: false,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(html).toContain('+5');
    expect(html).toContain('text--success');
  });

  // Test 5: delta negative
  it('renders downward arrow and negative delta', () => {
    const html = renderPanel({
      brandScore: scoredResult,
      brandDelta: -3,
      brandIsFirstScore: false,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(html).toContain('-3');
    expect(html).toContain('text--error');
  });

  // Test 6: first score
  it('renders "First brand score" when brandIsFirstScore is true', () => {
    const html = renderPanel({
      brandScore: scoredResult,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(html).toContain('First brand score');
  });

  // Test 7: BSTORE-05 -- issue counter
  it('renders "X of Y issues" counter (BSTORE-05)', () => {
    const html = renderPanel({
      brandScore: scoredResult,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 5,
      totalIssues: 20,
    });
    expect(html).toContain('5');
    expect(html).toContain('20');
    expect(html).toContain('brand elements');
  });

  // Test 8: D-06 nested -- unscorable sub inside scored result
  it('renders unscorable sub reason without progress bar (D-06 nested)', () => {
    const html = renderPanel({
      brandScore: scoredWithUnscorableSub,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(html).toContain('No typography data available');
    // 2 progress bars (color + components), NOT 3
    expect((html.match(/progress-bar__fill /g) ?? []).length).toBe(2);
  });

  // Test 9: color banding via brandScoreBadge
  it('applies correct color band classes', () => {
    // overall=90 -> success
    const highScore = { ...scoredResult, overall: 90 };
    const htmlHigh = renderPanel({
      brandScore: highScore,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(htmlHigh).toContain('badge--success');

    // overall=75 -> warning
    const midScore = { ...scoredResult, overall: 75 };
    const htmlMid = renderPanel({
      brandScore: midScore,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(htmlMid).toContain('badge--warning');

    // overall=50 -> error
    const lowScore = { ...scoredResult, overall: 50 };
    const htmlLow = renderPanel({
      brandScore: lowScore,
      brandDelta: null,
      brandIsFirstScore: true,
      brandRelatedCount: 0,
      totalIssues: 0,
    });
    expect(htmlLow).toContain('badge--error');
  });
});
