import { describe, it, expect, vi } from 'vitest';
import type {
  BrandedIssue,
  BrandGuideline,
  MatchableIssue,
} from '@luqen/branding';
import type { OrgRepository } from '../../../src/db/interfaces/org-repository.js';
import type { BrandingAdapter } from '../../../src/services/branding/branding-adapter.js';
import { RemoteBrandingMalformedError } from '../../../src/services/branding/remote-branding-adapter.js';
import {
  BrandingOrchestrator,
  type MatchAndScoreInput,
} from '../../../src/services/branding/branding-orchestrator.js';

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
  fonts: [{ id: 'f1', family: 'Helvetica Neue' }],
  selectors: [{ id: 's1', pattern: '.btn-primary' }],
};

const FIXTURE_ISSUES: readonly MatchableIssue[] = [
  {
    code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
    type: 'error',
    message: 'Contrast ratio of 2.4:1 is below WCAG AA 4.5:1',
    selector: '.hero-cta',
    context: '<button class="hero-cta" style="background:#FF6900;color:#FFF6E5">Order now</button>',
  },
];

const FIXTURE_INPUT: MatchAndScoreInput = {
  orgId: 'org-aperol',
  siteUrl: 'https://aperol.example.com',
  scanId: 'scan-test-001',
  issues: FIXTURE_ISSUES,
  guideline: FIXTURE_GUIDELINE,
};

function makeMockOrgRepo(modes: ReadonlyArray<'embedded' | 'remote'>): {
  repo: OrgRepository;
  getBrandingMode: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const getBrandingMode = vi.fn(async (_orgId: string) => {
    const mode = modes[i % modes.length]!;
    i++;
    return mode;
  });
  // Cast — we only need .getBrandingMode on the mock for the orchestrator.
  const repo = { getBrandingMode } as unknown as OrgRepository;
  return { repo, getBrandingMode };
}

function makeMockAdapter(
  impl: () => Promise<readonly BrandedIssue[]>,
): { adapter: BrandingAdapter; matchForSite: ReturnType<typeof vi.fn> } {
  const matchForSite = vi.fn(impl);
  const adapter = { matchForSite } as unknown as BrandingAdapter;
  return { adapter, matchForSite };
}

