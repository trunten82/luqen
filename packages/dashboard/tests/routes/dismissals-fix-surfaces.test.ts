/**
 * Phase 88 Plan 09: the fix-PR route and the repos fixes view never propose a fix for a
 * dismissed issue (FP-11, D-06).
 *
 * Fix-PR: @luqen/core's proposeFixesFromReport is replaced by a recorder (and the git host
 * registry by a fake plugin) exactly as in the zero-dismissal API golden, so the observable
 * is the report ARGUMENT the route hands the proposer. collectIssuesFromReport is module-local
 * and receives the very same variable, so one assertion covers both fix sources.
 * Repos: the local fix-suggestion engine over the stored report, string-level over the view data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

vi.mock('@luqen/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luqen/core')>();
  const capture = await import('../golden/drivers/proposer-capture.js');
  return { ...actual, proposeFixesFromReport: capture.recordProposeFixesFromReport };
});
vi.mock('../../src/git-hosts/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/git-hosts/registry.js')>();
  const capture = await import('../golden/drivers/proposer-capture.js');
  return { ...actual, getGitHostPlugin: () => capture.fakeGitHostPlugin };
});

import {
  createApiContext,
  driveFixPrProposerInput,
  driveReposFixesView,
} from '../golden/drivers/api-drivers.js';
import type { SurfaceContext } from '../golden/drivers/render-drivers.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  REASON_TOKEN,
  SEL_ALT,
  SEL_DISMISSED,
  SEL_LINK,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  ctx = await createApiContext();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

interface FixPrOut {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly proposerCalls: ReadonlyArray<{ report: unknown }>;
}

interface FixesView {
  readonly status: number;
  readonly body: {
    readonly data: {
      readonly fixes: ReadonlyArray<{ selector: string }>;
      readonly scan: { readonly jsonReport?: string };
      readonly noReport: boolean;
    };
  };
}

describe('fix-PR route applies the scan org active dismissals before proposing', () => {
  it('fix PR never proposes a fix for a dismissed issue', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const out = (await driveFixPrProposerInput(ctx)) as FixPrOut;

    expect(out.proposerCalls).toHaveLength(1);
    const handedToProposer = JSON.stringify(out.proposerCalls[0]?.report);
    expect(handedToProposer).not.toContain(SEL_DISMISSED.replace(/^#/, ''));
    expect(handedToProposer).not.toContain(SEL_ALT.replace(/^#/, ''));
    // Same-code sibling and the unrelated finding still reach the proposer.
    expect(handedToProposer).toContain(SEL_SIBLING.replace(/^#/, ''));
    expect(handedToProposer).toContain(SEL_LINK.replace(/^#/, ''));
    expect(JSON.stringify(out)).not.toContain(REASON_TOKEN);
  });

  it('fix PR answers 422 with a fixed message when the dismissal lookup fails', async () => {
    const repo = ctx.storage.issueDismissals;
    if (repo === undefined) throw new Error('fixture storage has no issueDismissals repository');
    vi.spyOn(repo, 'listActiveForSite').mockRejectedValue(new Error('SECRET-DB-DETAIL-4471'));
    const out = (await driveFixPrProposerInput(ctx)) as FixPrOut;

    // Fail closed: nothing is proposed from an unfiltered report, and no error text is echoed.
    expect(out.status).toBe(422);
    expect(out.body['error']).toBe('Failed to apply issue dismissals to the scan report');
    expect(out.proposerCalls).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain('SECRET-DB-DETAIL-4471');
  });
});

describe('repos fixes view (/reports/:id/fixes) applies the scan org active dismissals', () => {
  it('repos fixes view omits a dismissed issue', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const out = (await driveReposFixesView(ctx)) as FixesView;

    expect(out.status).toBe(200);
    const selectors = out.body.data.fixes.map((f) => f.selector);
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).not.toContain(SEL_ALT);
    expect(selectors).toContain(SEL_SIBLING);
    expect(selectors).toContain(SEL_LINK);
    // The view data also spreads the scan row: its raw blob must follow the filtered report.
    const text = JSON.stringify(out);
    assertDismissedAbsent(text, 'both');
    assertSiblingPresent(text);
  });
});
