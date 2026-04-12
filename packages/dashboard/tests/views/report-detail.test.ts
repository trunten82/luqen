import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'views');

// Register the minimal helpers used by report-detail.hbs + rpt-regulation-card.hbs.
// The full template references many helpers (reviewStatusClass, obligationClass, etc.)
// but for the sub-tab / per-regulation tests we only need to exercise the block we added.
beforeAll(async () => {
  const { loadTranslations, t: translateKey } = await import(
    '../../src/i18n/index.js'
  );
  loadTranslations();

  const noopHelpers = [
    'eq',
    'reviewStatusClass',
    'reviewStatusLabelClass',
    'reviewStatusLabel',
    'obligationClass',
    'issueAssignStatus',
    'json',
    'gt',
    'formatStandard',
    'countByType',
    'fixSuggestion',
  ];
  for (const name of noopHelpers) {
    if (!handlebars.helpers[name]) {
      if (name === 'eq') {
        handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
      } else if (name === 'gt') {
        handlebars.registerHelper(
          'gt',
          (a: unknown, b: unknown) => Number(a) > Number(b),
        );
      } else {
        handlebars.registerHelper(name, (...args: unknown[]) => {
          const first = args[0];
          return typeof first === 'string' || typeof first === 'number'
            ? String(first)
            : '';
        });
      }
    }
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

  // Register the partial used by the by-regulation sub-panel.
  if (!handlebars.partials['rpt-regulation-card']) {
    const partialSource = readFileSync(
      join(VIEWS_DIR, 'partials', 'rpt-regulation-card.hbs'),
      'utf8',
    );
    handlebars.registerPartial('rpt-regulation-card', partialSource);
  }

  // Register the brand-score-panel partial (Phase 20).
  if (!handlebars.partials['brand-score-panel']) {
    const bspSource = readFileSync(
      join(VIEWS_DIR, 'partials', 'brand-score-panel.hbs'),
      'utf8',
    );
    handlebars.registerPartial('brand-score-panel', bspSource);
  }

  // Brand score helpers needed by brand-score-panel partial (Phase 20).
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
  if (!handlebars.helpers['gte']) {
    handlebars.registerHelper('gte', (a: unknown, b: unknown) =>
      Number(a) >= Number(b),
    );
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
      return typeof reason === 'string' ? (labels[reason] ?? String(reason)) : 'Score not available';
    });
  }
  if (!handlebars.helpers['cmpPositive']) {
    handlebars.registerHelper('cmpPositive', (n: number) => typeof n === 'number' && n > 0);
  }
  if (!handlebars.helpers['cmpNegative']) {
    handlebars.registerHelper('cmpNegative', (n: number) => typeof n === 'number' && n < 0);
  }
});

function renderReportDetail(reportData: Record<string, unknown>): string {
  const source = readFileSync(join(VIEWS_DIR, 'report-detail.hbs'), 'utf8');
  const template = handlebars.compile(source);
  return template({
    reportData,
    locale: 'en',
    perm: {},
    brandingGuidelineActive: false,
    llmEnabled: false,
    assignedMap: {},
  });
}

const baseReportData = {
  complianceMatrix: [],
  allIssueGroups: [],
  pages: [],
  templateComponents: [],
  summary: { totalIssues: 0 },
  scan: {
    id: 'scan-1',
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    status: 'completed',
    jurisdictions: [],
    regulations: [],
  },
};

