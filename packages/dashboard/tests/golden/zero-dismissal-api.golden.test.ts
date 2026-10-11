/**
 * Phase 88 golden baselines, API / agent / bypass surfaces (D-20a, FP-11).
 *
 * With ZERO dismissals applying to the scanned site, every API, agent and
 * bypass surface must produce exactly what it produced BEFORE Phase 88 wired
 * dismissals. The baseline in baseline/zero-dismissal-api.json was captured
 * from unwired code; this file only compares. The fixture also carries
 * dismissals that must never apply (another org on the same site URL, the same
 * org on another site), so a later cross-org or cross-site leak turns these
 * goldens red.
 *
 * Capture: GOLDEN_CAPTURE=1 (adds a missing surface, never overwrites one).
 * The orchestrator's two paths are Plan 16's.
 */
import { afterEach, beforeEach, describe, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { goldenCheck } from './golden-io.js';
import { createApiContext, driveMcpGetReport } from './drivers/api-drivers.js';
import type { SurfaceContext } from './drivers/render-drivers.js';
import { restoreClock, useFixedClock } from '../helpers/dismissal-surface-fixture.js';

const FILE = 'zero-dismissal-api';

let ctx: SurfaceContext;

beforeEach(async () => {
  useFixedClock();
  ctx = await createApiContext();
});

afterEach(async () => {
  await ctx.cleanup();
  restoreClock();
});

describe('zero-dismissal API goldens', () => {
  it('golden: MCP dashboard_get_report zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'mcp-get-report', await driveMcpGetReport(ctx), ctx.literals());
  });
});
