import { describe, it, expect } from 'vitest';
import { getFixForIssue } from '../../src/fixer/fix-rules.js';

describe('getFixForIssue', () => {
  it('proposes alt="" for img missing alt', () => {
    const fix = getFixForIssue({ code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', type: 'error', message: 'Img element missing an alt attribute', selector: 'img', context: '<img src="/photo.jpg">' });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('alt=""');
  });

  it('proposes aria-label for input missing label', () => {
    const fix = getFixForIssue({ code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent', type: 'error', message: 'Input element does not have a label', selector: 'input', context: '<input type="text" name="email">' });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('aria-label');
  });

  it('proposes lang attribute for html missing lang', () => {
    const fix = getFixForIssue({ code: 'WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2', type: 'error', message: 'The html element should have a lang attribute', selector: 'html', context: '<html>' });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('lang="en"');
  });

  it('returns null for unfixable issues', () => {
    const fix = getFixForIssue({ code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42', type: 'warning', message: 'Heading markup should be used', selector: 'p', context: '<p class="title">Big text</p>' });
    expect(fix).toBeNull();
  });
});
