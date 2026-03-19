import { describe, it, expect } from 'vitest';
import {
  WCAG_DESCRIPTIONS,
  getWcagDescription,
  extractCriterion,
} from '../src/wcag-descriptions.js';

describe('WCAG_DESCRIPTIONS', () => {
  it('contains Level A criteria for Principle 1', () => {
    expect(WCAG_DESCRIPTIONS['1.1.1']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['1.1.1'].title).toBe('Non-text Content');
    expect(WCAG_DESCRIPTIONS['1.1.1'].description).toContain('text alternatives');
    expect(WCAG_DESCRIPTIONS['1.1.1'].impact).toBeTruthy();
  });

  it('contains Level AA contrast criterion', () => {
    expect(WCAG_DESCRIPTIONS['1.4.3']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['1.4.3'].title).toBe('Contrast (Minimum)');
    expect(WCAG_DESCRIPTIONS['1.4.3'].description).toContain('4.5:1');
  });

  it('contains keyboard accessibility criteria', () => {
    expect(WCAG_DESCRIPTIONS['2.1.1']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['2.1.1'].title).toBe('Keyboard');
  });

  it('contains focus visible criterion', () => {
    expect(WCAG_DESCRIPTIONS['2.4.7']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['2.4.7'].title).toBe('Focus Visible');
  });

  it('contains language of page criterion', () => {
    expect(WCAG_DESCRIPTIONS['3.1.1']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['3.1.1'].title).toBe('Language of Page');
  });

  it('contains name role value criterion', () => {
    expect(WCAG_DESCRIPTIONS['4.1.2']).toBeDefined();
    expect(WCAG_DESCRIPTIONS['4.1.2'].title).toBe('Name, Role, Value');
  });

  it('contains at least 40 criteria (comprehensive coverage)', () => {
    const keys = Object.keys(WCAG_DESCRIPTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry has title, description, and impact fields', () => {
    for (const [criterion, info] of Object.entries(WCAG_DESCRIPTIONS)) {
      expect(info.title, `${criterion} missing title`).toBeTruthy();
      expect(info.description, `${criterion} missing description`).toBeTruthy();
      expect(info.impact, `${criterion} missing impact`).toBeTruthy();
    }
  });

  it('includes WCAG 2.1 AA criteria (1.3.4, 1.3.5, 1.4.10, 1.4.11, 1.4.12, 1.4.13)', () => {
    const aa21 = ['1.3.4', '1.3.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13'];
    for (const c of aa21) {
      expect(WCAG_DESCRIPTIONS[c], `Missing WCAG 2.1 AA criterion ${c}`).toBeDefined();
    }
  });
});

describe('getWcagDescription', () => {
  it('returns description for known criterion', () => {
    const result = getWcagDescription('1.1.1');
    expect(result).toBeDefined();
    expect(result!.title).toBe('Non-text Content');
  });

  it('returns undefined for unknown criterion', () => {
    expect(getWcagDescription('9.9.9')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getWcagDescription('')).toBeUndefined();
  });

  it('is consistent with direct WCAG_DESCRIPTIONS lookup', () => {
    const direct = WCAG_DESCRIPTIONS['2.4.2'];
    const via = getWcagDescription('2.4.2');
    expect(via).toEqual(direct);
  });
});

describe('extractCriterion', () => {
  it('extracts criterion from a full pa11y WCAG code', () => {
    expect(extractCriterion('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37')).toBe('1.1.1');
  });

  it('extracts criterion from alternative pa11y code formats', () => {
    expect(extractCriterion('WCAG2AA.Principle2.Guideline2_4.2_4_4.H77,H78,H79,H80,H81')).toBe('2.4.4');
  });

  it('returns null for a code with no criterion pattern', () => {
    expect(extractCriterion('Section508.A')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractCriterion('')).toBeNull();
  });

  it('extracts 1.3.1 correctly', () => {
    expect(extractCriterion('WCAG2AA.Principle1.Guideline1_3.1_3_1.H49.AlignAttr')).toBe('1.3.1');
  });

  it('extracts 4.1.2 correctly', () => {
    expect(extractCriterion('WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.InputText.Name')).toBe('4.1.2');
  });
});
