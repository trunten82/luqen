/**
 * Phase 88 Plan 14: the PDF-producing ACR paths (the fleet report, vpat.pdf and
 * vpat-pack.zip) apply the scan org's active dismissals and disclose them per
 * criterion (FP-07, D-09..D-11).
 *
 * No PDF bytes are asserted. The two generators are mocked to record their
 * ARGUMENTS: generateVpatPdf's vpat (the PDFKit model the fleet report hands
 * over) and generateAcrPdf's AcrView (what Chromium would print for vpat.pdf and
 * the evidence pack). Counts only: REASON_TOKEN and the actor never appear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import {
  createSurfaceContext,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { driveFleetVpatInput } from '../golden/drivers/acr-export-drivers.js';
import { resetPdfCapture } from '../golden/drivers/pdf-capture.js';
import {
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  REASON_TOKEN,
  restoreClock,
  seedSurfaceDismissal,
  useFixedClock,
} from '../helpers/dismissal-surface-fixture.js';

// The vpat PDFKit generator (fleet report, and the fallback of the ACR PDF) records its arguments.
vi.mock('../../src/pdf/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pdf/generator.js')>();
  const capture = await import('../golden/drivers/pdf-capture.js');
  return {
    ...actual,
    generatePdfFromData: capture.captureReportPdf,
    generateVpatPdf: capture.captureVpatPdf,
  };
});

const SENTENCE_THREE = '3 automated findings were dismissed as false positives after review.';
const SENTENCE_ONE = '1 automated finding was dismissed as a false positive after review.';

let ctx: SurfaceContext;

beforeEach(async () => {
  useFixedClock();
  resetPdfCapture();
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
  restoreClock();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

interface VpatRowShape {
  readonly criterion: string;
  readonly conformance: string;
  readonly remarks: string;
  readonly dismissedCount?: number;
}

function vpatRow(captured: unknown, criterion: string): VpatRowShape {
  const vpat = (captured as { vpat: { tablesByLevel: ReadonlyArray<{ rows: readonly VpatRowShape[] }> } }).vpat;
  const row = vpat.tablesByLevel.flatMap((t) => t.rows).find((r) => r.criterion === criterion);
  if (row === undefined) throw new Error(`no VPAT row for ${criterion}`);
  return row;
}

function expectDisclosure(contrast: VpatRowShape, alt: VpatRowShape): void {
  // 1.4.3 keeps failing through the same-code sibling; 1.1.1 lost its only finding.
  expect(contrast.conformance).toBe('Does Not Support');
  expect(contrast.remarks.endsWith(SENTENCE_THREE)).toBe(true);
  expect(alt.conformance).not.toBe('Does Not Support');
  expect(alt.remarks.endsWith(SENTENCE_ONE)).toBe(true);
}

describe('fleet report applies the scan org active dismissals', () => {
  it('fleet report discloses dismissed findings per criterion', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const captured = await driveFleetVpatInput(ctx);

    const contrast = vpatRow(captured, '1.4.3');
    const alt = vpatRow(captured, '1.1.1');
    expect(contrast.dismissedCount).toBe(3);
    expect(alt.dismissedCount).toBe(1);
    expectDisclosure(contrast, alt);

    const text = JSON.stringify(captured);
    expect(text).not.toContain(REASON_TOKEN);
    expect(text).not.toContain('fabrikam-admin');
  });
});
