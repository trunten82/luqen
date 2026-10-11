/**
 * Phase 88 Plan 06: the public ACR path applies active dismissals and discloses
 * them per criterion (FP-07, D-09..D-11). Plan 14 appends the report VPAT, the
 * share and the report-page paths to this file.
 *
 * Drives the REAL public route with the REAL store (Plan 01 drivers). Foreign
 * dismissals (Northwind on the same URL, Fabrikam on another site) are seeded
 * by createSurfaceContext and must never apply.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  createSurfaceContext,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { driveVpatModel, drivePublicAcrHtml } from '../golden/drivers/acr-export-drivers.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  REASON_TOKEN,
  seedSurfaceDismissal,
} from '../helpers/dismissal-surface-fixture.js';

let ctx: SurfaceContext;

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

const SENTENCE_THREE = '3 automated findings were dismissed as false positives after review.';
const SENTENCE_ONE = '1 automated finding was dismissed as a false positive after review.';

interface VpatModel {
  readonly tablesByLevel: ReadonlyArray<{
    readonly rows: ReadonlyArray<{ readonly criterion: string; readonly conformance: string; readonly remarks: string }>;
  }>;
}

function rowOf(vpat: VpatModel, criterion: string) {
  return vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === criterion);
}

/** The table row (<tr>...</tr>) of the public ACR HTML that carries the given criterion. */
function htmlRowOf(html: string, criterion: string): string {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((r) => r.includes(`>${criterion}<`) || r.includes(`${criterion}</`));
  if (row === undefined) throw new Error(`no table row for criterion ${criterion} in the public ACR HTML`);
  return row;
}

describe('public ACR (/reports/:id/acr) applies the scan org active dismissals', () => {
  it('public ACR discloses dismissed findings per criterion', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const html = await drivePublicAcrHtml(ctx, ctx.scanId);

    expect(html).toContain(SENTENCE_THREE);
    expect(html).toContain(SENTENCE_ONE);

    // 1.4.3 keeps failing through the same-code sibling; 1.1.1 lost its only finding.
    const contrast = htmlRowOf(html, '1.4.3');
    expect(contrast).toContain('Does Not Support');
    expect(contrast).toContain(SENTENCE_THREE);
    const alt = htmlRowOf(html, '1.1.1');
    expect(alt).not.toContain('Does Not Support');
    expect(alt).toContain(SENTENCE_ONE);

    // Counts only: neither the reason nor the actor is on a public document.
    expect(html).not.toContain(REASON_TOKEN);
    expect(html).not.toContain('fabrikam-admin');
  });

  it('public ACR verdicts through the shared assembly follow the filtered report (D-10)', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const vpat = (await driveVpatModel(ctx)) as VpatModel;
    expect(rowOf(vpat, '1.4.3')?.conformance).toBe('Does Not Support');
    expect(rowOf(vpat, '1.1.1')?.conformance).not.toBe('Does Not Support');
  });

  it('public ACR carries no disclosure when the only dismissals are another org or another site', async () => {
    // createSurfaceContext already seeded Northwind-on-the-same-URL and Fabrikam-on-another-site.
    const html = await drivePublicAcrHtml(ctx, ctx.scanId);
    expect(html).not.toContain('dismissed as');
    expect(html).not.toContain(REASON_TOKEN);
  });
});
