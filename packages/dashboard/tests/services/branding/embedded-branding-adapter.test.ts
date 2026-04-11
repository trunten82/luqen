import { describe, it, expect } from 'vitest';
import { BrandingMatcher } from '@luqen/branding';
import type { BrandGuideline, MatchableIssue } from '@luqen/branding';
import { EmbeddedBrandingAdapter } from '../../../src/services/branding/embedded-branding-adapter.js';
import type { BrandingMatchContext } from '../../../src/services/branding/branding-adapter.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_GUIDELINE: BrandGuideline = {
  id: 'gd-aperol',
  orgId: 'org-aperol',
  name: 'Aperol Brand Guideline',
  version: 3,
  active: true,
  colors: [
    { id: 'c1', name: 'Aperol Orange', hexValue: '#FF6900' },
    { id: 'c2', name: 'Aperol Cream', hexValue: '#FFF6E5' },
  ],
  fonts: [
    { id: 'f1', family: 'Helvetica Neue' },
  ],
  selectors: [
    { id: 's1', pattern: '.btn-primary', description: 'Primary button' },
  ],
};

const FIXTURE_ISSUES: readonly MatchableIssue[] = [
  {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    type: 'error',
    message: 'Contrast ratio of 2.4:1 is below WCAG AA 4.5:1',
    selector: '.hero-cta',
    context: '<button class="hero-cta" style="background:#FF6900;color:#FFF6E5">Order now</button>',
  },
  {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_4.G142',
    type: 'warning',
    message: 'Text resizing not supported',
    selector: 'body',
    context: '<body style="font-family:Helvetica Neue">...</body>',
  },
  {
    code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H30.2',
    type: 'notice',
    message: 'Anchor element with no text',
    selector: '.btn-primary',
    context: '<a class="btn-primary" href="/x"></a>',
  },
];

const FIXTURE_CONTEXT: BrandingMatchContext = {
  orgId: 'org-aperol',
  siteUrl: 'https://aperol.example.com',
  scanId: 'scan-test-001',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EmbeddedBrandingAdapter', () => {
  it('matchForSite returns the EXACT same array as direct BrandingMatcher.match()', async () => {
    const adapter = new EmbeddedBrandingAdapter();
    const direct = new BrandingMatcher().match(FIXTURE_ISSUES, FIXTURE_GUIDELINE);
    const viaAdapter = await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);

    expect(viaAdapter).toEqual(direct);
    expect(viaAdapter.length).toBe(FIXTURE_ISSUES.length);
  });

  it('returns an empty array when given an empty issues list (does not throw)', async () => {
    const adapter = new EmbeddedBrandingAdapter();
    const result = await adapter.matchForSite([], FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
    expect(result).toEqual([]);
  });

  it('returns BrandedIssue[] with all brandMatch.matched=false when guideline has zero colors/fonts/selectors', async () => {
    const adapter = new EmbeddedBrandingAdapter();
    const emptyGuideline: BrandGuideline = {
      ...FIXTURE_GUIDELINE,
      colors: [],
      fonts: [],
      selectors: [],
    };
    const result = await adapter.matchForSite(FIXTURE_ISSUES, emptyGuideline, FIXTURE_CONTEXT);
    expect(result.length).toBe(FIXTURE_ISSUES.length);
    for (const branded of result) {
      expect(branded.brandMatch.matched).toBe(false);
    }
  });

  it('passes issues through unchanged — BrandedIssue.issue references match input', async () => {
    const adapter = new EmbeddedBrandingAdapter();
    const result = await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
    for (let i = 0; i < FIXTURE_ISSUES.length; i++) {
      expect(result[i]!.issue.code).toBe(FIXTURE_ISSUES[i]!.code);
      expect(result[i]!.issue.selector).toBe(FIXTURE_ISSUES[i]!.selector);
      expect(result[i]!.issue.context).toBe(FIXTURE_ISSUES[i]!.context);
    }
  });

  it('returns a Promise (interface contract requires async)', () => {
    const adapter = new EmbeddedBrandingAdapter();
    const result = adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
    expect(result).toBeInstanceOf(Promise);
  });

  it('does NOT swallow errors — a throwing matcher propagates', async () => {
    class ExplodingAdapter extends EmbeddedBrandingAdapter {
      override async matchForSite(): Promise<never> {
        throw new Error('matcher exploded');
      }
    }
    const adapter = new ExplodingAdapter();
    await expect(adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT))
      .rejects.toThrow('matcher exploded');
  });
});
