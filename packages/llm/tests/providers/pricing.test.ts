/**
 * Phase 74 — Pricing registry lookup + cost computation.
 */
import { describe, it, expect } from 'vitest';
import { lookupPrice, computeCost } from '../../src/providers/pricing.js';

describe('lookupPrice', () => {
  it('returns price for a known canonical OpenAI model', () => {
    const price = lookupPrice('openai', 'gpt-4o-mini');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00015);
    expect(price!.outputUsdPer1k).toBe(0.0006);
  });

  it('matches the dated OpenAI variant via prefix', () => {
    const dated = lookupPrice('openai', 'gpt-4o-mini-2024-07-18');
    expect(dated).toBeDefined();
    expect(dated!.inputUsdPer1k).toBe(0.00015);
  });

  it('prefers the longer-matching prefix (gpt-4o-mini wins over gpt-4)', () => {
    // The matcher rule says longest key wins; gpt-4o-mini is longer
    // than gpt-4 so it should be selected for gpt-4o-mini-anything.
    const price = lookupPrice('openai', 'gpt-4o-mini-foo');
    expect(price!.inputUsdPer1k).toBe(0.00015);
  });

  it('returns undefined for an unknown model', () => {
    expect(lookupPrice('openai', 'gpt-99-nope')).toBeUndefined();
  });

  it('returns zero pricing for ollama regardless of model name', () => {
    const price = lookupPrice('ollama', 'llama3.2:70b-instruct-q8_0');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0);
    expect(price!.outputUsdPer1k).toBe(0);
  });

  it('returns price for Anthropic Claude 3.5 Sonnet', () => {
    const price = lookupPrice('anthropic', 'claude-3.5-sonnet-20241022');
    expect(price).toBeDefined();
    expect(price!.outputUsdPer1k).toBe(0.015);
  });
});

describe('computeCost', () => {
  it('returns nulls when price is unknown', () => {
    const c = computeCost('openai', 'gpt-99-nope', 1000, 500);
    expect(c.input).toBeNull();
    expect(c.output).toBeNull();
    expect(c.total).toBeNull();
  });

  it('computes USD from token counts × per-1k price', () => {
    const c = computeCost('openai', 'gpt-4o-mini', 1000, 500);
    expect(c.input).toBeCloseTo(0.00015, 8);
    expect(c.output).toBeCloseTo(0.0003, 8);
    expect(c.total).toBeCloseTo(0.00045, 8);
  });

  it('Ollama always returns zero cost (free for self-hosted)', () => {
    const c = computeCost('ollama', 'llama3.2', 50_000, 25_000);
    expect(c.input).toBe(0);
    expect(c.output).toBe(0);
    expect(c.total).toBe(0);
  });

  it('zero-token call yields zero cost', () => {
    const c = computeCost('openai', 'gpt-4o-mini', 0, 0);
    expect(c.total).toBe(0);
  });
});
