import { describe, it, expect } from 'vitest';
import { deriveLegalFramings } from '../../src/services/legal-framings.js';

describe('deriveLegalFramings', () => {
  it('returns US framings (508 + ADA + FPC) only when US regulations are selected', () => {
    const r = deriveLegalFramings(['US'], ['Section 508', 'ADA']);
    const ids = r.framings.map((f) => f.id);
    expect(ids).toContain('us-508');
    expect(ids).toContain('us-ada');
    expect(r.includeFunctionalPerformance).toBe(true);
    expect(r.functionalPerformanceHeading).toContain('Section 508');
    expect(r.standardsLabel).toContain('Section 508');
    expect(r.standardsLabel).toContain('ADA');
  });

  it('does NOT include US framing for an EU-only scan', () => {
    const r = deriveLegalFramings(['EU', 'FR'], ['EAA', 'RGAA']);
    const ids = r.framings.map((f) => f.id);
    expect(ids).not.toContain('us-508');
    expect(ids).not.toContain('us-ada');
    expect(ids).toContain('eu-eaa');
    expect(ids).toContain('fr-rgaa');
    expect(r.standardsLabel).not.toContain('Section 508');
  });

  it('uses EN 301 549 functional-performance heading when EN 301 549 (not 508) applies', () => {
    const r = deriveLegalFramings(['EU'], ['EN 301 549']);
    expect(r.includeFunctionalPerformance).toBe(true);
    expect(r.functionalPerformanceHeading).toContain('EN 301 549');
  });

  it('matches Ontario AODA, UK Equality Act, California Unruh by keyword', () => {
    expect(deriveLegalFramings(['CA-ON'], ['AODA']).framings.map((f) => f.id)).toContain('ca-aoda');
    expect(deriveLegalFramings(['UK'], ['Equality Act']).framings.map((f) => f.id)).toContain('uk-ea');
    expect(deriveLegalFramings(['US-CA'], ['Unruh']).framings.map((f) => f.id)).toContain('us-unruh');
  });

  it('falls back to a generic block listing exactly what was selected when nothing distinctive matches', () => {
    const r = deriveLegalFramings(['Atlantis'], ['Some Local Rule']);
    expect(r.framings).toHaveLength(1);
    expect(r.framings[0].id).toBe('generic');
    expect(r.framings[0].body).toContain('Atlantis');
    expect(r.framings[0].body).toContain('Some Local Rule');
    expect(r.includeFunctionalPerformance).toBe(false);
  });

  it('returns no framings and a bare WCAG label when nothing is selected', () => {
    const r = deriveLegalFramings([], []);
    expect(r.framings).toHaveLength(0);
    expect(r.includeFunctionalPerformance).toBe(false);
    expect(r.standardsLabel).toBe('WCAG 2.2 (incl. 2.0/2.1)');
  });

  it('never emits a conformance claim — bodies disclaim certification', () => {
    const r = deriveLegalFramings(['US', 'EU', 'UK'], ['ADA', 'EAA', 'Equality Act']);
    for (const f of r.framings) {
      expect(f.body.toLowerCase()).toContain('not');
    }
  });
});
