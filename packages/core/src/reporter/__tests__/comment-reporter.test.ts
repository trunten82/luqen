/**
 * Tests for comment-reporter.ts — GitHub-Markdown PR comment builder.
 *
 * D-17: output must never assert conformance.
 * D-12: first line is exactly <!-- luqen-gate -->
 * The disclaimer is mandatory on every variant.
 */

import { describe, it, expect } from 'vitest';
import { formatPrComment } from '../comment-reporter.js';
import type { BaselineDiff } from '../../baseline/diff.js';
import type { BaselineFinding } from '../../baseline/baseline.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleFinding: BaselineFinding = {
  fingerprint: 'abc1234567890123',
  normalizedPath: '/about',
  code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
  type: 'error',
  selector: '#main img.hero',
  message: 'Missing alt attribute',
};

const sampleFinding2: BaselineFinding = {
  fingerprint: 'def4567890123456',
  normalizedPath: '/home',
  code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Button.Name',
  type: 'error',
  selector: '#nav button.menu',
  message: 'Button has no accessible name',
};

const fixedFinding: BaselineFinding = {
  fingerprint: 'ghi7890123456789',
  normalizedPath: '/home',
  code: 'WCAG2AA.Principle2.Guideline2_4.2_4_6.H69',
  type: 'warning',
  selector: 'h2.section-title',
  message: 'Heading not descriptive',
};

const cleanDiff: BaselineDiff = {
  newFindings: [],
  fixedFindings: [fixedFinding],
  unchanged: [sampleFinding],
};

const findingsDiff: BaselineDiff = {
  newFindings: [sampleFinding, sampleFinding2],
  fixedFindings: [fixedFinding],
  unchanged: [],
};

const infraErrorDiff = {
  newFindings: [] as BaselineFinding[],
  fixedFindings: [] as BaselineFinding[],
  unchanged: [] as BaselineFinding[],
  infraError: true,
};

const emptyEnrichment = new Map<string, { jurisdictionName: string; obligation?: string }[]>();

// ---------------------------------------------------------------------------
// D-17 forbidden words
// ---------------------------------------------------------------------------

const FORBIDDEN_WORDS_PATTERN = /\b(compliant|compliance\b|100%|passes|pass\b|lawsuit-proof|fully accessible)\b/i;

// ---------------------------------------------------------------------------
// Tests: marker + structure
// ---------------------------------------------------------------------------

describe('formatPrComment', () => {
  describe('HTML marker', () => {
    it('first line is exactly <!-- luqen-gate --> for clean run', () => {
      const body = formatPrComment(cleanDiff, emptyEnrichment, '.luqen/baseline.json');
      const firstLine = body.split('\n')[0];
      expect(firstLine).toBe('<!-- luqen-gate -->');
    });

    it('first line is exactly <!-- luqen-gate --> for findings variant', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      const firstLine = body.split('\n')[0];
      expect(firstLine).toBe('<!-- luqen-gate -->');
    });

    it('first line is exactly <!-- luqen-gate --> for infra-error variant', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      const firstLine = body.split('\n')[0];
      expect(firstLine).toBe('<!-- luqen-gate -->');
    });
  });

  describe('disclaimer (D-17)', () => {
    it('disclaimer present in clean-run variant', () => {
      const body = formatPrComment(cleanDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('Not legal advice.');
      expect(body).toContain('does not assert conformance');
    });

    it('disclaimer present in findings-present variant', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('Not legal advice.');
      expect(body).toContain('does not assert conformance');
    });

    it('disclaimer present in infra-error variant', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('Not legal advice.');
      expect(body).toContain('does not assert conformance');
    });
  });

  describe('counts table', () => {
    it('clean-run variant contains headline "No new findings vs baseline."', () => {
      const body = formatPrComment(cleanDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('No new findings vs baseline.');
    });

    it('findings variant contains counts for new and fixed', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('New findings');
      expect(body).toContain('Fixed findings');
    });

    it('clean-run variant does not contain <details>', () => {
      const body = formatPrComment(cleanDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toContain('<details>');
    });
  });

  describe('findings section', () => {
    it('findings variant contains "Jurisdiction context" column header', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('Jurisdiction context');
    });

    it('findings variant contains details section for new findings', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('<details>');
      expect(body).toContain('New findings');
      expect(body).toContain('review required');
    });

    it('findings variant contains details section for fixed findings', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('Fixed findings');
      expect(body).toContain('resolved vs baseline');
    });

    it('jurisdiction fallback text used when no enrichment for code', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('No jurisdiction mapping for this criterion');
    });

    it('jurisdiction text used when enrichment provided', () => {
      const enrichment = new Map([
        [sampleFinding.code, [{ jurisdictionName: 'EU', obligation: 'mandatory', regulationName: 'EAA' }]],
      ]);
      const body = formatPrComment(findingsDiff, enrichment, '.luqen/baseline.json');
      expect(body).toContain('EU');
    });

    it('finding selectors are wrapped in backtick code spans', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).toContain('`#main img.hero`');
    });
  });

  describe('infra-error variant', () => {
    it('infra-error variant contains degraded headline', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      // Should indicate an error state
      expect(body).toMatch(/infra|error|unavailable|could not/i);
    });

    it('infra-error variant does not assert clean run', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toContain('No new findings vs baseline.');
    });

    it('infra-error variant does not contain <details>', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toContain('<details>');
    });
  });

  describe('D-17 forbidden words', () => {
    it('clean-run body contains none of the D-17 forbidden words', () => {
      const body = formatPrComment(cleanDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toMatch(FORBIDDEN_WORDS_PATTERN);
    });

    it('findings body contains none of the D-17 forbidden words', () => {
      const body = formatPrComment(findingsDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toMatch(FORBIDDEN_WORDS_PATTERN);
    });

    it('infra-error body contains none of the D-17 forbidden words', () => {
      const body = formatPrComment(infraErrorDiff, emptyEnrichment, '.luqen/baseline.json');
      expect(body).not.toMatch(FORBIDDEN_WORDS_PATTERN);
    });
  });

  describe('source string literal scan (D-17 hardened)', () => {
    it('the formatPrComment source never contains the literal word "compliant"', async () => {
      // This test guards against accidental introduction of forbidden copy
      // directly in the source file (grepping the emitted output covers runtime,
      // but this covers the template strings themselves).
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(currentDir, '../comment-reporter.ts'), 'utf-8');
      expect(src).not.toMatch(/\bcompliant\b/i);
      expect(src).not.toMatch(/\b100%\b/);
      expect(src).not.toMatch(/\blawsuit-proof\b/i);
    });
  });
});
