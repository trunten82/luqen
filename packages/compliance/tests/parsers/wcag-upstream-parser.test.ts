import { describe, it, expect } from 'vitest';
import { parseQuickRefJson, parseTenOnJson } from '../../src/parsers/wcag-upstream-parser.js';

describe('parseQuickRefJson', () => {
  it('extracts criteria with one entry per version', () => {
    const sample = {
      'non-text-content': {
        num: '1.1.1',
        level: 'A',
        handle: 'Non-text Content',
        versions: ['2.0', '2.1'],
      },
      'contrast-minimum': {
        num: '1.4.3',
        level: 'AA',
        handle: 'Contrast (Minimum)',
        versions: ['2.0', '2.1'],
      },
    };
    const result = parseQuickRefJson(sample);
    expect(result).toHaveLength(4); // 2 criteria x 2 versions
    expect(result.filter(c => c.criterion === '1.1.1')).toHaveLength(2);
    expect(result[0].title).toBe('Non-text Content');
  });

  it('defaults to version 2.1 when versions array is missing', () => {
    const sample = {
      'test': { num: '1.1.1', level: 'A', handle: 'Test' },
    };
    const result = parseQuickRefJson(sample);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('2.1');
  });

  it('skips entries without required fields', () => {
    const sample = {
      'incomplete': { num: '1.1.1' }, // missing level and handle
      'valid': { num: '1.1.1', level: 'A', handle: 'Valid' },
    };
    const result = parseQuickRefJson(sample);
    expect(result).toHaveLength(1);
  });

  it('sorts by criterion number', () => {
    const sample = {
      'z': { num: '4.1.2', level: 'A', handle: 'Z', versions: ['2.1'] },
      'a': { num: '1.1.1', level: 'A', handle: 'A', versions: ['2.1'] },
    };
    const result = parseQuickRefJson(sample);
    expect(result[0].criterion).toBe('1.1.1');
    expect(result[1].criterion).toBe('4.1.2');
  });
});

describe('parseTenOnJson', () => {
  it('extracts criteria with specified version', () => {
    const sample = [
      { ref_id: '1.1.1', title: 'Non-text Content', level: 'A', url: 'https://example.com' },
      { ref_id: '3.3.7', title: 'Redundant Entry', level: 'A' },
    ];
    const result = parseTenOnJson(sample, '2.2');
    expect(result).toHaveLength(2);
    expect(result.every(c => c.version === '2.2')).toBe(true);
    expect(result[0].url).toBe('https://example.com');
    expect(result[1].url).toBeUndefined();
  });

  it('skips entries without required fields', () => {
    const sample = [
      { ref_id: '1.1.1' }, // missing title and level
      { ref_id: '1.1.1', title: 'Valid', level: 'A' },
    ];
    const result = parseTenOnJson(sample, '2.2');
    expect(result).toHaveLength(1);
  });
});
