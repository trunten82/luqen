import { describe, it, expect } from 'vitest';
import {
  extractCriterion,
  extractLevel,
  parseIssueCode,
} from '../../src/engine/matcher.js';

describe('Matcher', () => {
  describe('extractCriterion', () => {
    it('extracts 1.1.1 from WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', () => {
      expect(
        extractCriterion('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      ).toBe('1.1.1');
    });

    it('extracts 1.3.1 from WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent', () => {
      expect(
        extractCriterion(
          'WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent',
        ),
      ).toBe('1.3.1');
    });

    it('extracts 3.1.1 from WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2', () => {
      expect(
        extractCriterion('WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2'),
      ).toBe('3.1.1');
    });

    it('extracts 2.4.7 from WCAG2AA.Principle2.Guideline2_4.2_4_7.G149', () => {
      expect(
        extractCriterion('WCAG2AA.Principle2.Guideline2_4.2_4_7.G149'),
      ).toBe('2.4.7');
    });

    it('extracts 4.1.2 from WCAG2A.Principle4.Guideline4_1.4_1_2.H91.InputText.Name', () => {
      expect(
        extractCriterion(
          'WCAG2A.Principle4.Guideline4_1.4_1_2.H91.InputText.Name',
        ),
      ).toBe('4.1.2');
    });

    it('returns null for unparseable code', () => {
      expect(extractCriterion('not-a-wcag-code')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractCriterion('')).toBeNull();
    });
  });

  describe('extractLevel', () => {
    it('extracts A from WCAG2A prefix', () => {
      expect(
        extractLevel('WCAG2A.Principle4.Guideline4_1.4_1_2.H91'),
      ).toBe('A');
    });

    it('extracts AA from WCAG2AA prefix', () => {
      expect(
        extractLevel('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'),
      ).toBe('AA');
    });

    it('extracts AAA from WCAG2AAA prefix', () => {
      expect(
        extractLevel('WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17'),
      ).toBe('AAA');
    });

    it('returns null for unparseable code', () => {
      expect(extractLevel('not-a-wcag-code')).toBeNull();
    });
  });

  describe('parseIssueCode', () => {
    it('returns both criterion and level', () => {
      const result = parseIssueCode(
        'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      );
      expect(result).toEqual({ criterion: '1.1.1', level: 'AA' });
    });

    it('returns null for unparseable code', () => {
      expect(parseIssueCode('garbage')).toBeNull();
    });
  });
});
