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

  // Register helpers used by brand-score-widget.hbs
  if (!handlebars.helpers['eq']) {
    handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
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

  // Compile the widget partial under test
  const source = readFileSync(
    join(VIEWS_DIR, 'partials', 'brand-score-widget.hbs'),
    'utf8',
  );
  template = handlebars.compile(source);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Variant 2: single score (first brand score) */
const singleScore = {
  brandWidget: {
    score: 72,
    delta: null,
    isFirstScore: true,
    sparklinePoints: '',
    sparklineValues: [72],
    scoreCount: 1,
    scoreClass: 'text--warning',
  },
};

/** Variant 3: 2+ scores with sparkline and positive delta */
const multiScorePositive = {
  brandWidget: {
    score: 80,
    delta: 5,
    isFirstScore: false,
    sparklinePoints: '0,38 33.3,20 66.7,10 100,2',
    sparklineValues: [65, 72, 75, 80],
    scoreCount: 4,
    scoreClass: 'text--warning',
  },
};

/** 2+ scores with negative delta */
const multiScoreNegative = {
  brandWidget: {
    score: 65,
    delta: -7,
    isFirstScore: false,
    sparklinePoints: '0,2 100,38',
    sparklineValues: [72, 65],
    scoreCount: 2,
    scoreClass: 'text--error',
  },
};

/** 2+ scores with zero delta */
const multiScoreFlat = {
  brandWidget: {
    score: 75,
    delta: 0,
    isFirstScore: false,
    sparklinePoints: '0,20 100,20',
    sparklineValues: [75, 75],
    scoreCount: 2,
    scoreClass: 'text--warning',
  },
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderWidget(ctx: Record<string, unknown>): string {
  return template(ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('brand-score-widget.hbs', () => {
  // Test 1: null variant (no brandWidget)
  it('renders empty-state when brandWidget is null/undefined', () => {
    const html = renderWidget({});
    expect(html).toContain('No brand scores yet');
    expect(html).toContain('&mdash;');
    expect(html).not.toContain('<polyline');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  // Test 2: single score variant
  it('renders big number only when scoreCount is 1 (first score)', () => {
    const html = renderWidget(singleScore);
    expect(html).toContain('72');
    expect(html).toContain('First brand score');
    expect(html).not.toContain('<polyline');
    expect(html).not.toContain('&#9650;'); // no up arrow
    expect(html).not.toContain('&#9660;'); // no down arrow
  });

  // Test 3: 2+ scores with sparkline
  it('renders sparkline SVG with polyline for 2+ scores', () => {
    const html = renderWidget(multiScorePositive);
    expect(html).toContain('<polyline');
    expect(html).toContain('points="0,38 33.3,20 66.7,10 100,2"');
    expect(html).toContain('80'); // big number
  });

  // Test 4: positive delta
  it('renders green up arrow for positive delta', () => {
    const html = renderWidget(multiScorePositive);
    expect(html).toContain('text--success');
    expect(html).toContain('&#9650;');
    expect(html).toContain('+5');
  });

  // Test 5: negative delta
  it('renders red down arrow for negative delta', () => {
    const html = renderWidget(multiScoreNegative);
    expect(html).toContain('text--error');
    expect(html).toContain('&#9660;');
    expect(html).toContain('-7');
  });

  // Test 6: zero delta
  it('renders flat indicator for zero delta', () => {
    const html = renderWidget(multiScoreFlat);
    expect(html).toContain('&#9644;');
    expect(html).toContain('No change');
  });

  // Test 7: sr-only accessible description
  it('includes sr-only span with sparkline values', () => {
    const html = renderWidget(multiScorePositive);
    expect(html).toContain('sr-only');
    expect(html).toContain('65, 72, 75, 80');
  });

  // Test 8: zero-JS enforcement
  it('never produces script tags in any variant', () => {
    const variants = [
      {}, // null variant
      singleScore,
      multiScorePositive,
    ];
    for (const data of variants) {
      const html = renderWidget(data);
      expect(html).not.toContain('<script');
    }
  });

  // Test 9: responsive SVG
  it('SVG has preserveAspectRatio and container has max-width', () => {
    const html = renderWidget(multiScorePositive);
    expect(html).toContain('preserveAspectRatio');
    expect(html).toContain('max-width');
  });
});
