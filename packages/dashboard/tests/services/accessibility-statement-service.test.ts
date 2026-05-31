import { describe, it, expect } from 'vitest';
import { buildAccessibilityStatement } from '../../src/services/accessibility-statement-service.js';
import type { VpatReport, VpatRow } from '../../src/services/vpat-service.js';
import type { AccessibilityStatementRecord } from '../../src/db/interfaces/accessibility-statement-repository.js';

function row(partial: Partial<VpatRow>): VpatRow {
  return {
    criterion: '1.1.1',
    title: 'Non-text Content',
    level: 'A',
    version: '2.1',
    url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
    conformance: 'Supports',
    remarks: '',
    ...partial,
  };
}

function vpatWith(rows: VpatRow[]): VpatReport {
  return {
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    level: 'AA',
    generatedAt: '2026-05-30',
    tablesByLevel: [{ level: 'A', rows }],
    summary: {
      supports: rows.filter((r) => r.conformance === 'Supports').length,
      partial: rows.filter((r) => r.conformance === 'Partially Supports').length,
      doesNotSupport: rows.filter((r) => r.conformance === 'Does Not Support').length,
      notApplicable: rows.filter((r) => r.conformance === 'Not Applicable').length,
      notEvaluated: rows.filter((r) => r.conformance === 'Not Evaluated').length,
      total: rows.length,
    },
    legalFramings: [],
    includeFunctionalPerformance: false,
    functionalPerformanceHeading: '',
  };
}

function config(overrides: Partial<AccessibilityStatementRecord> = {}): AccessibilityStatementRecord {
  return {
    orgId: 'org-1',
    enabled: true,
    wcagVersion: '2.1',
    wcagLevel: 'AA',
    updatedAt: '2026-05-30T00:00:00.000Z',
    entityName: 'Acme Corp',
    siteUrl: 'https://example.com',
    ...overrides,
  };
}

describe('buildAccessibilityStatement', () => {
  it('reports no-assessment conservatively when there is no scan', () => {
    const s = buildAccessibilityStatement(config(), null, { generatedAt: '2026-05-30' });
    expect(s.hasAssessment).toBe(false);
    expect(s.conformanceStatus).toBe('not-conformant');
    expect(s.knownLimitations).toEqual([]);
    expect(s.notEvaluatedCount).toBe(0);
    expect(s.summary).toBeUndefined();
  });

  it('claims partial conformance only when some criteria are supported', () => {
    const vpat = vpatWith([
      row({ criterion: '1.1.1', conformance: 'Supports' }),
      row({ criterion: '1.4.3', conformance: 'Does Not Support', remarks: '3 errors across 2 pages' }),
      row({ criterion: '2.4.7', conformance: 'Partially Supports', remarks: '1 warning' }),
      row({ criterion: '1.3.1', conformance: 'Not Evaluated' }),
    ]);
    const s = buildAccessibilityStatement(config(), vpat, {
      generatedAt: '2026-05-30',
      assessmentDate: '2026-05-29',
    });
    expect(s.hasAssessment).toBe(true);
    expect(s.conformanceStatus).toBe('partially-conformant');
    expect(s.assessmentDate).toBe('2026-05-29');
    expect(s.notEvaluatedCount).toBe(1);
    // Only Does Not Support + Partially Supports become public limitations.
    expect(s.knownLimitations.map((l) => l.criterion).sort()).toEqual(['1.4.3', '2.4.7']);
    const dns = s.knownLimitations.find((l) => l.criterion === '1.4.3');
    expect(dns?.conformance).toBe('Does Not Support');
    expect(dns?.remarks).toContain('errors');
  });

  it('does not claim conformance when nothing is supported', () => {
    const vpat = vpatWith([
      row({ criterion: '1.4.3', conformance: 'Does Not Support' }),
      row({ criterion: '1.3.1', conformance: 'Not Evaluated' }),
    ]);
    const s = buildAccessibilityStatement(config(), vpat, { generatedAt: '2026-05-30' });
    expect(s.conformanceStatus).toBe('not-conformant');
    expect(s.knownLimitations).toHaveLength(1);
  });

  it('formats the standard label and carries contact + commitment', () => {
    const s = buildAccessibilityStatement(
      config({
        wcagVersion: '2.2',
        wcagLevel: 'AA',
        contactEmail: 'a11y@acme.test',
        commitment: 'We fix issues within 30 days.',
      }),
      null,
    );
    expect(s.standardLabel).toBe('WCAG 2.2 level AA');
    expect(s.contactEmail).toBe('a11y@acme.test');
    expect(s.commitment).toBe('We fix issues within 30 days.');
  });

  it('falls back to the org id when entity name is blank', () => {
    const s = buildAccessibilityStatement(config({ entityName: '   ' }), null);
    expect(s.entityName).toBe('org-1');
  });

  it('caps the public limitations list', () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      row({ criterion: `9.${i}.1`, conformance: 'Does Not Support' }),
    );
    rows.push(row({ criterion: '1.1.1', conformance: 'Supports' }));
    const s = buildAccessibilityStatement(config(), vpatWith(rows));
    expect(s.knownLimitations.length).toBeLessThanOrEqual(50);
    expect(s.conformanceStatus).toBe('partially-conformant');
  });
});
