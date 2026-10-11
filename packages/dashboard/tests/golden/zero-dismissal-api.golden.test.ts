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
import {
  createApiContext,
  driveCompare,
  driveGraphqlScanIssues,
  driveMcpFleetCounts,
  driveMcpGetReport,
  driveMcpQueryIssues,
  driveMcpReportResource,
  driveRestComplianceSummary,
  driveRestScan,
  driveRestScanFixes,
  driveRestScanIssues,
} from './drivers/api-drivers.js';
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

  it('golden: MCP dashboard_query_issues (pages shape) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'mcp-query-issues-pages', await driveMcpQueryIssues(ctx, 'pages'), ctx.literals());
  });

  it('golden: MCP dashboard_query_issues (results shape) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'mcp-query-issues-results', await driveMcpQueryIssues(ctx, 'results'), ctx.literals());
  });

  it('golden: MCP scan report resource (scan://report/{id}) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'mcp-report-resource', await driveMcpReportResource(ctx), ctx.literals());
  });

  it('golden: MCP dashboard_scan_summary_for_fleet zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'mcp-fleet-counts', await driveMcpFleetCounts(ctx), ctx.literals());
  });

  it('golden: REST GET /api/v1/scans/:id zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'rest-scan', await driveRestScan(ctx), ctx.literals());
  });

  it('golden: REST GET /api/v1/scans/:id/issues zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'rest-scan-issues', await driveRestScanIssues(ctx), ctx.literals());
  });

  it('golden: REST compliance summary (GET /api/v1/compliance-summary) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'rest-compliance-summary', await driveRestComplianceSummary(ctx), ctx.literals());
  });

  it('golden: REST GET /api/v1/scans/:id/fixes zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'rest-scan-fixes', await driveRestScanFixes(ctx), ctx.literals());
  });

  it('golden: GraphQL scanIssues zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'graphql-scan-issues', await driveGraphqlScanIssues(ctx), ctx.literals());
  });

  it('golden: compare (/reports/compare) zero-dismissal output is unchanged', async () => {
    goldenCheck(FILE, 'compare', await driveCompare(ctx), ctx.literals());
  });
});
