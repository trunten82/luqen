import { describe, it, expect, beforeAll } from 'vitest';
import { buildAcrView, conformanceClass, type AcrAuditRow } from '../../src/services/acr-view.js';
import type { VpatReport } from '../../src/services/vpat-service.js';
import type { PdfScanMeta } from '../../src/pdf/generator.js';
import { loadTranslations, t } from '../../src/i18n/index.js';

beforeAll(async () => {
  await loadTranslations();
});

const scanMeta: PdfScanMeta = {
  siteUrl: 'https://shop.example.com/',
  standard: 'WCAG 2.1 Level AA',
  jurisdictions: 'US',
  regulations: 'US-ADA',
  createdAtDisplay: '2026-06-02',
};

function baseVpat(overrides: Partial<VpatReport> = {}): VpatReport {
  return {
    siteUrl: 'https://shop.example.com/',
    standard: 'WCAG 2.1 Level AA',
    level: 'AA',
    generatedAt: '2026-06-02',
    tablesByLevel: [
      { level: 'A', rows: [
        { criterion: '1.1.1', title: 'Non-text Content', level: 'A', conformance: 'Does Not Support', remarks: '3 errors' },
        { criterion: '1.3.2', title: 'Meaningful Sequence', level: 'A', conformance: 'Supports', remarks: 'clean' },
      ] },
    ],
    summary: { supports: 1, partial: 0, doesNotSupport: 1, notApplicable: 0, notEvaluated: 0, total: 2 },
    section508: { functionalPerformance: [
      { id: '302.1', need: 'Without vision', conformance: 'Does Not Support', remarks: 'r', relatedCriteria: ['1.1.1'] },
    ] },
    evaluatedStandards: [
      { token: 'US-ADA', name: 'Americans with Disabilities Act', reference: '42 U.S.C. § 12101', enforcementDate: '1990-07-26', description: 'Prohibits discrimination.', url: '' },
    ],
    includeFunctionalPerformance: true,
    functionalPerformanceHeading: 'Section 508',
    remediation: null,
    attestation: {
      evaluationDate: '2026-06-02', pagesEvaluated: 1, methods: ['Automated scanning', 'AI vision'],
      standardsLabel: 'WCAG 2.1 Level AA · ADA', manualTestingRecorded: false,
    },
    ...overrides,
  } as VpatReport;
}

const en = { locale: 'en', t };

describe('conformanceClass', () => {
  it('maps verdicts to stable class tokens', () => {
    expect(conformanceClass('Supports')).toBe('supports');
    expect(conformanceClass('Partially Supports')).toBe('partial');
    expect(conformanceClass('Does Not Support')).toBe('none');
    expect(conformanceClass('Not Applicable')).toBe('na');
    expect(conformanceClass('Not Evaluated')).toBe('eval');
  });
});

