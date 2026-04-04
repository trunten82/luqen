import { describe, it, expect } from 'vitest';
import { parseExtractedRequirements } from '../../src/capabilities/parse-extract-response.js';

describe('parseExtractedRequirements', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      wcagVersion: '2.1', wcagLevel: 'AA',
      criteria: [
        { criterion: '1.1.1', obligation: 'mandatory', notes: 'Alt text' },
        { criterion: '2.1.1', obligation: 'recommended' },
      ],
      confidence: 0.92,
    });
    const result = parseExtractedRequirements(raw);
    expect(result.wcagVersion).toBe('2.1');
    expect(result.wcagLevel).toBe('AA');
    expect(result.criteria).toHaveLength(2);
    expect(result.criteria[0].notes).toBe('Alt text');
    expect(result.criteria[1].notes).toBeUndefined();
    expect(result.confidence).toBe(0.92);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"wcagVersion":"2.0","wcagLevel":"A","criteria":[],"confidence":0.5}\n```';
    const result = parseExtractedRequirements(raw);
    expect(result.wcagVersion).toBe('2.0');
  });

  it('filters out criteria missing required fields', () => {
    const raw = JSON.stringify({
      wcagVersion: '2.1', wcagLevel: 'AA',
      criteria: [
        { criterion: '1.1.1', obligation: 'mandatory' },
        { criterion: '', obligation: 'mandatory' },
        { obligation: 'optional' },
        { criterion: '2.1.1' },
      ],
      confidence: 0.7,
    });
    const result = parseExtractedRequirements(raw);
    expect(result.criteria).toHaveLength(1);
  });

  it('returns defaults for missing fields', () => {
    const result = parseExtractedRequirements('{}');
    expect(result.wcagVersion).toBe('unknown');
    expect(result.wcagLevel).toBe('unknown');
    expect(result.criteria).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseExtractedRequirements('not json')).toThrow();
  });
});
