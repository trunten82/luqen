import { describe, it, expect } from 'vitest';
import { computeSparklinePoints, computeTargetY } from '../../src/services/sparkline.js';

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

  describe('gap-aware overload', () => {
    it('omits gap indices from points but preserves x-positioning', () => {
      // values=[80,70,60], gaps={1} => points for index 0 and 2 only
      // x-positions should use original indices (0 and 2) * step
      const result = computeSparklinePoints([80, 70, 60], 100, 40, new Set([1]));
      const pairs = result.split(' ');
      expect(pairs).toHaveLength(2);
      // First point at x=0, second point at x=100 (index 2 * step where step=50)
      const x0 = parseFloat(pairs[0].split(',')[0]);
      const x1 = parseFloat(pairs[1].split(',')[0]);
      expect(x0).toBe(0);
      expect(x1).toBe(100);
    });

    it('returns empty string when all indices are gaps', () => {
      const result = computeSparklinePoints([80, 70, 60], 100, 40, new Set([0, 1, 2]));
      expect(result).toBe('');
    });

    it('returns empty string when fewer than 2 non-gap values', () => {
      const result = computeSparklinePoints([80, 70, 60], 100, 40, new Set([0, 2]));
      expect(result).toBe('');
    });

    it('behaves identically to no-gaps when gaps is empty set', () => {
      const withoutGaps = computeSparklinePoints([80, 70, 60], 100, 40);
      const withEmptyGaps = computeSparklinePoints([80, 70, 60], 100, 40, new Set());
      expect(withEmptyGaps).toBe(withoutGaps);
    });

    it('behaves identically when gaps parameter is undefined', () => {
      const withoutGaps = computeSparklinePoints([80, 70, 60], 100, 40);
      const withUndefined = computeSparklinePoints([80, 70, 60], 100, 40, undefined);
      expect(withUndefined).toBe(withoutGaps);
    });

    it('computes y-values from non-gap values only', () => {
      // values=[0, 999, 100], gaps={1} => min=0, max=100, range=100
      // index 0: y = 2 + 36 - ((0 - 0) / 100) * 36 = 38
      // index 2: y = 2 + 36 - ((100 - 0) / 100) * 36 = 2
      const result = computeSparklinePoints([0, 999, 100], 100, 40, new Set([1]));
      expect(result).toBe('0,38 100,2');
    });
  });
});

describe('computeTargetY', () => {
  it('returns y-coordinate for a target value within the data range', () => {
    // values=[0, 100], target=50 => midpoint
    // padding=2, effectiveH=36, min=0, max=100, range=100
    // y = 2 + 36 - ((50 - 0) / 100) * 36 = 2 + 36 - 18 = 20
    const y = computeTargetY(50, [0, 100], 40);
    expect(y).toBe(20);
  });

  it('returns y at top for target equal to max value', () => {
    const y = computeTargetY(100, [0, 100], 40);
    expect(y).toBe(2); // padding
  });

  it('returns y at bottom for target equal to min value', () => {
    const y = computeTargetY(0, [0, 100], 40);
    expect(y).toBe(38); // padding + effectiveH
  });

  it('returns -1 when values has fewer than 2 entries', () => {
    expect(computeTargetY(50, [], 40)).toBe(-1);
    expect(computeTargetY(50, [80], 40)).toBe(-1);
  });

  it('uses default viewBoxH=40 when not specified', () => {
    const withDefault = computeTargetY(50, [0, 100]);
    const withExplicit = computeTargetY(50, [0, 100], 40);
    expect(withDefault).toBe(withExplicit);
  });
});
