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

  it('emits distinct context blocks for NY State + NYC LL12 + NYC HRL when those regulations are selected', () => {
    const r = deriveLegalFramings(
      ['US'],
      ['US-ADA', 'US-ADA-T2-WEB', 'US-NY-WEB', 'US-NY-NYC-LL12', 'US-NY-NYC-HRL'],
    );
    const ids = r.framings.map((f) => f.id);
    expect(ids).toContain('us-ada');
    expect(ids).toContain('us-ny-web');
    expect(ids).toContain('us-nyc-ll12');
    expect(ids).toContain('us-nyc-hrl');
    // Each NY/NYC block names its law and disclaims certification.
    const byId = Object.fromEntries(r.framings.map((f) => [f.id, f]));
    expect(byId['us-ny-web'].body).toMatch(/New York State/i);
    expect(byId['us-nyc-ll12'].body).toMatch(/Local Law 12/i);
    expect(byId['us-nyc-hrl'].body).toMatch(/8-107/);
    for (const id of ['us-ny-web', 'us-nyc-ll12', 'us-nyc-hrl']) {
      expect(byId[id].body.toLowerCase()).toContain('not');
    }
  });

  it('does NOT emit NYC blocks for a plain US/ADA scan (no NY tokens)', () => {
    const ids = deriveLegalFramings(['US'], ['US-ADA']).framings.map((f) => f.id);
    expect(ids).toContain('us-ada');
    expect(ids).not.toContain('us-ny-web');
    expect(ids).not.toContain('us-nyc-ll12');
    expect(ids).not.toContain('us-nyc-hrl');
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

describe('deriveLegalFramings — evaluatedStandards (explicit coverage enumeration)', () => {
  it('enumerates each selected regulation by full name from the built-in catalog', () => {
    const r = deriveLegalFramings(
      ['US'],
      ['US-ADA', 'US-ADA-T2-WEB', 'US-NY-WEB', 'US-NY-NYC-LL12', 'US-NY-NYC-HRL'],
    );
    const byToken = Object.fromEntries(r.evaluatedStandards.map((s) => [s.token, s.name]));
    expect(byToken['US-ADA']).toBe('Americans with Disabilities Act');
    expect(byToken['US-ADA-T2-WEB']).toBe('ADA Title II Web Accessibility Rule (2024)');
    expect(byToken['US-NY-WEB']).toBe('New York State Web Accessibility Policy');
    expect(byToken['US-NY-NYC-LL12']).toContain('Local Law 12');
    expect(byToken['US-NY-NYC-HRL']).toContain('Human Rights Law');
    // ADA must be named explicitly, never folded into "US".
    expect(r.evaluatedStandards.map((s) => s.name).join(' ')).toContain('Americans with Disabilities Act');
  });

  it('prefers a live name-resolution override map over the built-in catalog', () => {
    const overrides = new Map([['US-ADA', 'Americans with Disabilities Act (live)']]);
    const r = deriveLegalFramings(['US'], ['US-ADA', 'XX-UNKNOWN'], overrides);
    const byToken = Object.fromEntries(r.evaluatedStandards.map((s) => [s.token, s.name]));
    expect(byToken['US-ADA']).toBe('Americans with Disabilities Act (live)');
    // Unknown token with no override and no catalog entry falls back to the token itself.
    expect(byToken['XX-UNKNOWN']).toBe('XX-UNKNOWN');
  });

  it('preserves selection order and de-duplicates repeated tokens', () => {
    const r = deriveLegalFramings(['US'], ['US-508', 'US-ADA', 'US-508']);
    expect(r.evaluatedStandards.map((s) => s.token)).toEqual(['US-508', 'US-ADA']);
  });

  it('returns no evaluated standards when no regulations are selected', () => {
    expect(deriveLegalFramings(['US'], []).evaluatedStandards).toHaveLength(0);
    expect(deriveLegalFramings([], []).evaluatedStandards).toHaveLength(0);
  });
});
