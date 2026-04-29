/**
 * Phase 43 Plan 01 (AGENT-01) — plan-block parser unit tests.
 *
 * Acceptance criteria from 43-01-PLAN.md:
 * - parses a 3-step plan
 * - handles missing rationale (uses empty string)
 * - returns null for text without `<plan>` block
 * - strips block from text correctly (no leading/trailing whitespace artifacts)
 * - handles malformed lines (skips them, doesn't throw)
 */

import { describe, it, expect } from 'vitest';
import { parsePlanBlock } from '../../src/agent/plan-parser.js';

describe('parsePlanBlock', () => {
  it('returns null when no <plan> block is present', () => {
    expect(parsePlanBlock('Just a normal answer.')).toBeNull();
    expect(parsePlanBlock('')).toBeNull();
  });

  it('parses a 3-step plan with em-dash rationale', () => {
    const text = [
      '<plan>',
      '1. Look up scan history — User asked about a recent scan',
      '2. Generate executive summary — Once scan picked, summarise findings',
      '3. Format response — Render markdown with citations',
      '</plan>',
      'Now executing.',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual([
      { n: 1, label: 'Look up scan history', rationale: 'User asked about a recent scan' },
      { n: 2, label: 'Generate executive summary', rationale: 'Once scan picked, summarise findings' },
      { n: 3, label: 'Format response', rationale: 'Render markdown with citations' },
    ]);
    expect(result!.textWithoutBlock).toBe('Now executing.');
  });

  it('handles missing rationale (uses empty string)', () => {
    const text = [
      '<plan>',
      '1. Look up scan history',
      '2. Generate summary — Have data now',
      '</plan>',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual([
      { n: 1, label: 'Look up scan history', rationale: '' },
      { n: 2, label: 'Generate summary', rationale: 'Have data now' },
    ]);
  });

  it('strips the block leaving no leading/trailing whitespace', () => {
    const text = [
      '<plan>',
      '1. Step one — rationale',
      '2. Step two — rationale',
      '</plan>',
      '',
      'Real assistant content here.',
      '',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.textWithoutBlock).toBe('Real assistant content here.');
  });

  it('strips the block when it is preceded by content', () => {
    const text = [
      'Sure, here is my plan:',
      '<plan>',
      '1. Step one — rationale',
      '2. Step two — rationale',
      '</plan>',
      'Now executing step 1.',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.textWithoutBlock).toContain('Sure, here is my plan:');
    expect(result!.textWithoutBlock).toContain('Now executing step 1.');
    expect(result!.textWithoutBlock).not.toContain('<plan>');
    expect(result!.textWithoutBlock).not.toContain('</plan>');
  });

  it('skips malformed step lines without throwing', () => {
    const text = [
      '<plan>',
      '1. Valid step — has rationale',
      'this is not a numbered step',
      '   ',
      '2. Another valid step — also fine',
      'random noise',
      '</plan>',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual([
      { n: 1, label: 'Valid step', rationale: 'has rationale' },
      { n: 2, label: 'Another valid step', rationale: 'also fine' },
    ]);
  });

  it('tolerates hyphen separator in addition to em-dash', () => {
    const text = [
      '<plan>',
      '1. Step one - rationale here',
      '2. Step two – en-dash rationale',
      '</plan>',
    ].join('\n');

    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps[0]).toEqual({ n: 1, label: 'Step one', rationale: 'rationale here' });
    expect(result!.steps[1]).toEqual({ n: 2, label: 'Step two', rationale: 'en-dash rationale' });
  });

  it('returns null for empty plan block (no parseable steps)', () => {
    // An empty block still matches the regex; we still return a ParsedPlan
    // with an empty steps array. The runTurn caller is responsible for
    // skipping the SSE emit when steps.length === 0.
    const text = '<plan>\n</plan>\nrest';
    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual([]);
    expect(result!.textWithoutBlock).toBe('rest');
  });

  it('is case-insensitive on the <plan> tag', () => {
    const text = '<PLAN>\n1. Step one — go\n</PLAN>\nbody';
    const result = parsePlanBlock(text);
    expect(result).not.toBeNull();
    expect(result!.steps).toEqual([{ n: 1, label: 'Step one', rationale: 'go' }]);
    expect(result!.textWithoutBlock).toBe('body');
  });
});