describe('buildAcrView', () => {
  it('maps the core fields, tally and verdict (never over-claims)', () => {
    const v = buildAcrView(baseVpat(), scanMeta, en);
    expect(v.meta.siteUrl).toBe('https://shop.example.com/');
    expect(v.tally).toEqual({ supports: 1, partial: 0, doesNotSupport: 1, notApplicable: 0, notEvaluated: 0, total: 2 });
    expect(v.verdict.line).toContain('partially conforms to');
    expect(v.verdict.line).toContain('shop.example.com');
  });

  it('says "conforms to" only when every criterion supports', () => {
    const v = buildAcrView(baseVpat({ summary: { supports: 2, partial: 0, doesNotSupport: 0, notApplicable: 0, notEvaluated: 0, total: 2 } }), scanMeta, en);
    expect(v.verdict.line).toContain('conforms to');
    expect(v.verdict.line).not.toContain('partially');
  });

  it('builds standards with citation + class-tagged table rows', () => {
    const v = buildAcrView(baseVpat(), scanMeta, en);
    expect(v.hasStandards).toBe(true);
    expect(v.standards[0].cite).toBe('Reference: 42 U.S.C. § 12101 · in force since 1990-07-26');
    expect(v.tables[0].rows[0].conformanceClass).toBe('none');
    expect(v.tables[0].rows[1].conformanceClass).toBe('supports');
    expect(v.tables[0].levelLabel).toBe('WCAG Level A');
    expect(v.fpc.include).toBe(true);
    expect(v.fpc.rows[0].id).toBe('302.1');
  });

  it('populates localized strings (no hardcoded prose) and a wording indicator', () => {
    const v = buildAcrView(baseVpat(), scanMeta, en);
    expect(v.strings.methodologyHeading).toBe('Methodology & scope');
    expect(v.strings.auditHeading).toBe('Audit history');
    expect(v.strings.colCriteria).toBe('Criteria');
    expect(v.wording.anyCustom).toBe(false);
    expect(v.wording.anyUnreviewed).toBe(false); // en standard is reviewed
  });

  it('localizes the verdict line for other locales', () => {
    const v = buildAcrView(baseVpat(), scanMeta, { locale: 'fr', t });
    expect(v.verdict.line).toContain('partiellement conforme');
    // fr standard wording is not yet human-reviewed
    expect(v.wording.anyUnreviewed).toBe(true);
  });

  it('hides the remediation section when the record is empty', () => {
    const v = buildAcrView(baseVpat({ remediation: { isEmpty: true, events: [], summary: { aiProposed: 0, developerVerified: 0, manualVerified: 0, total: 0, firstActivity: null, lastActivity: null }, scanTrend: [] } }), scanMeta, en);
    expect(v.remediation.present).toBe(false);
  });

  it('surfaces the remediation record with stats, action labels and per-event actor', () => {
    const v = buildAcrView(baseVpat({ remediation: {
      isEmpty: false,
      events: [{ date: '2026-06-02', type: 'developer-verified', criterion: '1.1.1', detail: 'PR #1', actor: 'jane@acme.com' }],
      summary: { aiProposed: 2, developerVerified: 1, manualVerified: 0, total: 3, firstActivity: '2026-06-01', lastActivity: '2026-06-02' },
      scanTrend: [{ date: '2026-06-01', totalIssues: 5, errors: 4 }, { date: '2026-06-02', totalIssues: 2, errors: 1 }],
    } }), scanMeta, en);
    expect(v.remediation.present).toBe(true);
    expect(v.remediation.events[0].action).toBe('Developer-verified');
    expect(v.remediation.events[0].actor).toBe('jane@acme.com');
    expect(v.remediation.stats).toEqual({ aiProposed: 2, developerVerified: 1, total: 3, completedScans: 2 });
  });

  it('maps the audit history trail', () => {
    const audit: AcrAuditRow[] = [
      { criterion: '1.1.1', change: 'untested → fail', reason: 'no alt text', actor: 'jane', date: '2026-06-01' },
    ];
    const v = buildAcrView(baseVpat(), scanMeta, { ...en, auditHistory: audit });
    expect(v.hasAuditHistory).toBe(true);
    expect(v.auditHistory[0].change).toBe('untested → fail');
    expect(v.auditHistory[0].actor).toBe('jane');
  });

  it('surfaces links (pack/live-report/badge) when provided', () => {
    const v = buildAcrView(baseVpat(), scanMeta, { ...en, links: { packUrl: '/p.zip', liveReportUrl: '/r', badgeUrl: '/b.svg' } });
    expect(v.hasLinks).toBe(true);
    expect(v.links.packUrl).toBe('/p.zip');
    expect(v.hasEvidence).toBe(false);
  });

  it('surfaces a PDF download link and the localized download label', () => {
    const v = buildAcrView(baseVpat(), scanMeta, { ...en, links: { pdfUrl: '/r/acr.pdf' } });
    expect(v.hasLinks).toBe(true);
    expect(v.links.pdfUrl).toBe('/r/acr.pdf');
    expect(v.strings.downloadPdf).toBe('Download PDF');
  });

  it('has no links when none are provided', () => {
    const v = buildAcrView(baseVpat(), scanMeta, en);
    expect(v.hasLinks).toBe(false);
  });

  it('carries a stale-revision notice when supplied (Time Machine non-latest)', () => {
    const v = buildAcrView(baseVpat(), scanMeta, {
      ...en,
      staleNotice: { message: 'A newer version of this report is available.', linkLabel: 'View the latest report', latestUrl: '/reports/live/abc' },
    });
    expect(v.staleNotice).toEqual({
      message: 'A newer version of this report is available.',
      linkLabel: 'View the latest report',
      latestUrl: '/reports/live/abc',
    });
  });

  it('omits the stale notice by default', () => {
    const v = buildAcrView(baseVpat(), scanMeta, en);
    expect(v.staleNotice).toBeUndefined();
  });

  it('applies a custom wording override and flips the indicator', () => {
    const v = buildAcrView(baseVpat(), scanMeta, {
      ...en,
      wordingOverrides: [{ key: 'methodologyHeading', locale: 'en', text: 'How we tested', source: 'custom', reviewed: true }],
    });
    expect(v.strings.methodologyHeading).toBe('How we tested');
    expect(v.wording.anyCustom).toBe(true);
  });
});
