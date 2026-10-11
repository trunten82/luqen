/**
 * Phase 88 Plan 04: wiring pin for the AI-summary prior-scan pattern loop.
 *
 * HONEST SCOPE: this is a WIRING PIN, not a behaviour test. The loop's output is unused
 * today: it reads `priorData.issueGroups`, a key normalizeReportData never returns
 * (it returns `allIssueGroups`), so `recurringPatterns` is always empty. That is a
 * pre-existing finding (88-01, deferred-items.md) and is deliberately NOT fixed here.
 * What this pins is that each prior report is loaded through the dismissal loader with
 * THAT prior scan's org and site (not the current scan's), so the day the key is fixed
 * the loop does not silently count dismissed findings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

vi.mock('../../src/services/issue-dismissals/load-dismissed-report.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/issue-dismissals/load-dismissed-report.js')>();
  return { ...actual, applyActiveDismissals: vi.fn(actual.applyActiveDismissals) };
});

import { applyActiveDismissals } from '../../src/services/issue-dismissals/load-dismissed-report.js';
import {
  PRIOR_SCAN_ID,
  createSurfaceContext,
  driveAiSummaryInput,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { FABRIKAM_SITE, FIXED_SCAN_ID } from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  registerViewHelpers();
  vi.mocked(applyActiveDismissals).mockClear();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('AI summary prior-scan pattern loop', () => {
  it('AI summary pattern detection loads prior reports through the dismissal loader', async () => {
    await driveAiSummaryInput(ctx, ctx.scanId);

    const scansPassed = vi
      .mocked(applyActiveDismissals)
      .mock.calls.map(([, scan]) => scan as { id: string; orgId: string; siteUrl: string });
    const priorCalls = scansPassed.filter((s) => s.id === PRIOR_SCAN_ID);

    expect(priorCalls).toHaveLength(1);
    expect(priorCalls[0]?.orgId).toBe(ctx.orgs.fabrikamOrgId);
    expect(priorCalls[0]?.siteUrl).toBe(FABRIKAM_SITE);
    // The current scan went through the loader exactly once as well (handler load, not the loop).
    expect(scansPassed.filter((s) => s.id === FIXED_SCAN_ID)).toHaveLength(1);
  });
});
