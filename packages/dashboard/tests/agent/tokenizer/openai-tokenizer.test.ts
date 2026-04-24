/**
 * Phase 34-01 Task 2 — OpenAI tokenizer tests (A–D + G).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  getOpenAiEncoder,
  _resetOpenAiCacheForTest,
  type SupportedEncoding,
} from '../../../src/agent/tokenizer/openai-tokenizer.js';

describe('openai-tokenizer', () => {
  beforeEach(() => {
    _resetOpenAiCacheForTest();
  });

  it('Test A: cl100k_base encodes "hello world" to 2 tokens', () => {
    const enc = getOpenAiEncoder('cl100k_base');
    expect(enc.countText('hello world')).toBe(2);
    expect(enc.countText('hello world hello world')).toBe(4);
    expect(enc.countText('')).toBe(0);
  });

  it('Test B: o200k_base returns positive integer counts', () => {
    const enc = getOpenAiEncoder('o200k_base');
    const n = enc.countText('hello world');
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
    expect(enc.countText('')).toBe(0);
  });

  it('Test C: encoder is cached (same instance returned across calls)', () => {
    const a = getOpenAiEncoder('cl100k_base');
    const b = getOpenAiEncoder('cl100k_base');
    expect(a).toBe(b);
  });

  it('Test D: monotonic — longer strings never encode to fewer tokens', () => {
    const enc = getOpenAiEncoder('cl100k_base');
    expect(enc.countText('abc')).toBeLessThan(enc.countText('abcdef ghijkl'));
  });

  it('Test G: unknown encoding throws with descriptive message', () => {
    expect(() => getOpenAiEncoder('unknown-enc' as unknown as SupportedEncoding)).toThrow(
      /unknown-enc/,
    );
  });
});