function brandedIssue(
  issue: MatchableIssue,
  matched: boolean,
): BrandedIssue {
  return matched
    ? {
        issue,
        brandMatch: {
          matched: true,
          strategy: 'color-pair',
          guidelineName: FIXTURE_GUIDELINE.name,
          guidelineId: FIXTURE_GUIDELINE.id,
          matchDetail: 'background:#FF6900 matches Aperol Orange',
        },
      }
    : {
        issue,
        brandMatch: { matched: false },
      };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BrandingOrchestrator', () => {
  it('happy path embedded — returns matched result, calls embedded only', async () => {
    const { repo } = makeMockOrgRepo(['embedded']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => [
      brandedIssue(FIXTURE_ISSUES[0]!, true),
    ]);
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected matched');
    expect(result.mode).toBe('embedded');
    expect(result.brandedIssues).toHaveLength(1);
    expect(result.scoreResult).toBeDefined();
    expect(result.brandRelatedCount).toBe(1);
    expect(embeddedFn).toHaveBeenCalledTimes(1);
    expect(remoteFn).not.toHaveBeenCalled();
  });

  it('happy path remote — returns matched result, calls remote only', async () => {
    const { repo } = makeMockOrgRepo(['remote']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => []);
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => [
      brandedIssue(FIXTURE_ISSUES[0]!, true),
    ]);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected matched');
    expect(result.mode).toBe('remote');
    expect(remoteFn).toHaveBeenCalledTimes(1);
    expect(embeddedFn).not.toHaveBeenCalled();
  });

  it('per-request mode read — flipping mode between calls picks the new adapter without restart', async () => {
    const { repo, getBrandingMode } = makeMockOrgRepo(['embedded', 'remote']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => [
      brandedIssue(FIXTURE_ISSUES[0]!, false),
    ]);
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => [
      brandedIssue(FIXTURE_ISSUES[0]!, false),
    ]);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    await orch.matchAndScore(FIXTURE_INPUT);
    await orch.matchAndScore(FIXTURE_INPUT);

    expect(getBrandingMode).toHaveBeenCalledTimes(2);
    expect(embeddedFn).toHaveBeenCalledTimes(1);
    expect(remoteFn).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: remote throw does NOT invoke the embedded adapter — degraded with reason=remote-unavailable', async () => {
    const { repo } = makeMockOrgRepo(['remote']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => []);
    const { adapter: remoteAdapter } = makeMockAdapter(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:4300');
    });

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('degraded');
    if (result.kind !== 'degraded') throw new Error('expected degraded');
    expect(result.mode).toBe('remote');
    expect(result.reason).toBe('remote-unavailable');
    expect(result.error).toContain('ECONNREFUSED');

    // THE most important assertion in Phase 17:
    expect(embeddedFn).toHaveBeenCalledTimes(0);
  });

  it('remote malformed response degrades to reason=remote-malformed (still no embedded fallback)', async () => {
    const { repo } = makeMockOrgRepo(['remote']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => []);
    const { adapter: remoteAdapter } = makeMockAdapter(async () => {
      throw new RemoteBrandingMalformedError('issue field missing code', 0);
    });

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('degraded');
    if (result.kind !== 'degraded') throw new Error('expected degraded');
    expect(result.reason).toBe('remote-malformed');
    expect(embeddedFn).toHaveBeenCalledTimes(0);
  });

  it('embedded throw degrades to reason=embedded-error (no remote fallback either)', async () => {
    const { repo } = makeMockOrgRepo(['embedded']);
    const { adapter: embeddedAdapter } = makeMockAdapter(async () => {
      throw new Error('matcher exploded');
    });
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('degraded');
    if (result.kind !== 'degraded') throw new Error('expected degraded');
    expect(result.mode).toBe('embedded');
    expect(result.reason).toBe('embedded-error');
    expect(result.error).toContain('matcher exploded');
    expect(remoteFn).not.toHaveBeenCalled();
  });

  it('no-guideline path (embedded mode) — neither adapter called', async () => {
    const { repo } = makeMockOrgRepo(['embedded']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => []);
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore({ ...FIXTURE_INPUT, guideline: null });

    expect(result.kind).toBe('no-guideline');
    if (result.kind !== 'no-guideline') throw new Error('expected no-guideline');
    expect(result.mode).toBe('embedded');
    expect(embeddedFn).not.toHaveBeenCalled();
    expect(remoteFn).not.toHaveBeenCalled();
  });

  it('no-guideline path (remote mode) — neither adapter called', async () => {
    const { repo } = makeMockOrgRepo(['remote']);
    const { adapter: embeddedAdapter, matchForSite: embeddedFn } = makeMockAdapter(async () => []);
    const { adapter: remoteAdapter, matchForSite: remoteFn } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore({ ...FIXTURE_INPUT, guideline: null });

    expect(result.kind).toBe('no-guideline');
    if (result.kind !== 'no-guideline') throw new Error('expected no-guideline');
    expect(result.mode).toBe('remote');
    expect(embeddedFn).not.toHaveBeenCalled();
    expect(remoteFn).not.toHaveBeenCalled();
  });

  it('calculator is wired — scored result with overall in 0..100', async () => {
    const { repo } = makeMockOrgRepo(['embedded']);
    const { adapter: embeddedAdapter } = makeMockAdapter(async () => [
      brandedIssue(FIXTURE_ISSUES[0]!, true),
    ]);
    const { adapter: remoteAdapter } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected matched');
    // Phase 15 calculator returns either {kind:'scored',...} or {kind:'unscorable',...}
    expect(['scored', 'unscorable']).toContain(result.scoreResult.kind);
    if (result.scoreResult.kind === 'scored') {
      expect(typeof result.scoreResult.overall).toBe('number');
      expect(result.scoreResult.overall).toBeGreaterThanOrEqual(0);
      expect(result.scoreResult.overall).toBeLessThanOrEqual(100);
    }
  });

  it('brandRelatedCount equals the count of brandMatch.matched===true entries', async () => {
    const { repo } = makeMockOrgRepo(['embedded']);
    const { adapter: embeddedAdapter } = makeMockAdapter(async () => {
      const issues: BrandedIssue[] = [];
      for (let i = 0; i < 5; i++) {
        issues.push(
          brandedIssue(
            { ...FIXTURE_ISSUES[0]!, selector: `.x${i}` },
            i < 3, // first 3 matched, last 2 not
          ),
        );
      }
      return issues;
    });
    const { adapter: remoteAdapter } = makeMockAdapter(async () => []);

    const orch = new BrandingOrchestrator(repo, embeddedAdapter, remoteAdapter);
    const result = await orch.matchAndScore(FIXTURE_INPUT);

    expect(result.kind).toBe('matched');
    if (result.kind !== 'matched') throw new Error('expected matched');
    expect(result.brandedIssues).toHaveLength(5);
    expect(result.brandRelatedCount).toBe(3);
  });
});
