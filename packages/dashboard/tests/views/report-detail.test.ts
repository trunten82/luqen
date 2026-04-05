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
  it('hides sub-tab bar entirely when regulationMatrix is empty', () => {
    const html = renderReportDetail({
      ...baseReportData,
      regulationMatrix: [],
    });

    expect(html).not.toContain('subtab-compliance-by-regulation');
    expect(html).not.toContain('subpanel-compliance-by-regulation');
    // The jurisdictions sub-panel wrapper is still present (it always wraps the matrix)
    expect(html).toContain('subpanel-compliance-by-jurisdiction');
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
