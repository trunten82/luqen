/**
 * Phase 34-01 Task 2 — Anthropic tokenizer tests (E + F).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  getAnthropicEncoder,
  _resetAnthropicCacheForTest,
} from '../../../src/agent/tokenizer/anthropic-tokenizer.js';

describe('anthropic-tokenizer', () => {
  beforeEach(() => {
    _resetAnthropicCacheForTest();
  });

  it('Test E: positive integer for "hello world"; 0 for empty; monotonic', () => {
    const enc = getAnthropicEncoder();
    const n = enc.countText('hello world');
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
    expect(enc.countText('')).toBe(0);
    expect(enc.countText('abc')).toBeLessThan(enc.countText('abc def ghi jkl'));
  });

  it('Test F: singleton returned across calls', () => {
    const a = getAnthropicEncoder();
    const b = getAnthropicEncoder();
    expect(a).toBe(b);
  });
});
