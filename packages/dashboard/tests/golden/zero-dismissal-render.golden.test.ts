/**
 * Phase 88 golden baselines, render family (D-20a).
 *
 * With ZERO dismissals applying to the scanned site, every render surface must
 * produce exactly what it produced BEFORE Phase 88 wired dismissals. The
 * baseline in baseline/zero-dismissal-render.json was captured from unwired
 * code; this file only compares. The fixture also carries dismissals that must
 * never apply (another org on the same site URL, the same org on another site),
 * so a later cross-org or cross-site leak turns these goldens red.
 *
 * Capture: GOLDEN_CAPTURE=1 (adds a missing surface, never overwrites one).
 */
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { goldenCheck } from './golden-io.js';
import {
  createSurfaceContext,
  driveAiSummaryInput,
  driveBrandDrilldown,
  driveDigest,
  driveEmailCsv,
  driveNotificationPdfEnvelope,
  drivePrint,
  drivePublicReport,
  driveReportDetail,
  registerViewHelpers,
  type SurfaceContext,
} from './drivers/render-drivers.js';
import { capturedReportPdfCalls, resetPdfCapture } from './drivers/pdf-capture.js';
import { restoreClock, useFixedClock } from '../helpers/dismissal-surface-fixture.js';

// The notification PDF reaches generatePdfFromData; capture its ARGUMENTS (never PDF bytes).
vi.mock('../../src/pdf/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pdf/generator.js')>();
  const capture = await import('./drivers/pdf-capture.js');
  return {
    ...actual,
    generatePdfFromData: capture.captureReportPdf,
    generateVpatPdf: capture.captureVpatPdf,
  };
});

const FILE = 'zero-dismissal-render';

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

describe('zero-dismissal render goldens', () => {
  it('golden: report detail (/reports/:id) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'report-detail', await driveReportDetail(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: report print (/reports/:id/print) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'report-print', await drivePrint(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: public report (/reports/:id/public) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'public-report', await drivePublicReport(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: AI summary input (analyseReport argument) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'ai-summary-input', await driveAiSummaryInput(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: brand drilldown (color + components) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'brand-drilldown', await driveBrandDrilldown(ctx, ctx.scanId), ctx.literals());
  });

  it('golden: digest (buildDigest over the org) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'digest', await driveDigest(ctx), ctx.literals());
  });

  it('golden: notification PDF data (generatePdfFromData argument) zero-dismissal output is unchanged', async () => {
    const envelope = await driveNotificationPdfEnvelope(ctx);
    goldenCheck(FILE, 'notification-pdf-data', { envelope, pdfCalls: capturedReportPdfCalls() }, ctx.literals());
  });

  it('golden: email CSV (buildAttachments csv) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'email-csv', await driveEmailCsv(ctx), ctx.literals());
  });
});
