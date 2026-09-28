import { describe, it, expect } from 'vitest';
import { discoveryWarningFrom } from '../../src/scanner/discovery-warning.js';

describe('discoveryWarningFrom', () => {
  it('W1: a waf warning maps to waf-blocked', () => {
    expect(discoveryWarningFrom({ wafWarning: 'blocked' })).toBe('waf-blocked');
  });

  it('W2: a browser fallback maps to waf-browser-discovery', () => {
    expect(discoveryWarningFrom({ discoveryFallback: 'browser' })).toBe('waf-browser-discovery');
  });

  it('W3: no warning and no fallback maps to nothing', () => {
    expect(discoveryWarningFrom({})).toBeUndefined();
  });

  it('W4: a blocked result wins over a fallback', () => {
    expect(discoveryWarningFrom({ wafWarning: 'blocked', discoveryFallback: 'browser' })).toBe('waf-blocked');
  });

  it('W5: an empty waf warning string maps to nothing', () => {
    expect(discoveryWarningFrom({ wafWarning: '' })).toBeUndefined();
  });
});
