import { describe, it, expect, vi } from 'vitest';
import type { BrandGuideline, MatchableIssue } from '@luqen/branding';
import type { BrandedIssueResponse } from '../../../src/branding-client.js';
import type { BrandingService } from '../../../src/services/branding-service.js';
import type { BrandingMatchContext } from '../../../src/services/branding/branding-adapter.js';
import {
  RemoteBrandingAdapter,
  RemoteBrandingMalformedError,
} from '../../../src/services/branding/remote-branding-adapter.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_GUIDELINE: BrandGuideline = {
  id: 'gd-aperol',
  orgId: 'org-aperol',
  name: 'Aperol Brand Guideline',
  version: 3,
  active: true,
  colors: [{ id: 'c1', name: 'Aperol Orange', hexValue: '#FF6900' }],
  fonts: [{ id: 'f1', family: 'Helvetica Neue' }],
  selectors: [{ id: 's1', pattern: '.btn-primary' }],
};

const FIXTURE_ISSUES: readonly MatchableIssue[] = [
  {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    type: 'error',
    message: 'Contrast ratio of 2.4:1 is below WCAG AA 4.5:1',
    selector: '.hero-cta',
    context: '<button class="hero-cta">Order now</button>',
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

function makeWellFormedResponse(): readonly BrandedIssueResponse[] {
  return [
    {
      issue: { ...FIXTURE_ISSUES[0]! },
      brandMatch: {
        matched: true,
        strategy: 'color-pair',
        guidelineName: 'Aperol Brand Guideline',
        guidelineId: 'gd-aperol',
        matchDetail: 'background:#FF6900 matches Aperol Orange',
      },
    },
    {
      issue: { ...FIXTURE_ISSUES[1]! },
      brandMatch: { matched: false },
    },
  ];
}

function makeMockBrandingService(
  matchIssuesImpl: () => Promise<readonly BrandedIssueResponse[]>,
): { service: BrandingService; matchIssues: ReturnType<typeof vi.fn> } {
  const matchIssues = vi.fn(matchIssuesImpl);
  // Cast through unknown — we only need .matchIssues to exist on the mock.
  const service = { matchIssues } as unknown as BrandingService;
  return { service, matchIssues };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RemoteBrandingAdapter', () => {
  it('calls brandingService.matchIssues with the issues, siteUrl, and orgId from context', async () => {
    const { service, matchIssues } = makeMockBrandingService(async () => makeWellFormedResponse());
    const adapter = new RemoteBrandingAdapter(service);
    await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);

    expect(matchIssues).toHaveBeenCalledTimes(1);
    const [issuesArg, siteUrlArg, orgIdArg] = matchIssues.mock.calls[0]!;
    expect(issuesArg).toEqual(FIXTURE_ISSUES);
    expect(siteUrlArg).toBe('https://aperol.example.com');
    expect(orgIdArg).toBe('org-aperol');
  });

  it('happy path: returns typed BrandedIssue[] with deeply equal contents (matched + unmatched mix)', async () => {
    const { service } = makeMockBrandingService(async () => makeWellFormedResponse());
    const adapter = new RemoteBrandingAdapter(service);
    const result = await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);

    expect(result).toHaveLength(2);
    expect(result[0]!.issue.code).toBe(FIXTURE_ISSUES[0]!.code);
    expect(result[0]!.brandMatch.matched).toBe(true);
    if (result[0]!.brandMatch.matched) {
      expect(result[0]!.brandMatch.strategy).toBe('color-pair');
      expect(result[0]!.brandMatch.guidelineId).toBe('gd-aperol');
      expect(result[0]!.brandMatch.matchDetail).toBe('background:#FF6900 matches Aperol Orange');
    }
    expect(result[1]!.brandMatch.matched).toBe(false);
  });

  it('throws RemoteBrandingMalformedError when issue object is missing the code field', async () => {
    const malformed: readonly BrandedIssueResponse[] = [
      {
        issue: { type: 'error', message: 'no code', selector: 'a', context: 'b' },
        brandMatch: { matched: false },
      },
    ];
    const { service } = makeMockBrandingService(async () => malformed);
    const adapter = new RemoteBrandingAdapter(service);
    await expect(adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT))
      .rejects.toBeInstanceOf(RemoteBrandingMalformedError);
  });

  it('throws RemoteBrandingMalformedError when issue.type is outside error/warning/notice', async () => {
    const malformed: readonly BrandedIssueResponse[] = [
      {
        issue: { code: 'X', type: 'critical', message: 'm', selector: 's', context: 'c' },
        brandMatch: { matched: false },
      },
    ];
    const { service } = makeMockBrandingService(async () => malformed);
    const adapter = new RemoteBrandingAdapter(service);
    await expect(adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT))
      .rejects.toBeInstanceOf(RemoteBrandingMalformedError);
  });

  it('throws RemoteBrandingMalformedError when matched=true but strategy field is absent', async () => {
    const malformed: readonly BrandedIssueResponse[] = [
      {
        issue: { ...FIXTURE_ISSUES[0]! },
        brandMatch: {
          matched: true,
          guidelineName: 'g',
          guidelineId: 'gid',
          matchDetail: 'd',
          // strategy intentionally omitted
        },
      },
    ];
    const { service } = makeMockBrandingService(async () => malformed);
    const adapter = new RemoteBrandingAdapter(service);
    await expect(adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT))
      .rejects.toBeInstanceOf(RemoteBrandingMalformedError);
  });

  it('throws RemoteBrandingMalformedError when matched=true but strategy is outside the valid set', async () => {
    const malformed: readonly BrandedIssueResponse[] = [
      {
        issue: { ...FIXTURE_ISSUES[0]! },
        brandMatch: {
          matched: true,
          strategy: 'wildcard',
          guidelineName: 'g',
          guidelineId: 'gid',
          matchDetail: 'd',
        },
      },
    ];
    const { service } = makeMockBrandingService(async () => malformed);
    const adapter = new RemoteBrandingAdapter(service);
    await expect(adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT))
      .rejects.toBeInstanceOf(RemoteBrandingMalformedError);
  });

  it('propagates network errors as-is, NOT wrapped in RemoteBrandingMalformedError', async () => {
    const { service } = makeMockBrandingService(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:4300');
    });
    const adapter = new RemoteBrandingAdapter(service);
    const promise = adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
    await expect(promise).rejects.toThrow('ECONNREFUSED 127.0.0.1:4300');
    await expect(promise).rejects.not.toBeInstanceOf(RemoteBrandingMalformedError);
  });

  it('returns empty array when remote service legitimately returns empty array', async () => {
    const { service } = makeMockBrandingService(async () => []);
    const adapter = new RemoteBrandingAdapter(service);
    const result = await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
    expect(result).toEqual([]);
  });

  it('only calls matchIssues — does NOT touch any other BrandingService method (no embedded fallback)', async () => {
    const matchIssues = vi.fn(async () => makeWellFormedResponse());
    const listGuidelines = vi.fn();
    const getGuideline = vi.fn();
    const getGuidelineForSite = vi.fn();
    const service = { matchIssues, listGuidelines, getGuideline, getGuidelineForSite } as unknown as BrandingService;

    const adapter = new RemoteBrandingAdapter(service);
    await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);

    expect(matchIssues).toHaveBeenCalledTimes(1);
    expect(listGuidelines).not.toHaveBeenCalled();
    expect(getGuideline).not.toHaveBeenCalled();
    expect(getGuidelineForSite).not.toHaveBeenCalled();
  });

  it('error message points to the index of the offending malformed row', async () => {
    const wellFormed = makeWellFormedResponse()[0]!;
    const malformed: readonly BrandedIssueResponse[] = [
      wellFormed,
      wellFormed,
      // index 2: malformed (missing fields)
      {
        issue: { code: 'X' /* missing type, message, selector, context */ },
        brandMatch: { matched: false },
      },
    ];
    const { service } = makeMockBrandingService(async () => malformed);
    const adapter = new RemoteBrandingAdapter(service);
    try {
      await adapter.matchForSite(FIXTURE_ISSUES, FIXTURE_GUIDELINE, FIXTURE_CONTEXT);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteBrandingMalformedError);
      expect((err as RemoteBrandingMalformedError).index).toBe(2);
      expect((err as Error).message).toContain('index 2');
    }
  });
});
