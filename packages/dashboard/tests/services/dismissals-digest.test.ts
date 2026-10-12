/**
 * Phase 88 Plan 04: digest per-criterion counts exclude dismissed occurrences (D-06).
 *
 * The digest only exposes per-criterion DELTAS, so the baseline here is a completed scan
 * with an empty report: every delta then equals the current scan's criterion count.
 * Real SQLite store (Plan 01 fixture), Fabrikam org; foreign dismissals are seeded by
 * createSurfaceContext and must never apply.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { buildDigest, type DigestData } from '../../src/services/digest-service.js';
import type { StorageAdapter } from '../../src/db/index.js';
import {
  createSurfaceContext,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  seedSurfaceDismissal,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

const PERIOD = { start: '2026-09-25T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z' } as const;

let ctx: SurfaceContext;

beforeEach(async () => {
  ctx = await createSurfaceContext();
  // Baseline before the period with an empty report: deltas == the current counts.
  await seedSurfaceScan(ctx.storage, {
    orgId: ctx.orgs.fabrikamOrgId,
    location: 'db',
    id: 'scan-fabrikam-baseline-empty',
    report: { pages: [{ url: FABRIKAM_SITE, issues: [], issueCount: 0 }] },
    createdAt: '2026-09-01T10:00:00.000Z',
    completedAt: '2026-09-01T10:05:00.000Z',
  });
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

async function criteria(storage: StorageAdapter = ctx.storage): Promise<Record<string, number>> {
  const digest: DigestData = await buildDigest(
    storage,
    { orgId: ctx.orgs.fabrikamOrgId, siteUrl: null },
    PERIOD,
  );
  const site = digest.sites.find((s) => s.siteUrl === FABRIKAM_SITE);
  expect(site?.hasNewScan).toBe(true);
  return Object.fromEntries((site?.criteriaChanges ?? []).map((c) => [c.criterion, c.newFindings]));
}

/** The same store, seen through a storage whose dismissal repository is `repo`. */
function withDismissalRepo(repo: unknown): StorageAdapter {
  return Object.create(ctx.storage, { issueDismissals: { value: repo } }) as StorageAdapter;
}

describe('digest criterion counts', () => {
  it('digest criterion counts exclude a dismissed finding', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const counts = await criteria();

    // 1.4.3: 4 occurrences (3 dismissed + 1 sibling) -> 1. 1.1.1: its only finding dismissed -> absent.
    expect(counts['1.4.3']).toBe(1);
    expect(counts).not.toHaveProperty('1.1.1');
    expect(counts['2.4.4']).toBe(2);
  });

  it('digest is unchanged when the storage has no dismissal repository', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const counts = await criteria(withDismissalRepo(undefined));

    expect(counts['1.4.3']).toBe(4);
    expect(counts['1.1.1']).toBe(1);
    expect(counts['2.4.4']).toBe(2);
  });

  it('digest without any active dismissal reports the raw criterion counts', async () => {
    const counts = await criteria();
    expect(counts['1.4.3']).toBe(4);
    expect(counts['1.1.1']).toBe(1);
  });

  it('digest degrades to no per-criterion changes when the dismissal lookup throws (loadReport never throws)', async () => {
    await dismiss(DISMISS_PARTIAL);
    const failing = withDismissalRepo({
      listActiveForSite: async () => {
        throw new Error('lookup failed');
      },
    });
    expect(await criteria(failing)).toEqual({});
  });
});
