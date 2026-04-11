/**
 * RemoteBrandingAdapter — wraps the dormant BrandingService behind the
 * BrandingAdapter contract for v2.11.0's per-org dual-mode routing.
 *
 * This is the first real consumer of `BrandingService` in the dashboard. The
 * class has been on disk since v2.7.0 but has zero callers; v2.11.0 finally
 * instantiates it in server.ts (Plan 17-03) and routes orgs flagged as
 * `branding_mode='remote'` through this adapter.
 *
 * Key properties:
 *
 *   1. NO silent fallback. When the remote service is unreachable or returns
 *      malformed data, this adapter THROWS. The orchestrator (Plan 17-03)
 *      catches the throw and produces a `degraded` result. We never call the
 *      embedded matcher from inside this class — that would corrupt trend
 *      data with mode-mixed scores (PITFALLS.md #6).
 *
 *   2. Explicit response validation. `BrandingService.matchIssues` returns
 *      `BrandedIssueResponse[]` where `.issue` is `Record<string, unknown>`.
 *      We do NOT cast — we run a type guard on every issue object and throw
 *      `RemoteBrandingMalformedError` if any field is missing or wrong type.
 *      A future protocol drift between the dashboard and the branding service
 *      surfaces immediately as a typed error, not as a silent unsound value.
 *
 *   3. ServiceClientRegistry is UNCHANGED. The adapter receives a
 *      constructor-injected `BrandingService` instance — Plan 17-03's wiring
 *      is `new BrandingService(config, () => registry.getBrandingTokenManager())`.
 *      The registry's `getBrandingTokenManager()` getter is the only call
 *      site touched, and that call site is read-only.
 */

import type {
  BrandedIssue,
  BrandGuideline,
  BrandMatchResult,
  MatchableIssue,
  MatchStrategy,
} from '@luqen/branding';
import type { BrandingService } from '../branding-service.js';
import type { BrandedIssueResponse } from '../../branding-client.js';
import type { BrandingAdapter, BrandingMatchContext } from './branding-adapter.js';

/**
 * Thrown when the remote branding service returns a response shape that does
 * not validate against MatchableIssue + BrandMatchResult. The orchestrator
 * (Plan 17-03) catches this and tags the scan as `degraded` with reason
 * `remote-malformed`.
 */
export class RemoteBrandingMalformedError extends Error {
  constructor(message: string, public readonly index: number) {
    super(`RemoteBrandingMalformedError at issue index ${index}: ${message}`);
    this.name = 'RemoteBrandingMalformedError';
  }
}

const VALID_ISSUE_TYPES = new Set<MatchableIssue['type']>(['error', 'warning', 'notice']);
const VALID_STRATEGIES = new Set<MatchStrategy>(['color-pair', 'font', 'selector']);

function isMatchableIssue(value: unknown): value is MatchableIssue {
  if (value === null || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o['code'] === 'string' &&
    typeof o['type'] === 'string' &&
    VALID_ISSUE_TYPES.has(o['type'] as MatchableIssue['type']) &&
    typeof o['message'] === 'string' &&
    typeof o['selector'] === 'string' &&
    typeof o['context'] === 'string'
  );
}

function translateBrandMatch(input: BrandedIssueResponse['brandMatch'], index: number): BrandMatchResult {
  if (input.matched === false) {
    return { matched: false };
  }
  // matched === true requires strategy, guidelineName, guidelineId, matchDetail
  if (
    typeof input.strategy !== 'string' ||
    !VALID_STRATEGIES.has(input.strategy as MatchStrategy) ||
    typeof input.guidelineName !== 'string' ||
    typeof input.guidelineId !== 'string' ||
    typeof input.matchDetail !== 'string'
  ) {
    throw new RemoteBrandingMalformedError(
      `brandMatch.matched=true but required fields missing or wrong type (strategy=${String(input.strategy)})`,
      index,
    );
  }
  return {
    matched: true,
    strategy: input.strategy as MatchStrategy,
    guidelineName: input.guidelineName,
    guidelineId: input.guidelineId,
    matchDetail: input.matchDetail,
  };
}

function translateResponse(
  responses: readonly BrandedIssueResponse[],
): readonly BrandedIssue[] {
  const out: BrandedIssue[] = [];
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i]!;
    if (!isMatchableIssue(r.issue)) {
      throw new RemoteBrandingMalformedError(
        `issue field is not a MatchableIssue (got: ${JSON.stringify(r.issue).slice(0, 200)})`,
        i,
      );
    }
    out.push({
      issue: r.issue,
      brandMatch: translateBrandMatch(r.brandMatch, i),
    });
  }
  return out;
}

export class RemoteBrandingAdapter implements BrandingAdapter {
  constructor(private readonly brandingService: BrandingService) {}

  async matchForSite(
    issues: readonly MatchableIssue[],
    _guideline: BrandGuideline,
    context: BrandingMatchContext,
  ): Promise<readonly BrandedIssue[]> {
    // The remote /api/v1/match endpoint resolves the guideline server-side
    // from siteUrl + orgId — we do NOT pass the local guideline. The local
    // guideline argument is part of the BrandingAdapter contract because the
    // embedded adapter NEEDS it; the remote adapter ignores it (the remote
    // service is the authoritative store for service-mode orgs).
    //
    // We pass `issues` as `unknown[]` to match the BrandingService.matchIssues
    // loose signature — the validation happens on the way back, not on the
    // way out. This matches the existing branding-client.ts contract.
    const rawIssues: unknown[] = issues as unknown as unknown[];
    const responses = await this.brandingService.matchIssues(
      rawIssues,
      context.siteUrl,
      context.orgId,
    );
    return translateResponse(responses);
  }
}
