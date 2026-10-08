import { describe, it, expect } from 'vitest';
import {
  isNonRenderedFallbackIssue,
  withoutNonRenderedFallbackIssues,
} from '../../src/scanner/non-rendered-fallback.js';

const G18 = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const G145 = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G145.Fail';
const AAA_G17 = 'WCAG2AAA.Principle1.Guideline1_4.1_4_6.G17.Fail';
const H37 = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';

// Real selectors from the Northwind scan 00000000 (2026-10-08).
const NOSCRIPT_SEL = '#mainwprapper > div:nth-child(8) > section > div > div:nth-child(1) > noscript';
const VIDEO_SEL = '#mainwprapper > div:nth-child(9) > div > div > div > video';

describe('isNonRenderedFallbackIssue', () => {
  it('[EVIDENCE] drops htmlcs contrast on a <noscript> (raw text node when scripting is on)', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: NOSCRIPT_SEL })).toBe(true);
  });

  it('[EVIDENCE] drops htmlcs contrast on a <video> (fallback text never painted)', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: VIDEO_SEL })).toBe(true);
  });

  it('drops contrast on <audio>, G145 large-text, and the AAA 1.4.6 variant', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'main > audio' })).toBe(true);
    expect(isNonRenderedFallbackIssue({ code: G145, selector: 'video' })).toBe(true);
    expect(isNonRenderedFallbackIssue({ code: AAA_G17, selector: 'noscript' })).toBe(true);
  });

  it('drops axe color-contrast on fallback content', () => {
    expect(isNonRenderedFallbackIssue({ code: 'color-contrast', selector: 'video' })).toBe(true);
    expect(isNonRenderedFallbackIssue({ code: 'color-contrast-enhanced', selector: 'noscript' })).toBe(true);
  });

  it('drops contrast on an element INSIDE fallback content (child or descendant)', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'div > video > p' })).toBe(true);
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'video.hero p span' })).toBe(true);
  });

  it('[SYMMETRY] keeps contrast on a SIBLING of fallback content (+ and ~ are not containment)', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'div > video + p' })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'noscript ~ div' })).toBe(false);
  });

  it('[SYMMETRY] keeps NON-contrast findings on a <video> (e.g. missing captions is real)', () => {
    expect(isNonRenderedFallbackIssue({ code: 'video-caption', selector: VIDEO_SEL })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: H37, selector: 'video > img' })).toBe(false);
  });

  it('[SYMMETRY] keeps contrast on ordinary elements, incl. lookalike tag/class/id names', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: '#main > p' })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'div.video > p' })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: G18, selector: '#noscript > span' })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: G18, selector: 'video-player > p' })).toBe(false);
  });

  it('keeps issues with no selector', () => {
    expect(isNonRenderedFallbackIssue({ code: G18, selector: '' })).toBe(false);
    expect(isNonRenderedFallbackIssue({ code: G18 })).toBe(false);
  });
});

describe('withoutNonRenderedFallbackIssues', () => {
  it('returns a new array without the fallback-content contrast issues, order preserved', () => {
    const input = [
      { code: G18, selector: NOSCRIPT_SEL },
      { code: H37, selector: 'img' },
      { code: G18, selector: VIDEO_SEL },
      { code: G18, selector: '#main > p' },
    ];
    const out = withoutNonRenderedFallbackIssues(input);
    expect(out).toEqual([input[1], input[3]]);
    expect(out).not.toBe(input);
    expect(input).toHaveLength(4);
  });
});
