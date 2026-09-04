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

describe('lookupPrice — sibling-mispricing guards (D1)', () => {
  it('does NOT price gemini-2.5-flash-lite as gemini-2.5-flash', () => {
    const flash = lookupPrice('gemini', 'gemini-2.5-flash');
    const flashLite = lookupPrice('gemini', 'gemini-2.5-flash-lite');
    expect(flashLite).toBeDefined();
    expect(flashLite).not.toEqual(flash);
  });

  it('resolves gemini-2.5-pro-exp to the gemini-2.5-pro row (legitimate dated/suffixed variant)', () => {
    const price = lookupPrice('gemini', 'gemini-2.5-pro-exp');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00125);
    expect(price!.outputUsdPer1k).toBe(0.010);
  });

  it('gemini-2.5-flash-lite resolves to its own row, not to gemini-2.5-flash', () => {
    const price = lookupPrice('gemini', 'gemini-2.5-flash-lite');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.0001);
    expect(price!.outputUsdPer1k).toBe(0.0004);
  });

  it('matching rule: a bare startsWith would wrongly match a differently-suffixed sibling', () => {
    // Direct unit test of the matching rule itself (registry is frozen, so we
    // can't remove a row to prove this): "gemini-2.5-flash-lite" starts with
    // "gemini-2.5-flash" under a bare `startsWith(tail)` check, which is
    // exactly the D1 bug. The variant rule requires the separator immediately
    // after the tail, so a bare startsWith over-matches here.
    const tail = 'gemini-2.5-flash';
    const modelId = 'gemini-2.5-flash-lite';
    expect(modelId.startsWith(tail)).toBe(true); // the old, buggy check would match
    expect(modelId === tail || modelId.startsWith(`${tail}-`)) // variant rule alone is not enough
      .toBe(true);
    // The real fix is that gemini-2.5-flash-lite has its OWN row and
    // longest-key-wins selects it over the shorter gemini-2.5-flash key.
    const price = lookupPrice('gemini', modelId);
    const flashPrice = lookupPrice('gemini', 'gemini-2.5-flash');
    expect(price).not.toEqual(flashPrice);
  });

  it('still resolves gpt-4o-mini to its own row and NOT gpt-4o (no regression)', () => {
    const price = lookupPrice('openai', 'gpt-4o-mini');
    const gpt4oPrice = lookupPrice('openai', 'gpt-4o');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00015);
    expect(price).not.toEqual(gpt4oPrice);
  });

  it('still resolves the dated OpenAI variant gpt-4o-mini-2024-07-18 to gpt-4o-mini (no regression)', () => {
    const price = lookupPrice('openai', 'gpt-4o-mini-2024-07-18');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00015);
    expect(price!.outputUsdPer1k).toBe(0.0006);
  });
});

describe('lookupPrice — Gemini price-correctness guards (D2/D3)', () => {
  it('gemini-2.5-flash is corrected to 0.0003 in / 0.0025 out per 1k', () => {
    const price = lookupPrice('gemini', 'gemini-2.5-flash');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.0003);
    expect(price!.outputUsdPer1k).toBe(0.0025);
  });

  it('gemini-2.5-pro is corrected to 0.00125 in / 0.010 out per 1k', () => {
    const price = lookupPrice('gemini', 'gemini-2.5-pro');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00125);
    expect(price!.outputUsdPer1k).toBe(0.010);
  });

  it('gemini-3.7-flash (new row) is 0.00075 in / 0.00375 out per 1k', () => {
    const price = lookupPrice('gemini', 'gemini-3.7-flash');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.00075);
    expect(price!.outputUsdPer1k).toBe(0.00375);
  });

  it('gemini-2.5-flash-lite (new row) is 0.0001 in / 0.0004 out per 1k', () => {
    const price = lookupPrice('gemini', 'gemini-2.5-flash-lite');
    expect(price).toBeDefined();
    expect(price!.inputUsdPer1k).toBe(0.0001);
    expect(price!.outputUsdPer1k).toBe(0.0004);
  });
});

describe('lookupPrice — unpriced path must not regress', () => {
  it('returns undefined for a genuinely missing Gemini model', () => {
    expect(lookupPrice('gemini', 'gemini-9.9-nonexistent')).toBeUndefined();
  });

  it('computeCost on a genuinely missing Gemini model returns all nulls', () => {
    const c = computeCost('gemini', 'gemini-9.9-nonexistent', 1000, 500);
    expect(c.input).toBeNull();
    expect(c.output).toBeNull();
    expect(c.total).toBeNull();
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
