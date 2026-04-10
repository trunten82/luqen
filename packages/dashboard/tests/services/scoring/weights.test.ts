import { describe, it, expect } from 'vitest';
import { WEIGHTS, type WeightKey } from '../../../src/services/scoring/weights.js';

describe('WEIGHTS (locked composite weights, D-05)', () => {
  it('sets color weight to exactly 0.50', () => {
    expect(WEIGHTS.color).toBe(0.50);
  });

  it('sets typography weight to exactly 0.30', () => {
    expect(WEIGHTS.typography).toBe(0.30);
  });

  it('sets components weight to exactly 0.20', () => {
    expect(WEIGHTS.components).toBe(0.20);
  });

  it('sums to 1.0 within floating-point tolerance', () => {
    const sum = WEIGHTS.color + WEIGHTS.typography + WEIGHTS.components;
    expect(Math.abs(sum - 1.0)).toBeLessThan(Number.EPSILON * 4);
  });

  it('is frozen at runtime (Object.isFrozen)', () => {
    expect(Object.isFrozen(WEIGHTS)).toBe(true);
  });

  it('rejects runtime mutation in strict mode', () => {
    'use strict';
    expect(() => {
      // @ts-expect-error — readonly at compile time, frozen at runtime
      WEIGHTS.color = 0.4;
    }).toThrow();
  });

  it('exposes exactly three weight keys', () => {
    const keys: WeightKey[] = Object.keys(WEIGHTS) as WeightKey[];
    expect(keys.sort()).toEqual(['color', 'components', 'typography']);
  });
});
