/**
 * Phase 88 golden baselines, export + ACR family (D-20a).
 *
 * With ZERO dismissals applying to the scanned site, every export and ACR
 * assembly must produce exactly what it produced BEFORE Phase 88 wired
 * dismissals. The baseline in baseline/zero-dismissal-acr-export.json was
 * captured from unwired code; this file only compares. Foreign dismissals
 * (another org on the same site URL, the same org on another site) are seeded
 * and must never apply.
 *
 * Capture: GOLDEN_CAPTURE=1 (adds a missing surface, never overwrites one).
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { goldenCheck } from './golden-io.js';
import { createSurfaceContext, registerViewHelpers, type SurfaceContext } from './drivers/render-drivers.js';
import {
  driveAcrView,
  driveFleetVpatInput,
  driveIssuesXlsx,
  drivePublicAcrHtml,
  driveReportPdfData,
  driveStatementHtml,
  driveVpatModel,
} from './drivers/acr-export-drivers.js';
import { resetPdfCapture } from './drivers/pdf-capture.js';
import { restoreClock, useFixedClock } from '../helpers/dismissal-surface-fixture.js';

// report.pdf and the fleet report reach the PDF generators; capture their ARGUMENTS (never PDF bytes).
vi.mock('../../src/pdf/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pdf/generator.js')>();
  const capture = await import('./drivers/pdf-capture.js');
  return {
    ...actual,
    generatePdfFromData: capture.captureReportPdf,
    generateVpatPdf: capture.captureVpatPdf,
  };
});

const FILE = 'zero-dismissal-acr-export';

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

describe('zero-dismissal export + ACR goldens', () => {
  it('golden: issues.xlsx workbook zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'issues-xlsx', await driveIssuesXlsx(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: report.pdf data (generatePdfFromData argument) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'report-pdf-data', await driveReportPdfData(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: VPAT model (loadVpatForScan) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'vpat-model', await driveVpatModel(ctx), ctx.literals());
  });

  it('golden: ACR view en zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'acr-view-en', await driveAcrView(ctx, 'en'), ctx.literals());
  });

  it('golden: ACR view it zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'acr-view-it', await driveAcrView(ctx, 'it'), ctx.literals());
  });

  it('golden: public ACR HTML (/reports/:id/acr) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'public-acr-html', await drivePublicAcrHtml(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: accessibility statement HTML zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'statement-html', await driveStatementHtml(ctx), ctx.literals());
  });

  it('golden: fleet report VPAT input (generateVpatPdf argument) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'fleet-vpat-input', await driveFleetVpatInput(ctx), ctx.literals());
  });
});
