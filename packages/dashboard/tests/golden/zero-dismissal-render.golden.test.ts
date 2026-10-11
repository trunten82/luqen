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
import { afterEach, beforeEach, describe, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { goldenCheck } from './golden-io.js';
import {
  createSurfaceContext,
  driveReportDetail,
  registerViewHelpers,
  type SurfaceContext,
} from './drivers/render-drivers.js';
import { restoreClock, useFixedClock } from '../helpers/dismissal-surface-fixture.js';

const FILE = 'zero-dismissal-render';

let ctx: SurfaceContext;

beforeEach(async () => {
  useFixedClock();
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
});