describe('report-detail.hbs — regulation sub-tabs', () => {
  it('always renders sub-tab bar, showing empty-state in By Regulation when regulationMatrix is empty', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [],
    });

    // Sub-tab bar is always present so the feature is discoverable on older reports
    expect(html).toContain('subtab-compliance-by-jurisdiction');
    expect(html).toContain('subtab-compliance-by-regulation');
    expect(html).toContain('subpanel-compliance-by-jurisdiction');
    // By Regulation panel is rendered but shows an empty-state message
    expect(html).toContain('subpanel-compliance-by-regulation');
    expect(html).toContain('No regulations selected for this scan');
  });

  it('renders sub-tab bar and regulation cards when regulationMatrix has entries', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [
        {
          regulationId: 'ADA',
          regulationName: 'Americans with Disabilities Act',
          shortName: 'ADA',
          jurisdictionId: 'US-FED',
          status: 'fail',
          mandatoryViolations: 3,
          recommendedViolations: 0,
          optionalViolations: 0,
          violatedRequirements: [
            {
              wcagCriterion: '1.1.1',
              obligation: 'mandatory',
              issueCount: 3,
            },
          ],
        },
      ],
    });

    expect(html).toContain('subtab-compliance-by-jurisdiction');
    expect(html).toContain('subtab-compliance-by-regulation');
    expect(html).toContain('subpanel-compliance-by-regulation');
    // Card content from the partial
    expect(html).toContain('ADA');
    expect(html).toContain('Americans with Disabilities Act');
    expect(html).toContain('1.1.1');
    // Mandatory count rendered
    expect(html).toMatch(/<strong class="rpt-text--fail">3<\/strong>/);
    // i18n "Per-regulation breakdown" heading
    expect(html).toContain('Per-regulation breakdown');
  });

  it('defaults the By Jurisdiction sub-tab to active', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [
        {
          regulationId: 'EAA',
          regulationName: 'European Accessibility Act',
          shortName: 'EAA',
          jurisdictionId: 'EU',
          status: 'pass',
          mandatoryViolations: 0,
        },
      ],
    });

    // Active class is on the By Jurisdiction button
    expect(html).toMatch(
      /id="subtab-compliance-by-jurisdiction"[^>]*rpt-tab--active|class="[^"]*rpt-tab--active[^"]*"[^>]*id="subtab-compliance-by-jurisdiction"/,
    );
    // And aria-selected="true" lives on the By Jurisdiction button, not the By Regulation one
    const byRegBtn = html.match(
      /<button[^>]*id="subtab-compliance-by-regulation"[^>]*>/,
    );
    expect(byRegBtn).toBeTruthy();
    expect(byRegBtn![0]).toContain('aria-selected="false"');

    const byJurBtn = html.match(
      /<button[^>]*id="subtab-compliance-by-jurisdiction"[^>]*>/,
    );
    expect(byJurBtn).toBeTruthy();
    expect(byJurBtn![0]).toContain('aria-selected="true"');
  });

  it('defines the rptSwitchSubTab JS function', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [],
    });
    expect(html).toContain('function rptSwitchSubTab');
  });
});

describe('report-detail.hbs — rptSwitchTab scoping (bug: tab switch hides subpanel)', () => {
  // Regression: rptSwitchTab used to match .rpt-tab-panel globally, including the
  // inner `subpanel-compliance-by-jurisdiction` div. Clicking away to Issues and
  // back hid the compliance content permanently. The fix scopes rptSwitchTab to
  // IDs that start with `panel-` so inner subpanels are never toggled.
  it('rptSwitchTab only toggles panels whose id starts with "panel-"', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [],
    });

    // Extract the function source
    const fnMatch = html.match(/function rptSwitchTab\(tab\)[\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();
    const fnSrc = fnMatch![0];

    // Must guard against non-panel- IDs (subpanel-*, etc.) before toggling --hidden
    expect(fnSrc).toMatch(/p\.id[^]*startsWith\(['"]panel-['"]\)|p\.id[^]*indexOf\(['"]panel-['"]\)\s*===\s*0/);
    // Same guard for tab buttons so sub-tab (subtab-*) highlight survives
    // top-level tab switches
    expect(fnSrc).toMatch(/t\.id[^]*startsWith\(['"]tab-['"]\)|t\.id[^]*indexOf\(['"]tab-['"]\)\s*===\s*0/);
  });
});

describe('rpt-regulation-card.hbs — expandable requirements list', () => {
  // Regression: the By Regulation card rendered violatedRequirements as a fixed
  // list. The existing By Jurisdiction card wraps the same data in
  // <details>/<summary> for collapse/expand. Mirror that pattern.
  function renderCard(data: Record<string, unknown>): string {
    const source = readFileSync(
      join(VIEWS_DIR, 'partials', 'rpt-regulation-card.hbs'),
      'utf8',
    );
    const template = handlebars.compile(source);
    return template(data);
  }

  it('wraps violatedRequirements in a <details> element with a <summary>', () => {
    const html = renderCard({
      regulationId: 'ADA',
      regulationName: 'Americans with Disabilities Act',
      shortName: 'ADA',
      status: 'fail',
      mandatoryViolations: 2,
      violatedRequirements: [
        { wcagCriterion: '1.1.1', obligation: 'mandatory', issueCount: 2 },
        { wcagCriterion: '1.3.1', obligation: 'mandatory', issueCount: 5 },
      ],
    });

    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('1.1.1');
    expect(html).toContain('1.3.1');
  });

  it('does not render a <details> block when violatedRequirements is empty', () => {
    const html = renderCard({
      regulationId: 'EAA',
      regulationName: 'European Accessibility Act',
      shortName: 'EAA',
      status: 'pass',
      mandatoryViolations: 0,
      violatedRequirements: [],
    });

    expect(html).not.toContain('<details');
  });
});
