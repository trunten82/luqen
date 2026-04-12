import { describe, it, expect } from 'vitest';
import { computeSparklinePoints } from '../../src/services/sparkline.js';

describe('computeSparklinePoints', () => {
  it('returns a non-empty string of "x,y" pairs for 3+ values', () => {
    const result = computeSparklinePoints([50, 75, 60], 100, 40);
    expect(result).toBeTruthy();
    const pairs = result.split(' ');
    expect(pairs.length).toBe(3);
    for (const pair of pairs) {
      expect(pair).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/);
    }
  });

  it('returns empty string for a single value (no trend line)', () => {
    const result = computeSparklinePoints([80], 100, 40);
    expect(result).toBe('');
  });

  it('returns empty string for empty array', () => {
    const result = computeSparklinePoints([], 100, 40);
    expect(result).toBe('');
  });

  it('returns exactly "0,38 100,2" for [0, 100] with viewBox 100x40', () => {
    const result = computeSparklinePoints([0, 100], 100, 40);
    expect(result).toBe('0,38 100,2');
  });

  it('returns points with identical y-values for flat data (range fallback to 1)', () => {
    const result = computeSparklinePoints([50, 50, 50], 100, 40);
    const pairs = result.split(' ');
    const yValues = pairs.map((p) => parseFloat(p.split(',')[1]));
    // All y-values should be identical for flat data
    expect(new Set(yValues).size).toBe(1);
  });

  it('uses default viewBoxW=100 and viewBoxH=40 when not specified', () => {
    const withDefaults = computeSparklinePoints([0, 100]);
    const withExplicit = computeSparklinePoints([0, 100], 100, 40);
    expect(withDefaults).toBe(withExplicit);
  });
});
