import { describe, it, expect } from 'vitest';
import { deriveExposure } from '../../src/services/legal-exposure.js';
import type { ExposureInput } from '../../src/services/legal-exposure.js';

const ZERO_FINDINGS: ExposureInput['findings'] = {
  errors: 0,
  warnings: 0,
  notices: 0,
  confirmedViolations: 0,
};

describe('deriveExposure', () => {
  it('returns Lower band when scan has no findings and no high-exposure jurisdictions', () => {
    const result = deriveExposure({
      jurisdictions: [],
      regulations: [],
      findings: { ...ZERO_FINDINGS },
    });
    expect(result.band).toBe('lower');
    expect(result.drivers.length).toBe(0);
  });

  it('returns High band when EAA jurisdiction selected (always in effect)', () => {
    const result = deriveExposure({
      jurisdictions: ['EU'],
      regulations: ['EU-EAA'],
      findings: { ...ZERO_FINDINGS },
    });
    expect(result.band).toBe('high');
    const eaaDriver = result.drivers.find((d) => d.key === 'eaaInEffect');
    expect(eaaDriver).toBeDefined();
  });

  it('returns at least Elevated band for high-filing US state New York without EAA', () => {
    const result = deriveExposure({
      jurisdictions: ['US-NY'],
      regulations: ['US-NY-WEB'],
      findings: { ...ZERO_FINDINGS },
    });
    const ORDINAL = ['lower', 'moderate', 'elevated', 'high'];
    expect(ORDINAL.indexOf(result.band)).toBeGreaterThanOrEqual(ORDINAL.indexOf('elevated'));
    const driver = result.drivers.find((d) => d.key === 'highFilingState');
    expect(driver).toBeDefined();
    expect(driver?.params.name).toBe('New York');
  });

  it('includes adaTitleIiCountdown or adaTitleIiPassed driver when ADA Title II matched', () => {
    const result = deriveExposure({
      jurisdictions: ['US'],
      regulations: ['US-ADA-T2-WEB'],
      findings: { ...ZERO_FINDINGS },
    });
    const countdownDriver = result.drivers.find(
      (d) => d.key === 'adaTitleIiCountdown' || d.key === 'adaTitleIiPassed',
    );
    expect(countdownDriver).toBeDefined();
    expect(countdownDriver?.params.date).toBeTruthy();
  });

  it('finding pressure alone can elevate band beyond lower', () => {
    const result = deriveExposure({
      jurisdictions: [],
      regulations: [],
      findings: {
        errors: 30,
        warnings: 50,
        notices: 20,
        confirmedViolations: 5,
      },
    });
    const ORDINAL = ['lower', 'moderate', 'elevated', 'high'];
    expect(ORDINAL.indexOf(result.band)).toBeGreaterThanOrEqual(ORDINAL.indexOf('moderate'));
  });

  it('always includes asOf date and disclaimer', () => {
    const result = deriveExposure({
      jurisdictions: [],
      regulations: [],
      findings: { ...ZERO_FINDINGS },
    });
    expect(typeof result.asOf).toBe('string');
    // ISO date format: YYYY-MM-DD
    expect(result.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof result.disclaimer).toBe('string');
    expect(result.disclaimer.length).toBeGreaterThan(0);
  });

  it('disclaimer never contains forbidden words', () => {
    const result = deriveExposure({
      jurisdictions: [],
      regulations: [],
      findings: { ...ZERO_FINDINGS },
    });
    const FORBIDDEN = [
      'compliant',
      '100%',
      'pass',
      'lawsuit-proof',
      'will be sued',
      'fault',
      'guarantee',
    ];
    for (const word of FORBIDDEN) {
      expect(result.disclaimer.toLowerCase()).not.toContain(word);
    }
  });

  it('never emits forbidden words in driver strings or disclaimer', () => {
    const result = deriveExposure({
      jurisdictions: ['US', 'EU'],
      regulations: ['EU-EAA', 'US-ADA-T2-WEB'],
      findings: {
        errors: 10,
        warnings: 20,
        notices: 5,
        confirmedViolations: 3,
      },
    });
    const FORBIDDEN = [
      'compliant',
      '100%',
      'pass',
      'lawsuit-proof',
      'fault',
      'guarantee',
    ];
    // Check disclaimer
    expect(FORBIDDEN.some((w) => result.disclaimer.toLowerCase().includes(w))).toBe(false);
    // Check all driver keys and param values
    for (const driver of result.drivers) {
      const driverText = [
        driver.key,
        ...Object.values(driver.params),
      ]
        .join(' ')
        .toLowerCase();
      expect(FORBIDDEN.some((w) => driverText.includes(w))).toBe(false);
    }
  });

  it('band is an ordinal string, never a number — result has no numeric score/percentage/value field', () => {
    const result = deriveExposure({
      jurisdictions: ['EU'],
      regulations: ['EU-EAA'],
      findings: {
        errors: 5,
        warnings: 10,
        notices: 3,
        confirmedViolations: 1,
      },
    });
    expect(typeof result.band).toBe('string');
    expect(['lower', 'moderate', 'elevated', 'high']).toContain(result.band);
    // D-01: result must NOT have numeric verdict fields
    expect((result as Record<string, unknown>).score).toBeUndefined();
    expect((result as Record<string, unknown>).percentage).toBeUndefined();
    expect((result as Record<string, unknown>).value).toBeUndefined();
  });

  it('returns no drivers when no jurisdictions selected and zero findings', () => {
    const result = deriveExposure({
      jurisdictions: [],
      regulations: [],
      findings: { ...ZERO_FINDINGS },
    });
    expect(result.drivers).toHaveLength(0);
  });
});
